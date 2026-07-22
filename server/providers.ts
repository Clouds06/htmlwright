import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ProviderName, ProviderResult, ProviderStatus, TaskPackage } from "./types.ts";
import { stripRuntimeAttributes } from "./preview.ts";

const execFileAsync = promisify(execFile);
const START = "<<<START>>>";
const END = "<<<END>>>";

function claudeExecutable(): string {
  return process.env.HTMLWRIGHT_CLAUDE_EXECUTABLE || path.join(homedir(), ".local", "bin", "claude");
}

export interface LLMProvider {
  edit(task: TaskPackage): Promise<ProviderResult>;
  status(): Promise<ProviderStatus>;
}

export const SCOPE_INSTRUCTIONS: Record<TaskPackage["scope"], string> = {
  element: "只修改选中元素及实现该改动不可避免的直接样式，其他内容保持不变。",
  unit: "只修改选中元素所在的当前内容单元，其他内容单元和页面保持不变。",
  page: "只修改当前页；对于 PPT，当前页是 unitIndex 指向的那一页，其他页保持不变。",
  document: "修改范围是整个 HTML 文件，允许统一调整所有页面、全局样式、变量和共享结构。",
};

function buildPrompt(task: TaskPackage, fullFileInstruction?: string): string {
  const selected = task.selectedElement
    ? JSON.stringify({ ...task.selectedElement, outerHTML: stripRuntimeAttributes(task.selectedElement.outerHTML) }, null, 2)
    : "未选择具体元素";
  return `你是单文件 HTML 的精确编辑器。只执行用户明确要求的改动，保留所有无关内容、脚本和交互逻辑。\n\n编辑意图：${task.intent}\n范围：${task.scope}\n范围约束：${SCOPE_INSTRUCTIONS[task.scope]}\n当前页 / 内容单元索引：${task.unitIndex ?? "未指定"}\n选中元素：\n${selected}\n\n${fullFileInstruction ?? `完整原文件：\n${task.fullFile}`}\n\n只返回改后的完整 HTML，必须置于 ${START} 和 ${END} 之间。不要解释，不要输出 markdown，不要修改任何文件。`;
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fence = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  return fence ? fence[1].trim() : trimmed;
}

// Tolerant extraction so weaker / non-Claude models still work: prefer the
// explicit START/END markers, otherwise fall back to a fenced block or a bare
// <html>...</html>. Anything that is not a complete, closed document is rejected
// so it never reaches disk (write-back only happens after verification anyway).
export function extractHtml(value: string): string {
  const cleaned = stripCodeFence(value);
  const start = cleaned.indexOf(START);
  const end = cleaned.lastIndexOf(END);
  let html: string;
  if (start >= 0 && end > start) {
    html = cleaned.slice(start + START.length, end);
  } else {
    const match = cleaned.match(/<!doctype\b[\s\S]*<\/html\s*>/i) || cleaned.match(/<html\b[\s\S]*<\/html\s*>/i);
    if (!match) throw new Error("Model output contained no complete HTML (no START/END markers and no <html>...</html>)");
    html = match[0];
  }
  html = stripCodeFence(html).trim();
  if (!/<html\b|<!doctype\b/i.test(html) || !/<\/html\s*>/i.test(html)) {
    throw new Error("Model did not return a complete, well-closed HTML document");
  }
  return html;
}

function run(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; input: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Claude Code 调用超过 3 分钟")); }, 180_000);
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `Claude Code 退出码 ${code}`));
    });
    child.stdin.end(options.input);
  });
}

export class ClaudeCodeProvider implements LLMProvider {
  async status(): Promise<ProviderStatus> {
    if (process.env.ANTHROPIC_API_KEY) return { name: "claude-code", available: false, message: "检测到 ANTHROPIC_API_KEY；为避免误走 API 计费，Claude Code provider 已停用" };
    try {
      const { stdout } = await execFileAsync(claudeExecutable(), ["auth", "status"], { timeout: 10_000 });
      const auth = JSON.parse(stdout) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string };
      if (!auth.loggedIn) return { name: "claude-code", available: false, message: "Claude Code 尚未登录" };
      return { name: "claude-code", available: true, message: `已连接 ${auth.subscriptionType ?? "Claude"} 订阅`, auth: auth.authMethod };
    } catch {
      return { name: "claude-code", available: false, message: "找不到 Claude Code，或无法读取登录状态" };
    }
  }

  async edit(task: TaskPackage): Promise<ProviderResult> {
    const status = await this.status();
    if (!status.available) throw new Error(status.message);
    const workdir = await mkdtemp(path.join(tmpdir(), "htmlwright-"));
    try {
      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY;
      const largeInput = Buffer.byteLength(task.fullFile, "utf8") > 7_500_000;
      let prompt: string;
      let toolArgs: string[];
      if (largeInput) {
        const inputPath = path.join(workdir, "source.html");
        await writeFile(inputPath, task.fullFile, "utf8");
        prompt = buildPrompt(task, `完整原文件位于 ${inputPath}，请先读取它。`);
        toolArgs = ["--tools", "Read", "--allowedTools", "Read"];
      } else {
        prompt = buildPrompt(task);
        toolArgs = ["--tools", ""];
      }
      const args = [
        "-p", "--output-format", "json", "--max-turns", "1",
        ...toolArgs,
        "--disallowedTools", "Write,Edit,Bash,WebFetch,WebSearch",
        "--strict-mcp-config",
        "--append-system-prompt", `只返回改后的完整 HTML，置于 ${START}/${END} 之间；不修改任何文件；不解释。`,
      ];
      const stdout = await run(claudeExecutable(), args, { cwd: workdir, env, input: prompt });
      const parsed = JSON.parse(stdout) as { result?: string; is_error?: boolean };
      if (parsed.is_error || !parsed.result) throw new Error(parsed.result || "Claude Code 未返回结果");
      return { html: extractHtml(parsed.result), raw: parsed.result };
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }
}

export class AnthropicAPIProvider implements LLMProvider {
  async status(): Promise<ProviderStatus> {
    return process.env.ANTHROPIC_API_KEY
      ? { name: "anthropic-api", available: true, message: "Anthropic API key 已配置" }
      : { name: "anthropic-api", available: false, message: "未配置 ANTHROPIC_API_KEY" };
  }

  async edit(task: TaskPackage): Promise<ProviderResult> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("未配置 ANTHROPIC_API_KEY");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.HTMLWRIGHT_MODEL || "claude-sonnet-4-5", max_tokens: 32000, messages: [{ role: "user", content: buildPrompt(task) }] }),
    });
    if (!response.ok) throw new Error(`Anthropic API 请求失败：${response.status} ${await response.text()}`);
    const data = await response.json() as { content?: Array<{ type: string; text?: string }> };
    const raw = data.content?.find(item => item.type === "text")?.text || "";
    return { html: extractHtml(raw), raw };
  }
}

function openaiApiKey(): string | undefined {
  return process.env.HTMLWRIGHT_OPENAI_API_KEY || process.env.OPENAI_API_KEY || undefined;
}

function openaiBaseUrl(): string {
  return (process.env.HTMLWRIGHT_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
}

function openaiModel(): string {
  return process.env.HTMLWRIGHT_OPENAI_MODEL || "gpt-4o";
}

// Works with any OpenAI Chat Completions compatible endpoint: OpenAI, OpenRouter,
// Groq, DeepSeek, a local Ollama / LM Studio server, etc. Configured through the
// HTMLWRIGHT_OPENAI_* env vars (base URL + model + key), or OPENAI_API_KEY.
export class OpenAICompatibleProvider implements LLMProvider {
  async status(): Promise<ProviderStatus> {
    return openaiApiKey()
      ? { name: "openai-compatible", available: true, message: `OpenAI-compatible endpoint ready (model: ${openaiModel()})` }
      : { name: "openai-compatible", available: false, message: "Set HTMLWRIGHT_OPENAI_API_KEY (optionally HTMLWRIGHT_OPENAI_BASE_URL / HTMLWRIGHT_OPENAI_MODEL)" };
  }

  async edit(task: TaskPackage): Promise<ProviderResult> {
    const key = openaiApiKey();
    if (!key) throw new Error("HTMLWRIGHT_OPENAI_API_KEY is not set");
    const response = await fetch(`${openaiBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: openaiModel(), max_tokens: 32000, messages: [{ role: "user", content: buildPrompt(task) }] }),
    });
    if (!response.ok) throw new Error(`OpenAI-compatible request failed: ${response.status} ${await response.text()}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content || "";
    return { html: extractHtml(raw), raw };
  }
}

export class DemoProvider implements LLMProvider {
  async status(): Promise<ProviderStatus> {
    const available = process.env.HTMLWRIGHT_ENABLE_DEMO === "1" || process.env.NODE_ENV === "test";
    return { name: "demo", available, message: available ? "本地演示 provider 可用" : "本地演示 provider 未启用" };
  }

  async edit(task: TaskPackage): Promise<ProviderResult> {
    if (!(await this.status()).available) throw new Error("本地演示 provider 未启用");
    const source = task.fullFile;
    const selected = task.selectedElement ? stripRuntimeAttributes(task.selectedElement.outerHTML) : "";
    let html = source;
    if (selected && source.includes(selected)) {
      const replacement = selected.replace(/^(<\w+)/, '$1 data-htmlwright-demo="edited"');
      html = source.replace(selected, replacement);
    } else {
      html = source.replace(/<body([^>]*)>/i, '<body$1 data-htmlwright-demo="edited">');
    }
    return { html };
  }
}

export function createProvider(name: ProviderName): LLMProvider {
  if (name === "anthropic-api") return new AnthropicAPIProvider();
  if (name === "openai-compatible") return new OpenAICompatibleProvider();
  if (name === "demo") return new DemoProvider();
  return new ClaudeCodeProvider();
}
