import { createServer as createHttpServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import path from "node:path";
import chokidar from "chokidar";
import express, { type Express, type Response } from "express";
import { createProvider } from "./providers.ts";
import { defaultClaudeExecutable } from "./platform.ts";
import { injectPreview } from "./preview.ts";
import { ProjectSession } from "./session.ts";
import type { EditRequest, ProviderName, ProviderStatus, QuickEditRequest } from "./types.ts";

export interface AppOptions {
  filePath: string;
  port: number;
  dev?: boolean;
  inPlace?: boolean;
}

export interface RunningApp {
  url: string;
  server: Server;
  session: ProjectSession;
  close(): Promise<void>;
}

function asyncRoute(handler: (request: express.Request, response: express.Response) => Promise<unknown>) {
  return (request: express.Request, response: express.Response, next: express.NextFunction) => {
    handler(request, response).catch(next);
  };
}

export async function createApp(options: AppOptions): Promise<RunningApp> {
  const session = await ProjectSession.create(options.filePath, options.inPlace);
  const app: Express = express();
  const apiToken = randomBytes(24).toString("base64url");
  const clients = new Set<Response>();
  const providerNames: ProviderName[] = ["claude-code", "anthropic-api", "openai-compatible", "demo"];
  let providerStatuses: ProviderStatus[] = providerNames.map(name => ({ name, available: false, message: "正在检查" }));
  const settingsPayload = () => ({
    claudeExecutable: process.env.HTMLWRIGHT_CLAUDE_EXECUTABLE,
    defaultClaudeExecutable: defaultClaudeExecutable(),
    openaiApiKey: process.env.HTMLWRIGHT_OPENAI_API_KEY,
    openaiBaseUrl: process.env.HTMLWRIGHT_OPENAI_BASE_URL,
    openaiModel: process.env.HTMLWRIGHT_OPENAI_MODEL,
  });
  const statePayload = () => ({
    ...session.summary(providerStatuses),
    apiToken,
    previewUrl: `http://localhost:${options.port}/preview?version=candidate`,
    settings: settingsPayload(),
  });
  async function refreshProviders() {
    providerStatuses = await Promise.all(providerNames.map(name => createProvider(name).status()));
    broadcast("state", statePayload());
  }
  refreshProviders();

  function broadcast(event: string, payload: unknown) {
    const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    clients.forEach(client => client.write(data));
  }

  const allowedHosts = new Set([`localhost:${options.port}`, `127.0.0.1:${options.port}`]);
  app.use((request, response, next) => {
    if (request.headers.host && !allowedHosts.has(request.headers.host)) {
      response.status(403).json({ error: "Rejected unexpected Host header (DNS-rebinding guard)" });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "50mb" }));
  app.use("/api", (request, response, next) => {
    if (request.method !== "GET" && request.header("x-htmlwright-token") !== apiToken) {
      response.status(403).json({ error: "本地服务鉴权失败，请重新连接 htmlwright" });
      return;
    }
    next();
  });
  app.get("/api/state", (_request, response) => response.json(statePayload()));
  app.get("/api/events", (request, response) => {
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    clients.add(response);
    response.write(`event: state\ndata: ${JSON.stringify(statePayload())}\n\n`);
    request.on("close", () => clients.delete(response));
  });
  app.get("/preview", (request, response) => {
    const version = request.query.version;
    const changeParam = request.query.change;
    const html = version === "baseline"
      ? session.baselineHtml
      : changeParam !== undefined
        ? session.changeSnapshot(Number(changeParam))
        : session.candidateHtml;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.send(injectPreview(html));
  });
  app.use("/target-assets", express.static(session.directory, { fallthrough: false, index: false, dotfiles: "ignore" }));
  app.post("/api/edit", asyncRoute(async (request, response) => {
    const result = await session.edit(request.body as EditRequest, `http://127.0.0.1:${options.port}`);
    broadcast("state", statePayload());
    broadcast("preview", { reason: "candidate" });
    response.json(result);
  }));
  app.post("/api/configure", asyncRoute(async (request, response) => {
    const body = request.body as { claudeExecutable?: string; openaiApiKey?: string; openaiBaseUrl?: string; openaiModel?: string };
    const setEnv = (key: string, value?: string) => {
      const trimmed = value?.trim();
      if (trimmed) process.env[key] = trimmed; else delete process.env[key];
    };
    setEnv("HTMLWRIGHT_CLAUDE_EXECUTABLE", body.claudeExecutable);
    setEnv("HTMLWRIGHT_OPENAI_API_KEY", body.openaiApiKey);
    setEnv("HTMLWRIGHT_OPENAI_BASE_URL", body.openaiBaseUrl);
    setEnv("HTMLWRIGHT_OPENAI_MODEL", body.openaiModel);
    await refreshProviders();
    response.json(statePayload());
  }));
  app.post("/api/quick-edit", asyncRoute(async (request, response) => {
    const result = await session.quickEdit(request.body as QuickEditRequest);
    broadcast("state", statePayload());
    broadcast("preview", { reason: "candidate" });
    response.json(result);
  }));
  app.post("/api/accept", asyncRoute(async (_request, response) => {
    const result = await session.accept();
    broadcast("state", statePayload());
    broadcast("preview", { reason: "accepted" });
    response.json(result);
  }));
  app.post("/api/reject", asyncRoute(async (_request, response) => {
    await session.reject();
    broadcast("state", statePayload());
    broadcast("preview", { reason: "rejected" });
    response.json({ ok: true });
  }));
  app.post("/api/undo", asyncRoute(async (_request, response) => {
    const result = await session.undo();
    broadcast("state", statePayload());
    broadcast("preview", { reason: "undo" });
    response.json(result);
  }));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "未知错误";
    response.status(400).json({ error: message });
  });

  if (options.dev) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const clientRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../client");
    app.use(express.static(clientRoot));
    app.get("*splat", (_request, response) => response.sendFile(path.join(clientRoot, "index.html")));
  }

  const server = createHttpServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const watcher = chokidar.watch(session.filePath, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 25 } });
  watcher.on("change", async () => {
    const result = await session.onExternalChange();
    if (result !== "ignored") {
      broadcast("state", statePayload());
      if (result === "reloaded") broadcast("preview", { reason: "external-change" });
    }
  });
  return {
    url: `http://localhost:${options.port}`,
    server,
    session,
    async close() { clients.forEach(client => client.end()); await watcher.close(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
