import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createApp } from "./app.ts";

function usage(): never {
  console.error("Usage: htmlwright <file.html> [--port 4178] [--no-open] [--in-place]");
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const fileArg = argv.find(arg => !arg.startsWith("--"));
  if (!fileArg) usage();
  const portIndex = argv.indexOf("--port");
  const port = portIndex >= 0 ? Number(argv[portIndex + 1]) : 4178;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port 必须是有效端口");
  return { filePath: path.resolve(fileArg), port, noOpen: argv.includes("--no-open"), inPlace: argv.includes("--in-place"), dev: argv.includes("--dev") };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (path.extname(options.filePath).toLowerCase() !== ".html") throw new Error("只支持单个 .html 文件");
  await access(options.filePath);
  const running = await createApp(options);
  console.log(`htmlwright: ${running.url}`);
  console.log(`Editing: ${options.filePath}`);
  if (!options.noOpen) spawn("open", [running.url], { detached: true, stdio: "ignore" }).unref();
  const stop = async () => { await running.close(); process.exit(0); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
