import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, ArrowLeft, ArrowUp, Check, CheckCircle2, ChevronDown, ChevronRight, Eye, FileCode2,
  Focus, Folder, Layers, LoaderCircle, MousePointer2, PanelLeft, PanelLeftClose, Plus, RefreshCw,
  Send, Settings, ShieldCheck, Sparkles, Trash2, Undo2, Wand2, X, XCircle,
} from "lucide-react";

type Scope = "element" | "page" | "document";
type ProviderName = "claude-code" | "anthropic-api" | "openai-compatible" | "demo";

interface ProviderStatus { name: ProviderName; available: boolean; message: string }
interface ComputedStyle { color?: string; backgroundColor?: string; fontSize?: string }
interface ElementSummary { id?: string; tag: string; classes: string[]; text: string; outerHTML: string; breadcrumb?: string; unitIndex?: number; sourcePath?: number[]; editableText?: string; computedStyle?: ComputedStyle }
interface Unit { index: number; title: string; tag: string }
interface ChangeRecord { id: string; kind: "ai" | "quick"; intent: string; scope: Scope | "unit"; provider?: ProviderName; target?: { tag: string; breadcrumb?: string; text: string; unitIndex?: number; sourcePath?: number[] }; createdAt: string }
interface Verification {
  available: boolean; targetChanged: boolean; changedRatio: number; collateralUnits: Array<{ index: number; changedRatio: number }>;
  overflow: boolean; overflowElements: string[]; overlaps: string[]; beforeShot?: string; afterShot?: string; diffShot?: string; warning?: string;
}
interface PendingEdit { id: string; intent: string; diff: string; verification: Verification; createdAt: string; changes: ChangeRecord[] }
interface Settings { claudeExecutable?: string; defaultClaudeExecutable?: string; openaiApiKey?: string; openaiBaseUrl?: string; openaiModel?: string }
interface AppState {
  file: { name: string; path: string }; pending?: PendingEdit; conflict: boolean; canUndo: boolean; providers: ProviderStatus[]; inPlace: boolean; apiToken: string; previewUrl: string; settings?: Settings;
}
interface QueuedJob { id: string; intent: string; scope: Scope; provider: ProviderName; selectedElement?: ElementSummary; unitIndex?: number; targetLabel: string }
interface QuickState { text: string; color: string; backgroundColor: string; fontSize: string }
interface SettingsForm { claudeExecutable: string; openaiApiKey: string; openaiBaseUrl: string; openaiModel: string }

const providerLabel: Record<ProviderName, string> = { "claude-code": "Claude Code", "anthropic-api": "Anthropic API", "openai-compatible": "OpenAI-compatible", demo: "本地演示" };
const scopeLabels: Record<Scope, string> = { element: "这一处", page: "这一页", document: "整个文件" };
const openaiPresets = [
  { label: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-4o" },
  { label: "OpenRouter", base: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-4-5" },
  { label: "本地 Ollama", base: "http://localhost:11434/v1", model: "llama3.1" },
];
let apiToken = "";
let jobSeed = 0;
const shortcutHint = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘↵" : "Ctrl+↵";

function rgbToHex(value?: string): string | undefined {
  if (!value) return undefined;
  const parts = value.match(/\d+/g);
  if (!parts || parts.length < 3) return undefined;
  return "#" + parts.slice(0, 3).map(part => Number(part).toString(16).padStart(2, "0")).join("");
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(apiToken ? { "x-htmlwright-token": apiToken } : {}), ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
  return body as T;
}

export function App() {
  const [state, setState] = useState<AppState>();
  const [intent, setIntent] = useState("");
  const [scope, setScope] = useState<Scope>("document");
  const [provider, setProvider] = useState<ProviderName>("claude-code");
  const [selectionMode, setSelectionMode] = useState(true);
  const [selected, setSelected] = useState<ElementSummary>();
  const [quick, setQuick] = useState<QuickState>();
  const [breadcrumbs, setBreadcrumbs] = useState<ElementSummary[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [activeUnitIndex, setActiveUnitIndex] = useState<number>();
  const [mode, setMode] = useState<"unit" | "page">("page");
  const [previewKey, setPreviewKey] = useState(0);
  const [queue, setQueue] = useState<QueuedJob[]>([]);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string }>();
  const [centerView, setCenterView] = useState<"preview" | "before" | "diff">("preview");
  const [viewingChange, setViewingChange] = useState<number>();
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState<SettingsForm>({ claudeExecutable: "", openaiApiKey: "", openaiBaseUrl: "", openaiModel: "" });
  const [showFiles, setShowFiles] = useState(false);
  const [browse, setBrowse] = useState<{ dir: string; parent: string | null; dirs: Array<{ name: string; path: string }>; files: Array<{ name: string; path: string }> }>();
  const [fileHistory, setFileHistory] = useState<string[]>([]);
  const [leftWidth, setLeftWidth] = useState(220);
  const [rightWidth, setRightWidth] = useState(390);
  const [isResizing, setIsResizing] = useState(false);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const selectionModeRef = useRef(selectionMode);
  useEffect(() => { selectionModeRef.current = selectionMode; }, [selectionMode]);
  const multiPage = units.length > 1;

  const refreshState = useCallback(async () => {
    const next = await api<AppState>("/api/state");
    apiToken = next.apiToken;
    setState(next);
    const current = next.providers.find(item => item.name === provider);
    if (current && !current.available) {
      const fallback = next.providers.find(item => item.available);
      if (fallback) setProvider(fallback.name);
    }
  }, [provider]);

  useEffect(() => { refreshState().catch(error => setNotice({ kind: "error", text: error.message })); }, []);
  useEffect(() => {
    const events = new EventSource("/api/events");
    events.addEventListener("state", event => setState(JSON.parse((event as MessageEvent).data)));
    events.addEventListener("preview", () => { setPreviewKey(value => value + 1); setSelected(undefined); setBreadcrumbs([]); });
    return () => events.close();
  }, []);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === "htmlwright:ready") {
        const nextUnits = event.data.units || [];
        setUnits(nextUnits);
        setActiveUnitIndex(current => current ?? nextUnits[0]?.index);
        setMode(event.data.mode === "unit" ? "unit" : "page");
        // A freshly loaded preview defaults to select mode; re-assert the current mode
        // now that the bridge is listening (avoids a race with the mode message).
        iframeRef.current?.contentWindow?.postMessage({ type: "htmlwright:selection-mode", enabled: selectionModeRef.current }, "*");
      }
      if (event.data?.type === "htmlwright:selected") {
        setSelected(event.data.element);
        setBreadcrumbs(event.data.breadcrumbs || []);
        if (event.data.element?.unitIndex !== undefined) setActiveUnitIndex(event.data.element.unitIndex);
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: "htmlwright:selection-mode", enabled: selectionMode }, "*");
  }, [selectionMode, previewKey]);

  // Selecting an element narrows scope to "这一处"; clearing it reverts to whole file.
  useEffect(() => { setScope(selected ? "element" : current => (current === "element" ? "document" : current)); }, [selected]);
  // "这一页" only exists for multi-page documents.
  useEffect(() => { if (!multiPage) setScope(current => (current === "page" ? "document" : current)); }, [multiPage]);
  // No candidate → the workspace can only show the live preview.
  useEffect(() => { if (!state?.pending) { setViewingChange(undefined); setCenterView("preview"); } }, [state?.pending]);

  useEffect(() => {
    if (!selected) { setQuick(undefined); return; }
    setQuick({
      text: selected.editableText ?? "",
      color: rgbToHex(selected.computedStyle?.color) ?? "#111111",
      backgroundColor: rgbToHex(selected.computedStyle?.backgroundColor) ?? "#ffffff",
      fontSize: String(parseInt(selected.computedStyle?.fontSize ?? "", 10) || ""),
    });
  }, [selected]);

  const run = useCallback(async (label: string, path: string, body?: unknown) => {
    setBusy(label); setNotice(undefined);
    try {
      await api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      await refreshState();
      setNotice({ kind: "success", text: label });
      if (path === "/api/quick-edit") { setViewingChange(undefined); setCenterView("preview"); }
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "操作失败" });
    } finally { setBusy(undefined); }
  }, [refreshState]);

  // Serial generation queue: users can enqueue while a job runs; the server folds
  // each result into the same candidate, so jobs must not run concurrently.
  useEffect(() => {
    if (running || queue.length === 0) return;
    const job = queue[0];
    setRunning(true); setNotice(undefined);
    api("/api/edit", { method: "POST", body: JSON.stringify({ intent: job.intent, scope: job.scope, provider: job.provider, selectedElement: job.selectedElement, unitIndex: job.unitIndex }) })
      .then(() => refreshState())
      .then(() => { setViewingChange(undefined); setCenterView("preview"); })
      .catch(error => setNotice({ kind: "error", text: error instanceof Error ? error.message : "生成失败" }))
      .finally(() => { setQueue(list => list.slice(1)); setRunning(false); });
  }, [queue, running, refreshState]);

  const targetText = scope === "element"
    ? (selected ? `目标：${selected.breadcrumb || selected.tag}` : "请先在页面上点选一个元素")
    : scope === "page" ? "只改当前这一页" : "统一修改整个文件的所有内容";
  const scopeInvalid = scope === "element" && !selected;

  const enqueue = useCallback(() => {
    const text = intent.trim();
    if (!text || (scope === "element" && !selected)) return;
    setQueue(list => [...list, {
      id: `job-${++jobSeed}`,
      intent: text,
      scope,
      provider,
      selectedElement: selected,
      unitIndex: scope === "document" ? undefined : selected?.unitIndex ?? activeUnitIndex,
      targetLabel: selected?.breadcrumb ?? scopeLabels[scope],
    }]);
    setIntent("");
  }, [intent, scope, provider, selected, activeUnitIndex]);

  const applyQuick = useCallback(() => {
    if (!selected || !quick) return;
    const changes: { text?: string; color?: string; backgroundColor?: string; fontSize?: number } = {};
    if (selected.editableText !== undefined && quick.text !== (selected.editableText ?? "")) changes.text = quick.text;
    if (quick.color && quick.color !== rgbToHex(selected.computedStyle?.color)) changes.color = quick.color;
    if (quick.backgroundColor && quick.backgroundColor !== rgbToHex(selected.computedStyle?.backgroundColor)) changes.backgroundColor = quick.backgroundColor;
    const originalSize = parseInt(selected.computedStyle?.fontSize ?? "", 10);
    if (quick.fontSize && Number(quick.fontSize) !== originalSize) changes.fontSize = Number(quick.fontSize);
    if (Object.keys(changes).length === 0) { setNotice({ kind: "error", text: "没有可应用的快速改动" }); return; }
    run("快速调整已应用", "/api/quick-edit", { selectedElement: selected, changes, unitIndex: selected.unitIndex });
  }, [selected, quick, run]);

  const openSettings = useCallback(() => {
    const s = state?.settings;
    setSettingsForm({
      claudeExecutable: s?.claudeExecutable ?? s?.defaultClaudeExecutable ?? "",
      openaiApiKey: s?.openaiApiKey ?? "",
      openaiBaseUrl: s?.openaiBaseUrl ?? "",
      openaiModel: s?.openaiModel ?? "",
    });
    setShowSettings(true);
  }, [state]);
  const saveSettings = useCallback(async () => {
    try {
      await api("/api/configure", { method: "POST", body: JSON.stringify(settingsForm) });
      await refreshState();
      setShowSettings(false);
      setNotice({ kind: "success", text: "模型设置已保存" });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "保存失败" });
    }
  }, [settingsForm, refreshState]);

  const loadDir = useCallback(async (dir?: string) => {
    try {
      const data = await api<{ dir: string; parent: string | null; dirs: Array<{ name: string; path: string }>; files: Array<{ name: string; path: string }> }>(`/api/files${dir ? `?dir=${encodeURIComponent(dir)}` : ""}`);
      setBrowse(data);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "读取目录失败" });
    }
  }, []);
  const openFileBrowser = useCallback(async () => { await loadDir(); setShowFiles(true); }, [loadDir]);
  const openFile = useCallback(async (targetPath: string) => {
    try {
      await api("/api/open", { method: "POST", body: JSON.stringify({ path: targetPath }) });
      setShowFiles(false);
      setFileHistory([]);
      setIntent(""); setQueue([]); setSelected(undefined);
      await refreshState();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "打开文件失败" });
    }
  }, [refreshState]);
  const goBack = useCallback(async () => {
    const previous = fileHistory[fileHistory.length - 1];
    if (!previous) return;
    setFileHistory(list => list.slice(0, -1));
    try {
      await api("/api/open", { method: "POST", body: JSON.stringify({ path: previous }) });
      setIntent(""); setQueue([]); setSelected(undefined);
      await refreshState();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "返回失败" });
    }
  }, [fileHistory, refreshState]);

  const startResize = useCallback((side: "left" | "right") => (event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startLeft = leftWidth;
    const startRight = rightWidth;
    setIsResizing(true);
    const onMove = (moveEvent: MouseEvent) => {
      if (side === "left") setLeftWidth(Math.min(480, Math.max(170, startLeft + (moveEvent.clientX - startX))));
      else setRightWidth(Math.min(680, Math.max(300, startRight - (moveEvent.clientX - startX))));
    };
    const onUp = () => {
      setIsResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [leftWidth, rightWidth]);

  // Clicking a local .html link in the preview (view mode) opens it for editing.
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type !== "htmlwright:navigate" || typeof event.data.file !== "string") return;
      const previous = state?.file.path;
      api("/api/open", { method: "POST", body: JSON.stringify({ relative: event.data.file }) })
        .then(() => { if (previous) setFileHistory(list => [...list, previous]); setIntent(""); setQueue([]); setSelected(undefined); return refreshState(); })
        .catch(error => setNotice({ kind: "error", text: error instanceof Error ? error.message : "打开链接失败" }));
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [state?.file.path, refreshState]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key === "Enter") { event.preventDefault(); if (intent.trim() && !scopeInvalid) enqueue(); }
      if (mod && event.shiftKey && event.key.toLowerCase() === "a" && state?.pending) { event.preventDefault(); run("改动已写回", "/api/accept"); }
      if (mod && event.shiftKey && event.key.toLowerCase() === "r" && state?.pending) { event.preventDefault(); run("候选改动已拒绝", "/api/reject"); }
      if (mod && event.key.toLowerCase() === "z" && state?.canUndo && !intent) { event.preventDefault(); run("已撤销上次写回", "/api/undo"); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [intent, scopeInvalid, enqueue, run, state]);

  const verification = state?.pending?.verification;
  const reviewImage = useMemo(() => {
    if (!verification || centerView !== "before") return undefined;
    return verification.beforeShot;
  }, [verification, centerView]);
  const activeProvider = state?.providers.find(item => item.name === provider);
  const changes = state?.pending?.changes ?? [];
  const canEnqueue = Boolean(intent.trim()) && Boolean(activeProvider?.available) && !scopeInvalid;
  const actionBusy = Boolean(busy) || running;
  const scopeButtons: Scope[] = multiPage ? ["element", "page", "document"] : ["element", "document"];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Focus size={18} /></span><strong>htmlwright</strong></div>
        <div className="file-cell">
          {fileHistory.length > 0 && <button className="back-btn" onClick={goBack} title="返回上一个文件"><ArrowLeft size={15} />返回</button>}
          <button className="file-identity" onClick={openFileBrowser} title="切换文件"><FileCode2 size={16} /><span>{state?.file.name || "正在载入文件"}</span><ChevronDown size={14} /></button>
        </div>
        <div className="header-status">
          <span className={`mode-badge ${mode}`}><span className="status-dot" />{mode === "unit" ? "内容单元模式" : "整页模式"}</span>
        </div>
      </header>

      {state?.conflict && <div className="conflict-banner"><AlertCircle size={16} />原文件在外部发生变化，当前候选已暂停写回。请拒绝候选后重新加载。</div>}

      <div className={`workspace ${isResizing ? "resizing" : ""} ${outlineCollapsed ? "left-collapsed" : ""}`} style={{ "--left": outlineCollapsed ? "0px" : `${leftWidth}px`, "--right": `${rightWidth}px` } as React.CSSProperties}>
        <aside className="outline-panel">
          <div className="panel-heading"><h2>{mode === "unit" ? "内容单元" : "页面大纲"}</h2><button className="icon-btn-sm" onClick={() => setOutlineCollapsed(true)} title="收起大纲"><PanelLeftClose size={17} /></button></div>
          <div className="unit-list">
            {units.length > 0 ? units.map(unit => (
              <button key={unit.index} className={`unit-row ${activeUnitIndex === unit.index ? "active" : ""}`} onClick={() => { setActiveUnitIndex(unit.index); iframeRef.current?.contentWindow?.postMessage({ type: "htmlwright:scroll-unit", index: unit.index }, "*"); }}>
                <span className="unit-index">{String(unit.index + 1).padStart(2, "0")}</span><span><strong>{unit.title}</strong><small>{unit.tag}</small></span><ChevronRight size={15} />
              </button>
            )) : <div className="empty-outline"><FileCode2 size={22} /><p>当前页面按整页处理</p><span>选择预览中的元素开始编辑</span></div>}
          </div>
          <div className="mode-note"><ShieldCheck size={15} /><span>{mode === "unit" ? "可检测非目标单元的意外变化" : "未识别到稳定单元结构，越界检测能力较弱"}</span></div>
        </aside>

        <section className="preview-panel">
          {!outlineCollapsed && <div className="col-resizer left" onMouseDown={startResize("left")} title="拖动调整宽度" />}
          <div className="col-resizer right" onMouseDown={startResize("right")} title="拖动调整宽度" />
          <div className="workspace-toolbar">
            <div className="tb-left">
            {outlineCollapsed && <button className="icon-button" onClick={() => setOutlineCollapsed(false)} title="展开大纲"><PanelLeft size={16} /></button>}
            <div className="view-tabs">
              <button className={centerView === "preview" ? "active" : ""} onClick={() => { setViewingChange(undefined); setCenterView("preview"); }} title="当前效果，可点选元素编辑">预览</button>
              {([["before", "改动前", "改动前的原始样子"], ["diff", "代码差异", "改动的代码 diff"]] as const).map(([value, label, tip]) => (
                <button key={value} disabled={!state?.pending} className={centerView === value ? "active" : ""} onClick={() => setCenterView(value)} title={tip}>{label}</button>
              ))}
            </div>
            </div>
            {centerView === "preview" && (
              <div className="toolbar-right">
                {viewingChange !== undefined ? (
                  <div className="version-banner"><span>正在看第 {viewingChange + 1} 步的版本</span><button onClick={() => { setViewingChange(undefined); setPreviewKey(value => value + 1); }}>回到最新</button></div>
                ) : (
                  <>
                    <div className="tool-group">
                      <button className={selectionMode ? "tool-button active" : "tool-button"} onClick={() => setSelectionMode(true)} title="选择元素进行编辑"><MousePointer2 size={16} /><span>选择</span></button>
                      <button className={!selectionMode ? "tool-button active" : "tool-button"} onClick={() => setSelectionMode(false)} title="纯查看模式：只浏览页面，不选择元素"><Eye size={16} /><span>查看</span></button>
                    </div>
                    <button className="icon-button" onClick={() => setPreviewKey(value => value + 1)} title="重新载入预览"><RefreshCw size={16} /></button>
                  </>
                )}
              </div>
            )}
          </div>
          {centerView === "preview" && (
            <div className="breadcrumb-bar">
              {breadcrumbs.length ? breadcrumbs.map((item, index) => (
                <span key={`${item.id}-${index}`} className="breadcrumb-item"><button onClick={() => iframeRef.current?.contentWindow?.postMessage({ type: "htmlwright:select-id", id: item.id }, "*")}>{item.breadcrumb}</button>{index < breadcrumbs.length - 1 && <ChevronRight size={13} />}</span>
              )) : <span className="breadcrumb-placeholder">尚未选择元素</span>}
            </div>
          )}
          <div className="stage">
            <div className="preview-frame" style={{ display: centerView === "preview" ? "block" : "none" }}>
              <iframe
                key={previewKey}
                ref={iframeRef}
                title="HTML 文件预览"
                src={`/preview?version=candidate${viewingChange !== undefined ? `&change=${viewingChange}` : ""}&t=${previewKey}`}
                onLoad={() => {
                  if (viewingChange === undefined) return;
                  const sourcePath = changes[viewingChange]?.target?.sourcePath;
                  if (sourcePath) iframeRef.current?.contentWindow?.postMessage({ type: "htmlwright:locate", sourcePath }, "*");
                }}
              />
            </div>
            {centerView === "diff" && state?.pending && <DiffView diff={state.pending.diff} />}
            {centerView === "before" && (
              <div className="stage-shot">{reviewImage ? <img src={reviewImage} alt="改动前截图" /> : <div className="shot-unavailable"><AlertCircle size={20} /><span>{verification?.warning || "截图不可用"}</span></div>}</div>
            )}
          </div>
          {state?.pending && (
            <div className="checks-bar"><VerificationChecks verification={verification} /></div>
          )}
        </section>

        <aside className="inspector-panel">
          <div className="model-bar">
            <span className="mb-label">模型</span>
            <div className="mb-right">
              <select value={provider} onChange={event => setProvider(event.target.value as ProviderName)}>
                {state?.providers.filter(item => item.name !== "demo" || item.available).map(item => <option key={item.name} value={item.name} disabled={!item.available}>{providerLabel[item.name]}{item.available ? "" : "（不可用）"}</option>)}
              </select>
              <button className="icon-btn-sm" onClick={openSettings} title="模型设置"><Settings size={15} /></button>
            </div>
          </div>

          <div className="inspector-scroll">
            <div className={`selection-summary ${selected ? "" : "empty"}`}>
              {selected ? <><span className="element-tag">{selected.tag}</span><div><strong>{selected.breadcrumb}</strong><small>{selected.text || "无文本内容"}</small></div><CheckCircle2 size={17} /></> : <><span className="selection-empty-icon"><MousePointer2 size={15} /></span><div><strong>尚未选择元素</strong><small>点选元素可快速调样式或用 AI 精修；未选则改整个文件</small></div></>}
            </div>

            {selected && quick && (
              <section className="card">
                <div className="card-head"><Wand2 size={15} /><h2>快速调整</h2><span className="status-chip">免 AI</span></div>
                {selected.editableText !== undefined && (
                  <textarea className="quick-text" value={quick.text} onChange={event => setQuick({ ...quick, text: event.target.value })} placeholder="编辑选中的文字" rows={2} />
                )}
                <div className="quick-style-row">
                  <label>文字色<input type="color" value={quick.color} onChange={event => setQuick({ ...quick, color: event.target.value })} /></label>
                  <label>背景色<input type="color" value={quick.backgroundColor} onChange={event => setQuick({ ...quick, backgroundColor: event.target.value })} /></label>
                  <label>字号<input type="number" min={6} max={200} value={quick.fontSize} onChange={event => setQuick({ ...quick, fontSize: event.target.value })} /></label>
                  <button className="btn-quick" disabled={Boolean(busy)} onClick={applyQuick}>{busy === "快速调整已应用" ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}应用</button>
                </div>
              </section>
            )}

            <section className="card">
              <div className="card-head"><Sparkles size={15} /><h2>用 AI 改</h2>{running && <LoaderCircle className="spin" size={17} />}</div>
              <span className="field-label">应用到</span>
              <div className="scope-control" aria-label="应用到">
                {scopeButtons.map(value => <button key={value} disabled={value === "element" && !selected} className={scope === value ? "active" : ""} onClick={() => setScope(value)}>{scopeLabels[value]}</button>)}
              </div>
              <p className={`intent-target ${scopeInvalid ? "invalid" : ""}`}>{targetText}</p>
              <textarea value={intent} onChange={event => setIntent(event.target.value)} placeholder="例如：把这个数字放大加粗，用品牌主色强调" rows={4} />
              <button className="primary-button" disabled={!canEnqueue} onClick={enqueue}>
                {running || queue.length > 0 ? <Plus size={17} /> : <Send size={17} />}
                {running || queue.length > 0 ? "加入生成队列" : "生成候选改动"}
                <span>{shortcutHint}</span>
              </button>
              {queue.length > 0 && (
                <div className="gen-queue-wrap">
                  <div className="subhead"><strong>生成队列</strong><span>{running ? "1 处理中" : "0 处理中"} · {running ? queue.length - 1 : queue.length} 等待</span></div>
                  <ul className="gen-queue">
                    {queue.map((job, index) => (
                      <li key={job.id}>
                        <span className={`gen-status ${index === 0 && running ? "active" : "waiting"}`}>{index === 0 && running ? "生成中" : "排队"}</span>
                        <span className="gen-body"><strong>{job.intent}</strong><small>{job.targetLabel} · {scopeLabels[job.scope]}</small></span>
                        {!(index === 0 && running) && <button className="gen-remove" title="移除" onClick={() => setQueue(list => list.filter(item => item.id !== job.id))}><Trash2 size={13} /></button>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {state?.pending && changes.length > 0 && (
              <section className="card">
                <div className="card-head"><Layers size={15} /><h2>候选改动</h2><span className="status-chip">{changes.length} 条</span></div>
                <ol className="change-list">
                  {changes.map((change, index) => (
                    <li key={change.id}>
                      <button className={`change-row ${viewingChange === index ? "active" : ""}`} onClick={() => { setViewingChange(index); setCenterView("preview"); }} title="查看这一步的版本，并在预览里定位到改动的元素">
                        <span className="change-index">{index + 1}</span>
                        <div className="change-body">
                          <span className="change-meta">{change.kind === "quick" ? "快速调整" : providerLabel[change.provider ?? "claude-code"]} · {scopeLabels[change.scope as Scope] ?? "当前单元"}{change.target?.breadcrumb ? ` · ${change.target.breadcrumb}` : ""}</span>
                          <p>{change.intent}</p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ol>
                <p className="foot-hint">点某一步可回看当时的版本并定位元素；累计修改后一起写回。</p>
              </section>
            )}

            {!state?.pending && (
              <div className="card empty-review"><ShieldCheck size={26} /><strong>等待候选改动</strong><span>生成候选后，中间工作区会显示改前/改后对比与代码差异。</span></div>
            )}
          </div>

          <div className="action-bar">
            <button className="reject-button" disabled={!state?.pending || actionBusy} onClick={() => run("候选改动已拒绝", "/api/reject")}><X size={17} />拒绝</button>
            <button className="undo-button" disabled={!state?.canUndo || actionBusy} onClick={() => run("已撤销上次写回", "/api/undo")}><Undo2 size={17} /></button>
            <button className="accept-button" disabled={!state?.pending || actionBusy || state.conflict} onClick={() => run("改动已写回", "/api/accept")}><Check size={17} />接受并写回</button>
          </div>
        </aside>
      </div>

      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={event => event.stopPropagation()}>
            <div className="modal-head"><div><span className="eyebrow">设置</span><strong>AI 模型设置</strong></div><button className="icon-btn-sm" onClick={() => setShowSettings(false)}><X size={16} /></button></div>
            <div className="settings-group">
              <div className="settings-group-head">Claude Code · 订阅，零配置</div>
              <label>可执行文件路径</label>
              <input value={settingsForm.claudeExecutable} spellCheck={false} onChange={event => setSettingsForm({ ...settingsForm, claudeExecutable: event.target.value })} placeholder="~/.local/bin/claude" />
            </div>
            <div className="settings-group">
              <div className="settings-group-head">OpenAI 兼容 · 用自己的 Key</div>
              <div className="preset-row">
                {openaiPresets.map(preset => <button key={preset.label} type="button" className="chip" onClick={() => setSettingsForm({ ...settingsForm, openaiBaseUrl: preset.base, openaiModel: preset.model })}>{preset.label}</button>)}
              </div>
              <label>API Key</label>
              <input type="password" value={settingsForm.openaiApiKey} spellCheck={false} autoComplete="off" onChange={event => setSettingsForm({ ...settingsForm, openaiApiKey: event.target.value })} placeholder="sk-…（本地 Ollama 随便填）" />
              <label>Base URL</label>
              <input value={settingsForm.openaiBaseUrl} spellCheck={false} onChange={event => setSettingsForm({ ...settingsForm, openaiBaseUrl: event.target.value })} placeholder="https://api.openai.com/v1" />
              <label>模型</label>
              <input value={settingsForm.openaiModel} spellCheck={false} onChange={event => setSettingsForm({ ...settingsForm, openaiModel: event.target.value })} placeholder="gpt-4o" />
            </div>
            <div className="modal-actions">
              <button className="btn-modal-cancel" onClick={() => setShowSettings(false)}>取消</button>
              <button className="btn-modal-save" onClick={saveSettings}>保存</button>
            </div>
          </div>
        </div>
      )}

      {showFiles && (
        <div className="modal-backdrop" onClick={() => setShowFiles(false)}>
          <div className="modal" onClick={event => event.stopPropagation()}>
            <div className="modal-head"><div><span className="eyebrow">浏览本机目录</span><strong>打开文件</strong></div><button className="icon-btn-sm" onClick={() => setShowFiles(false)}><X size={16} /></button></div>
            <div className="dir-path" title={browse?.dir}>{browse?.dir || "…"}</div>
            <ul className="file-list">
              {browse?.parent && <li><button className="file-row is-dir" onClick={() => loadDir(browse.parent!)}><ArrowUp size={15} /><span className="file-rel">..（上一级）</span></button></li>}
              {browse?.dirs.map(item => (
                <li key={item.path}><button className="file-row is-dir" onClick={() => loadDir(item.path)}><Folder size={15} /><span className="file-rel">{item.name}</span><ChevronRight size={14} /></button></li>
              ))}
              {browse?.files.map(item => (
                <li key={item.path}><button className={`file-row ${item.path === state?.file.path ? "active" : ""}`} onClick={() => openFile(item.path)}><FileCode2 size={15} /><span className="file-rel">{item.name}</span>{item.path === state?.file.path && <Check size={14} />}</button></li>
              ))}
              {browse && browse.dirs.length === 0 && browse.files.length === 0 && <li className="file-empty">此目录没有子目录或 HTML 文件</li>}
            </ul>
          </div>
        </div>
      )}

      {notice && <button className={`toast ${notice.kind}`} onClick={() => setNotice(undefined)}>{notice.kind === "error" ? <XCircle size={17} /> : <CheckCircle2 size={17} />}<span>{notice.text}</span><X size={14} /></button>}
    </main>
  );
}

function VerificationChecks({ verification }: { verification?: Verification }) {
  if (!verification?.available) return <div className="check-list"><div className="check warning"><AlertCircle size={15} /><span>视觉验证未完成</span></div></div>;
  const checks = [
    { ok: verification.targetChanged, label: verification.targetChanged ? `目标已变化 · ${(verification.changedRatio * 100).toFixed(2)}%` : "目标区域没有可见变化" },
    { ok: verification.collateralUnits.length === 0, label: verification.collateralUnits.length ? `${verification.collateralUnits.length} 个非目标单元发生变化` : "未发现跨单元改动" },
    { ok: !verification.overflow, label: verification.overflow ? `发现 ${verification.overflowElements.length} 处内容溢出` : "未发现内容溢出" },
    { ok: verification.overlaps.length === 0, label: verification.overlaps.length ? `发现 ${verification.overlaps.length} 组疑似重叠` : "未发现高风险重叠" },
  ];
  return <div className="check-list">{checks.map(item => <div className={`check ${item.ok ? "passed" : "warning"}`} key={item.label}>{item.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}<span>{item.label}</span></div>)}</div>;
}

function DiffView({ diff }: { diff: string }) {
  return <div className="diff-view"><div className="diff-meta"><span><i className="added" />新增</span><span><i className="removed" />删除</span></div><pre>{diff.split("\n").map((line, index) => <code key={index} className={line.startsWith("+") && !line.startsWith("+++") ? "line-added" : line.startsWith("-") && !line.startsWith("---") ? "line-removed" : line.startsWith("@@") ? "line-hunk" : ""}><span>{index + 1}</span>{line || " "}</code>)}</pre></div>;
}
