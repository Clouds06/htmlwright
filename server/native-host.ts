import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { injectPreview } from "./preview.ts";
import { createProvider } from "./providers.ts";
import { ProjectSession, type PendingEdit } from "./session.ts";
import type { EditRequest, ProviderName, ProviderStatus, QuickEditRequest, VerificationResult } from "./types.ts";

const MAX_INBOUND_BYTES = 64 * 1024 * 1024;
const MAX_OUTBOUND_BYTES = 1024 * 1024;
const DIFF_LIMIT = 240_000;
const providerNames: ProviderName[] = ["claude-code", "anthropic-api", "demo"];
const configFile = process.env.HTMLWRIGHT_CONFIG_FILE
  || path.join(homedir(), "Library", "Application Support", "htmlwright", "config.json");

interface NativeRequest {
  id: string;
  action: "open" | "state" | "configure" | "quick-edit" | "edit" | "accept" | "reject" | "undo";
  payload?: Record<string, unknown>;
}

let input = Buffer.alloc(0);
let session: ProjectSession | undefined;
let providerStatuses: ProviderStatus[] = providerNames.map(name => ({ name, available: false, message: "正在检查" }));
let previewFile: string | undefined;
let messageQueue = Promise.resolve();

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith(`~${path.sep}`)) return path.join(homedir(), value.slice(2));
  return value;
}

async function loadConfiguration(): Promise<void> {
  try {
    const stored = JSON.parse(await readFile(configFile, "utf8")) as { claudeExecutable?: string };
    if (stored.claudeExecutable) process.env.HTMLWRIGHT_CLAUDE_EXECUTABLE = stored.claudeExecutable;
  } catch { /* use installer environment or default path */ }
  process.env.HTMLWRIGHT_CLAUDE_EXECUTABLE ||= path.join(homedir(), ".local", "bin", "claude");
}

async function configureClaude(value: unknown): Promise<void> {
  if (typeof value !== "string" || !value.trim()) throw new Error("请输入 Claude Code 可执行文件路径");
  const expanded = expandHome(value.trim());
  if (!path.isAbsolute(expanded)) throw new Error("Claude Code 路径必须是绝对路径，或以 ~/ 开头");
  const executable = path.normalize(expanded);
  await access(executable, constants.X_OK).catch(() => {
    throw new Error(`无法执行该文件：${executable}`);
  });
  process.env.HTMLWRIGHT_CLAUDE_EXECUTABLE = executable;
  await mkdir(path.dirname(configFile), { recursive: true });
  await writeFile(configFile, `${JSON.stringify({ claudeExecutable: executable }, null, 2)}\n`, "utf8");
}

function send(message: unknown): void {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length > MAX_OUTBOUND_BYTES) {
    send({ ok: false, error: "Native Host 返回内容超过 Chrome 1MB 限制", id: (message as { id?: string })?.id });
    return;
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function compactVerification(verification: VerificationResult): VerificationResult {
  const { beforeShot: _before, afterShot: _after, diffShot: _diff, ...compact } = verification;
  return compact;
}

function compactPending(pending?: PendingEdit) {
  if (!pending) return undefined;
  return {
    ...pending,
    diff: pending.diff.length > DIFF_LIMIT ? `${pending.diff.slice(0, DIFF_LIMIT)}\n\n... diff 已截断` : pending.diff,
    verification: compactVerification(pending.verification),
  };
}

async function createPreview(): Promise<string | undefined> {
  if (!session?.pending) {
    if (previewFile) await unlink(previewFile).catch(() => undefined);
    previewFile = undefined;
    return undefined;
  }
  const key = createHash("sha256").update(session.filePath).digest("hex").slice(0, 16);
  const workingDirectory = path.join(session.directory, ".htmlwright");
  await mkdir(workingDirectory, { recursive: true });
  const baseUrl = pathToFileURL(`${session.directory}${path.sep}`).href;
  const html = injectPreview(session.candidateHtml, baseUrl);
  previewFile = path.join(workingDirectory, `preview-${key}-${path.basename(session.filePath)}`);
  await writeFile(previewFile, html, "utf8");
  return pathToFileURL(previewFile).href;
}

async function statePayload() {
  if (!session) throw new Error("请先在 Chrome 中打开一个本地 HTML 文件");
  return {
    ...session.summary(providerStatuses),
    pending: compactPending(session.pending),
    previewUrl: await createPreview(),
    transport: "native",
    settings: {
      claudeExecutable: process.env.HTMLWRIGHT_CLAUDE_EXECUTABLE,
      defaultClaudeExecutable: path.join(homedir(), ".local", "bin", "claude"),
    },
  };
}

function resolveHtmlFile(fileUrl: unknown): string {
  if (typeof fileUrl !== "string") throw new Error("当前标签页不是本地 HTML 文件");
  const url = new URL(fileUrl);
  if (url.protocol !== "file:") throw new Error("Native Host 只接受 file:// 页面");
  const filePath = path.resolve(fileURLToPath(url));
  if (![".html", ".htm"].includes(path.extname(filePath).toLowerCase())) throw new Error("只支持 .html 或 .htm 文件");
  return filePath;
}

async function handle(request: NativeRequest) {
  if (!request?.id || !request.action) throw new Error("Native Messaging 请求格式无效");
  if (request.action === "configure") {
    await configureClaude(request.payload?.claudeExecutable);
    providerStatuses = await Promise.all(providerNames.map(name => createProvider(name).status()));
    return statePayload();
  }
  if (request.action === "open") {
    const filePath = resolveHtmlFile(request.payload?.fileUrl);
    if (!session || session.filePath !== filePath) {
      if (previewFile) await unlink(previewFile).catch(() => undefined);
      previewFile = undefined;
      session = await ProjectSession.create(filePath);
    }
    else await session.onExternalChange();
    providerStatuses = await Promise.all(providerNames.map(name => createProvider(name).status()));
    return statePayload();
  }
  if (!session) throw new Error("请先打开本地 HTML 文件");
  if (request.action === "state") return statePayload();
  if (request.action === "quick-edit") {
    await session.quickEdit(request.payload as unknown as QuickEditRequest);
    return statePayload();
  }
  if (request.action === "edit") {
    await session.edit(request.payload as unknown as EditRequest);
    return statePayload();
  }
  if (request.action === "accept") {
    await session.accept();
    return statePayload();
  }
  if (request.action === "reject") {
    await session.reject();
    return statePayload();
  }
  if (request.action === "undo") {
    await session.undo();
    return statePayload();
  }
  throw new Error("不支持的 Native Messaging 操作");
}

async function processMessage(request: NativeRequest): Promise<void> {
  try {
    send({ id: request.id, ok: true, result: await handle(request) });
  } catch (error) {
    send({ id: request?.id, ok: false, error: error instanceof Error ? error.message : "未知错误" });
  }
}

function drain(): void {
  while (input.length >= 4) {
    const length = input.readUInt32LE(0);
    if (length > MAX_INBOUND_BYTES) {
      send({ ok: false, error: "Native Messaging 请求超过 64MB 限制" });
      process.exit(1);
    }
    if (input.length < length + 4) return;
    const body = input.subarray(4, length + 4);
    input = input.subarray(length + 4);
    try {
      const request = JSON.parse(body.toString("utf8")) as NativeRequest;
      messageQueue = messageQueue.then(() => processMessage(request));
    } catch {
      send({ ok: false, error: "Native Messaging JSON 无效" });
    }
  }
}

process.stdin.on("data", chunk => {
  input = Buffer.concat([input, chunk]);
  drain();
});
process.stdin.on("end", () => {
  if (previewFile) void unlink(previewFile).catch(() => undefined);
});

await loadConfiguration();
