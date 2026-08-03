import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

export const isWindows = process.platform === "win32";

function localAppData(): string {
  return process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local");
}

function roamingAppData(): string {
  return process.env.APPDATA || path.join(homedir(), "AppData", "Roaming");
}

// Default Claude Code executable. The installer detects the real path and bakes it
// into the native host environment, so this only matters as a last-resort fallback.
export function defaultClaudeExecutable(): string {
  if (isWindows) return path.join(roamingAppData(), "npm", "claude.cmd");
  return path.join(homedir(), ".local", "bin", "claude");
}

export function configFilePath(): string {
  if (isWindows) return path.join(localAppData(), "htmlwright", "config.json");
  return path.join(homedir(), "Library", "Application Support", "htmlwright", "config.json");
}

const isMac = process.platform === "darwin";

// Installed browsers to fall back to when the bundled Chromium is unavailable.
export const chromeCandidates: string[] = isWindows
  ? [
      path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(localAppData(), "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(localAppData(), "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.join(process.env["ProgramFiles"] || "C:\\Program Files", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    ]
  : isMac
    ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      ]
    : [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
        "/usr/bin/microsoft-edge",
        "/usr/bin/brave-browser",
      ];

export function openUrl(url: string): void {
  if (isWindows) spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  else spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
}
