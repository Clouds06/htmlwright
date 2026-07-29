import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { chromium, type Browser, type Page } from "playwright-core";
import { PNG } from "pngjs";
import type { UnitVerification, VerificationResult } from "./types.ts";
import { injectPreview } from "./preview.ts";
import { chromeCandidates } from "./platform.ts";

async function findChrome(): Promise<string | undefined> {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  try {
    const bundled = chromium.executablePath();
    await access(bundled);
    return bundled;
  } catch { /* fall back to installed browsers */ }
  for (const candidate of chromeCandidates) {
    try { await access(candidate); return candidate; } catch { /* continue */ }
  }
  return undefined;
}

function toDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export function compareImages(beforeBuffer: Buffer, afterBuffer: Buffer): { ratio: number; diff: Buffer } {
  const before = PNG.sync.read(beforeBuffer);
  const after = PNG.sync.read(afterBuffer);
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const normalizedBefore = new PNG({ width, height, fill: true });
  const normalizedAfter = new PNG({ width, height, fill: true });
  normalizedBefore.data.fill(255);
  normalizedAfter.data.fill(255);
  PNG.bitblt(before, normalizedBefore, 0, 0, before.width, before.height, 0, 0);
  PNG.bitblt(after, normalizedAfter, 0, 0, after.width, after.height, 0, 0);
  const diff = new PNG({ width, height });
  const changed = pixelmatch(normalizedBefore.data, normalizedAfter.data, diff.data, width, height, { threshold: 0.035, includeAA: false });
  return { ratio: changed / (width * height), diff: PNG.sync.write(diff) };
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(async () => {
    await document.fonts?.ready;
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(160);
}

async function diagnostics(page: Page): Promise<{ overflow: string[]; overlaps: string[] }> {
  return page.evaluate(() => {
    const label = (el: Element) => {
      const classes = [...el.classList].slice(0, 2).map(item => `.${item}`).join("");
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${classes}`;
    };
    const elements = [...document.body.querySelectorAll("*")].filter(el => !el.id.startsWith("htmlwright-"));
    const overflow = elements.filter(el => {
      const node = el as HTMLElement;
      const style = getComputedStyle(node);
      const horizontal = node.scrollWidth > node.clientWidth + 2 && style.overflowX !== "visible";
      const clippedVertical = node.scrollHeight > node.clientHeight + 2 && ["hidden", "clip"].includes(style.overflowY);
      return horizontal || clippedVertical;
    }).slice(0, 12).map(label);
    const important = elements.filter(el => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.position === "absolute" && rect.width > 12 && rect.height > 12 && style.pointerEvents !== "none";
    }).slice(0, 80);
    const overlaps = new Set<string>();
    for (let i = 0; i < important.length; i++) {
      const a = important[i].getBoundingClientRect();
      for (let j = i + 1; j < important.length; j++) {
        if (important[i].contains(important[j]) || important[j].contains(important[i])) continue;
        const b = important[j].getBoundingClientRect();
        const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        if (width * height > Math.min(a.width * a.height, b.width * b.height) * 0.18) overlaps.add(`${label(important[i])} / ${label(important[j])}`);
      }
    }
    return { overflow, overlaps: [...overlaps].slice(0, 8) };
  });
}

async function unitScreenshots(page: Page): Promise<Buffer[]> {
  return page.locator("[data-htmlwright-unit]").evaluateAll(async elements => {
    return elements.length;
  }).then(async count => {
    const images: Buffer[] = [];
    for (let index = 0; index < count; index++) {
      const locator = page.locator(`[data-htmlwright-unit="${index}"]`);
      if (await locator.count()) images.push(await locator.screenshot({ animations: "disabled" }));
    }
    return images;
  });
}

export async function verifyCandidate(baseUrl: string, targetUnit?: number): Promise<VerificationResult> {
  let browser: Browser | undefined;
  try {
    const executablePath = await findChrome();
    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ["--font-render-hinting=none", "--disable-crash-reporter", "--disable-crashpad"],
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1 });
    const beforePage = await context.newPage();
    const afterPage = await context.newPage();
    await Promise.all([
      beforePage.goto(`${baseUrl}/preview?version=baseline&verify=1`, { waitUntil: "domcontentloaded" }),
      afterPage.goto(`${baseUrl}/preview?version=candidate&verify=1`, { waitUntil: "domcontentloaded" }),
    ]);
    await Promise.all([settle(beforePage), settle(afterPage)]);
    const [beforeShot, afterShot, beforeUnits, afterUnits, afterDiagnostics] = await Promise.all([
      beforePage.screenshot({ fullPage: true, animations: "disabled" }),
      afterPage.screenshot({ fullPage: true, animations: "disabled" }),
      unitScreenshots(beforePage), unitScreenshots(afterPage), diagnostics(afterPage),
    ]);
    const full = compareImages(beforeShot, afterShot);
    const unitChanges: UnitVerification[] = [];
    const count = Math.min(beforeUnits.length, afterUnits.length);
    for (let index = 0; index < count; index++) {
      const comparison = compareImages(beforeUnits[index], afterUnits[index]);
      unitChanges.push({ index, changedRatio: comparison.ratio });
    }
    const collateralUnits = targetUnit === undefined
      ? []
      : unitChanges.filter(unit => unit.index !== targetUnit && unit.changedRatio > 0.001);
    const targetChanged = targetUnit === undefined
      ? full.ratio > 0.0001
      : (unitChanges.find(unit => unit.index === targetUnit)?.changedRatio ?? full.ratio) > 0.0001;
    await context.close();
    return {
      available: true,
      targetChanged,
      changedRatio: full.ratio,
      collateralUnits,
      overflow: afterDiagnostics.overflow.length > 0,
      overflowElements: afterDiagnostics.overflow,
      overlaps: afterDiagnostics.overlaps,
      beforeShot: toDataUrl(beforeShot),
      afterShot: toDataUrl(afterShot),
      diffShot: toDataUrl(full.diff),
    };
  } catch (error) {
    return {
      available: false,
      targetChanged: false,
      changedRatio: 0,
      collateralUnits: [],
      overflow: false,
      overflowElements: [],
      overlaps: [],
      warning: error instanceof Error && /browserType\.launch|Target page, context or browser has been closed/.test(error.message)
        ? "无法启动用于视觉验证的 Chrome。请检查浏览器安装或配置 PLAYWRIGHT_CHROMIUM_EXECUTABLE。"
        : error instanceof Error ? error.message.split("\n")[0] : "视觉验证不可用",
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function verifyHtmlCandidate(
  baselineHtml: string,
  candidateHtml: string,
  directory: string,
  targetUnit?: number,
): Promise<VerificationResult> {
  const root = path.resolve(directory);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname === "/preview") {
        const html = url.searchParams.get("version") === "baseline" ? baselineHtml : candidateHtml;
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(injectPreview(html));
        return;
      }
      if (url.pathname.startsWith("/target-assets/")) {
        const relative = decodeURIComponent(url.pathname.slice("/target-assets/".length));
        const filePath = path.resolve(root, relative);
        if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
          response.writeHead(403).end();
          return;
        }
        const contents = await readFile(filePath);
        response.writeHead(200, { "content-type": CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
        response.end(contents);
        return;
      }
      response.writeHead(404).end();
    } catch {
      response.writeHead(404).end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法启动本地视觉验证服务");
  try {
    return await verifyCandidate(`http://127.0.0.1:${address.port}`, targetUnit);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
