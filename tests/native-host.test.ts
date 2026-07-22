import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

interface NativeResponse {
  id?: string;
  ok: boolean;
  error?: string;
  result?: {
    transport?: string;
    file?: { path?: string };
    providers?: Array<{ name: string; available: boolean }>;
    pending?: { id?: string; changes?: Array<{ kind?: string; intent?: string; target?: { tag?: string } }> };
    previewUrl?: string;
    canUndo?: boolean;
    settings?: { claudeExecutable?: string; defaultClaudeExecutable?: string };
  };
}

function startHost(configFile: string): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ["--import", "tsx", "server/native-host.ts"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, NODE_ENV: "test", HTMLWRIGHT_CONFIG_FILE: configFile },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function exchange(child: ChildProcessWithoutNullStreams, request: unknown): Promise<NativeResponse> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const length = buffer.readUInt32LE(0);
      if (buffer.length < length + 4) return;
      child.stdout.off("data", onData);
      resolve(JSON.parse(buffer.subarray(4, length + 4).toString("utf8")) as NativeResponse);
    };
    child.stdout.on("data", onData);
    child.once("error", reject);
    const body = Buffer.from(JSON.stringify(request));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    child.stdin.write(Buffer.concat([header, body]));
  });
}

test("native host opens only local HTML files and returns compact state", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "htmlwright-native-test-"));
  const filePath = path.join(directory, "page.html");
  const configFile = path.join(directory, "config.json");
  await writeFile(filePath, "<!doctype html><html><body><h1>Native</h1></body></html>", "utf8");
  const child = startHost(configFile);
  try {
    const opened = await exchange(child, { id: "open", action: "open", payload: { fileUrl: pathToFileURL(filePath).href } });
    assert.equal(opened.ok, true);
    assert.equal(opened.result?.transport, "native");
    assert.equal(opened.result?.file?.path, filePath);
    assert.equal(opened.result?.providers?.find(provider => provider.name === "demo")?.available, true);

    // A non-executable Claude path no longer hard-fails configure (an OpenAI-only
    // user must not be blocked by it); claude-code just reports itself unavailable.
    const missingClaude = await exchange(child, {
      id: "missing-claude",
      action: "configure",
      payload: { claudeExecutable: path.join(directory, "missing-claude") },
    });
    assert.equal(missingClaude.ok, true);
    assert.equal(missingClaude.result?.providers?.find(provider => provider.name === "claude-code")?.available, false);

    // A relative Claude path is still rejected outright.
    const relativeClaude = await exchange(child, {
      id: "relative-claude",
      action: "configure",
      payload: { claudeExecutable: "not/absolute" },
    });
    assert.equal(relativeClaude.ok, false);

    // Configuring an OpenAI-compatible backend alone is enough to get a provider.
    const openaiConfigured = await exchange(child, {
      id: "config-openai",
      action: "configure",
      payload: { openaiApiKey: "test-key", openaiModel: "test-model" },
    });
    assert.equal(openaiConfigured.ok, true);
    assert.equal(openaiConfigured.result?.providers?.find(provider => provider.name === "openai-compatible")?.available, true);
    assert.equal(JSON.parse(await readFile(configFile, "utf8")).openaiApiKey, "test-key");

    const configured = await exchange(child, {
      id: "config",
      action: "configure",
      payload: { claudeExecutable: process.execPath },
    });
    assert.equal(configured.ok, true);
    assert.equal(configured.result?.settings?.claudeExecutable, process.execPath);
    assert.equal(JSON.parse(await readFile(configFile, "utf8")).claudeExecutable, process.execPath);

    const quickEdited = await exchange(child, {
      id: "quick-edit",
      action: "quick-edit",
      payload: {
        selectedElement: { tag: "h1", classes: [], text: "Native", outerHTML: "<h1>Native</h1>", sourcePath: [1, 0] },
        changes: { text: "Quick Native", color: "#336699" },
      },
    });
    assert.equal(quickEdited.ok, true);
    assert.ok(quickEdited.result?.pending?.id);
    assert.equal(quickEdited.result?.pending?.changes?.length, 1);
    assert.equal(quickEdited.result?.pending?.changes?.[0].target?.tag, "h1");
    const previewHtml = await readFile(fileURLToPath(quickEdited.result?.previewUrl || ""), "utf8");
    assert.match(previewHtml, /Quick Native/);
    assert.match(previewHtml, /htmlwright-bridge/);
    assert.doesNotMatch(await readFile(filePath, "utf8"), /Quick Native/);

    const edited = await exchange(child, {
      id: "edit",
      action: "edit",
      payload: { intent: "mark the document", scope: "document", provider: "demo" },
    });
    assert.equal(edited.ok, true);
    assert.ok(edited.result?.pending?.id);
    assert.equal(edited.result?.pending?.changes?.length, 2);
    assert.equal(edited.result?.pending?.changes?.[0].kind, "quick");
    assert.equal(edited.result?.pending?.changes?.[1].intent, "mark the document");
    assert.match(edited.result?.previewUrl || "", /^file:\/\//);
    assert.doesNotMatch(await readFile(filePath, "utf8"), /data-htmlwright-demo/);

    const accepted = await exchange(child, { id: "accept", action: "accept" });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.result?.canUndo, true);
    assert.match(await readFile(filePath, "utf8"), /data-htmlwright-demo/);

    const undone = await exchange(child, { id: "undo", action: "undo" });
    assert.equal(undone.ok, true);
    assert.doesNotMatch(await readFile(filePath, "utf8"), /data-htmlwright-demo/);

    const invalid = await exchange(child, { id: "invalid", action: "open", payload: { fileUrl: "https://example.com/page.html" } });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error || "", /file:\/\//);
  } finally {
    child.stdin.end();
    child.kill();
    await rm(directory, { recursive: true, force: true });
  }
});
