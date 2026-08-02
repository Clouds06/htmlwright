import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import type { EditRequest, ElementSummary, ProviderName, ProviderStatus, QuickEditRequest, Scope, VerificationResult } from "./types.ts";
import { createProvider } from "./providers.ts";
import { verifyCandidate, verifyHtmlCandidate } from "./verifier.ts";
import { applyQuickEdit } from "./quick-edit.ts";

export interface PendingEdit {
  id: string;
  intent: string;
  diff: string;
  verification: VerificationResult;
  createdAt: string;
  changes: ChangeRecord[];
}

export interface ChangeRecord {
  id: string;
  kind: "ai" | "quick";
  intent: string;
  scope: Scope;
  provider?: ProviderName;
  target?: {
    tag: string;
    breadcrumb?: string;
    text: string;
    sourcePath?: number[];
    unitIndex?: number;
  };
  createdAt: string;
  legacy?: boolean;
}

interface StoredPendingEdit {
  filePath: string;
  diskHash: string;
  baselineHtml: string;
  candidateHtml: string;
  pending: PendingEdit;
  changeSnapshots?: Record<string, string>;
}

function targetSummary(element?: ElementSummary): ChangeRecord["target"] {
  if (!element) return undefined;
  return {
    tag: element.tag,
    breadcrumb: element.breadcrumb,
    text: element.text.slice(0, 160),
    sourcePath: element.sourcePath,
    unitIndex: element.unitIndex,
  };
}

function quickEditIntent(request: QuickEditRequest): string {
  const details = [
    request.changes.text !== undefined && `文字改为“${request.changes.text.slice(0, 80)}${request.changes.text.length > 80 ? "…" : ""}”`,
    request.changes.color !== undefined && `文字颜色 ${request.changes.color}`,
    request.changes.backgroundColor !== undefined && `背景颜色 ${request.changes.backgroundColor}`,
    request.changes.fontSize !== undefined && `字号 ${request.changes.fontSize}px`,
  ].filter(Boolean);
  return `快速编辑：${details.join("；")}`;
}

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export class ProjectSession {
  filePath: string;
  directory: string;
  readonly root: string;
  diskHtml: string;
  candidateHtml: string;
  baselineHtml: string;
  pending?: PendingEdit;
  conflict = false;
  private undoStack: string[] = [];
  private changeSnapshots: Record<string, string> = {};
  private expectedDiskHtml?: string;

  private constructor(filePath: string, html: string, readonly inPlace: boolean) {
    this.filePath = filePath;
    this.directory = path.dirname(filePath);
    this.root = path.dirname(filePath);
    this.diskHtml = html;
    this.candidateHtml = html;
    this.baselineHtml = html;
  }

  // Re-target the session to another local HTML file. The previous file's persisted
  // pending is left on disk, so switching back restores it.
  async openFile(target: string): Promise<void> {
    const resolved = path.resolve(target);
    if (path.extname(resolved).toLowerCase() !== ".html") throw new Error("只支持 .html 文件");
    const html = await readFile(resolved, "utf8");
    this.filePath = resolved;
    this.directory = path.dirname(resolved);
    this.diskHtml = html;
    this.candidateHtml = html;
    this.baselineHtml = html;
    this.pending = undefined;
    this.changeSnapshots = {};
    this.conflict = false;
    this.undoStack = [];
    this.expectedDiskHtml = undefined;
    await this.restorePending();
  }

  static async create(filePath: string, inPlace = false): Promise<ProjectSession> {
    const html = await readFile(filePath, "utf8");
    const session = new ProjectSession(filePath, html, inPlace);
    await session.restorePending();
    return session;
  }

  summary(providerStatuses: ProviderStatus[]) {
    return {
      file: { name: path.basename(this.filePath), path: this.filePath },
      pending: this.pending,
      conflict: this.conflict,
      canUndo: this.undoStack.length > 0,
      providers: providerStatuses,
      inPlace: this.inPlace,
    };
  }

  // Candidate HTML captured after each change, keyed by change id (persisted with the
  // pending edit). Lets the UI replay any step; falls back to the latest candidate when
  // a step has no snapshot (e.g. a pending restored from an older format).
  changeSnapshot(index: number): string {
    const change = this.pending?.changes[index];
    return (change && this.changeSnapshots[change.id]) || this.candidateHtml;
  }

  async edit(request: EditRequest, baseUrl?: string): Promise<PendingEdit> {
    if (!request.intent.trim()) throw new Error("请输入修改意图");
    if (request.scope === "element" && !request.selectedElement) throw new Error("元素范围需要先选择一个元素");
    if (this.conflict) throw new Error("原文件已在外部变化，请先刷新或拒绝当前候选改动");
    const provider = createProvider(request.provider);
    const providerStatus = await provider.status();
    if (!providerStatus.available) throw new Error(providerStatus.message);
    this.baselineHtml = this.candidateHtml;
    const result = await provider.edit({ ...request, fullFile: this.candidateHtml, relatedCSS: [] });
    if (result.html.trim() === this.candidateHtml.trim()) throw new Error("模型返回内容与当前文件一致，没有可审核的改动");
    this.candidateHtml = result.html;
    const diff = createTwoFilesPatch(path.basename(this.filePath), `${path.basename(this.filePath)} (candidate)`, this.diskHtml, this.candidateHtml, "磁盘版本", "累计候选", { context: 4 });
    const targetUnit = request.scope === "document" ? undefined : request.unitIndex;
    const verification = baseUrl
      ? await verifyCandidate(baseUrl, targetUnit)
      : await verifyHtmlCandidate(this.baselineHtml, this.candidateHtml, this.directory, targetUnit);
    const createdAt = new Date().toISOString();
    const change: ChangeRecord = {
      id: crypto.randomUUID(),
      kind: "ai",
      intent: request.intent.trim(),
      scope: request.scope,
      provider: request.provider,
      target: targetSummary(request.selectedElement),
      createdAt,
    };
    const pending = {
      id: crypto.randomUUID(),
      intent: change.intent,
      diff,
      verification,
      createdAt,
      changes: [...this.pendingChanges(), change],
    };
    this.pending = pending;
    this.changeSnapshots[change.id] = this.candidateHtml;
    await this.persistPending();
    if (this.inPlace) await this.accept();
    return pending;
  }

  async quickEdit(request: QuickEditRequest): Promise<PendingEdit> {
    if (this.conflict) throw new Error("原文件已在外部变化，请先拒绝当前候选改动");
    this.baselineHtml = this.candidateHtml;
    const nextHtml = applyQuickEdit(this.candidateHtml, request);
    if (nextHtml === this.candidateHtml) throw new Error("快速编辑没有产生变化");
    this.candidateHtml = nextHtml;
    const diff = createTwoFilesPatch(path.basename(this.filePath), `${path.basename(this.filePath)} (candidate)`, this.diskHtml, this.candidateHtml, "磁盘版本", "累计候选", { context: 4 });
    const verification = await verifyHtmlCandidate(this.baselineHtml, this.candidateHtml, this.directory, request.unitIndex);
    const createdAt = new Date().toISOString();
    const intent = quickEditIntent(request);
    const change: ChangeRecord = {
      id: crypto.randomUUID(),
      kind: "quick",
      intent,
      scope: "element",
      target: targetSummary(request.selectedElement),
      createdAt,
    };
    const pending = {
      id: crypto.randomUUID(),
      intent,
      diff,
      verification,
      createdAt,
      changes: [...this.pendingChanges(), change],
    };
    this.pending = pending;
    this.changeSnapshots[change.id] = this.candidateHtml;
    await this.persistPending();
    if (this.inPlace) await this.accept();
    return pending;
  }

  async accept(): Promise<{ snapshot: string }> {
    if (!this.pending) throw new Error("没有待接受的改动");
    const snapshot = await this.snapshot(this.diskHtml);
    this.undoStack.push(snapshot);
    this.expectedDiskHtml = this.candidateHtml;
    await writeFile(this.filePath, this.candidateHtml, "utf8");
    this.diskHtml = this.candidateHtml;
    this.baselineHtml = this.candidateHtml;
    this.pending = undefined;
    this.changeSnapshots = {};
    this.conflict = false;
    await this.removePersistedPending();
    return { snapshot };
  }

  async reject(): Promise<void> {
    this.candidateHtml = this.diskHtml;
    this.baselineHtml = this.diskHtml;
    this.pending = undefined;
    this.changeSnapshots = {};
    this.conflict = false;
    await this.removePersistedPending();
  }

  async undo(): Promise<{ restored: string }> {
    if (this.pending) await this.reject();
    const previous = this.undoStack.pop();
    if (!previous) throw new Error("没有可撤销的写回记录");
    const restored = await readFile(previous, "utf8");
    await this.snapshot(this.diskHtml, "before-undo");
    this.expectedDiskHtml = restored;
    await writeFile(this.filePath, restored, "utf8");
    this.diskHtml = restored;
    this.candidateHtml = restored;
    this.baselineHtml = restored;
    return { restored: previous };
  }

  async onExternalChange(): Promise<"ignored" | "reloaded" | "conflict"> {
    const html = await readFile(this.filePath, "utf8");
    if (this.expectedDiskHtml !== undefined && html === this.expectedDiskHtml) {
      this.expectedDiskHtml = undefined;
      return "ignored";
    }
    if (html === this.diskHtml) return "ignored";
    if (this.pending) {
      this.conflict = true;
      return "conflict";
    }
    this.diskHtml = html;
    this.candidateHtml = html;
    this.baselineHtml = html;
    this.changeSnapshots = {};
    return "reloaded";
  }

  private async snapshot(content: string, suffix = "before-edit"): Promise<string> {
    const directory = path.join(this.directory, ".htmlwright", "snapshots");
    await mkdir(directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const snapshot = path.join(directory, `${stamp}-${suffix}-${path.basename(this.filePath)}`);
    await writeFile(snapshot, content, "utf8");
    return snapshot;
  }

  private get pendingFile(): string {
    return path.join(this.directory, ".htmlwright", `pending-${path.basename(this.filePath)}.json`);
  }

  private pendingChanges(): ChangeRecord[] {
    if (!this.pending) return [];
    if (Array.isArray(this.pending.changes) && this.pending.changes.length) return this.pending.changes;
    return [{
      id: this.pending.id,
      kind: "ai",
      intent: this.pending.intent,
      scope: "document",
      createdAt: this.pending.createdAt,
      legacy: true,
    }];
  }

  private async persistPending(): Promise<void> {
    if (!this.pending) return;
    await mkdir(path.dirname(this.pendingFile), { recursive: true });
    const stored: StoredPendingEdit = {
      filePath: this.filePath,
      diskHash: contentHash(this.diskHtml),
      baselineHtml: this.baselineHtml,
      candidateHtml: this.candidateHtml,
      pending: this.pending,
      changeSnapshots: this.changeSnapshots,
    };
    await writeFile(this.pendingFile, JSON.stringify(stored), "utf8");
  }

  private async restorePending(): Promise<void> {
    try {
      const stored = JSON.parse(await readFile(this.pendingFile, "utf8")) as StoredPendingEdit;
      if (stored.filePath !== this.filePath || stored.diskHash !== contentHash(this.diskHtml) || !stored.pending?.id) return;
      this.baselineHtml = stored.baselineHtml;
      this.candidateHtml = stored.candidateHtml;
      this.pending = {
        ...stored.pending,
        changes: Array.isArray(stored.pending.changes) && stored.pending.changes.length
          ? stored.pending.changes
          : [{
            id: stored.pending.id,
            kind: "ai",
            intent: stored.pending.intent,
            scope: "document",
            createdAt: stored.pending.createdAt,
            legacy: true,
          }],
      };
      this.changeSnapshots = stored.changeSnapshots ?? {};
    } catch { /* no valid pending edit to restore */ }
  }

  private async removePersistedPending(): Promise<void> {
    await unlink(this.pendingFile).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}
