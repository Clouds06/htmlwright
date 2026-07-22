import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, Check, CheckCircle2, ChevronRight, Code2, Eye, FileCode2,
  Focus, LoaderCircle, MousePointer2, PanelLeftClose, RefreshCw, RotateCcw,
  Send, ShieldCheck, Sparkles, Undo2, X, XCircle,
} from "lucide-react";

type Scope = "element" | "unit" | "page" | "document";
type ProviderName = "claude-code" | "anthropic-api" | "openai-compatible" | "demo";

interface ProviderStatus { name: ProviderName; available: boolean; message: string }
interface ElementSummary { id?: string; tag: string; classes: string[]; text: string; outerHTML: string; breadcrumb?: string; unitIndex?: number }
interface Unit { index: number; title: string; tag: string }
interface Verification {
  available: boolean; targetChanged: boolean; changedRatio: number; collateralUnits: Array<{ index: number; changedRatio: number }>;
  overflow: boolean; overflowElements: string[]; overlaps: string[]; beforeShot?: string; afterShot?: string; diffShot?: string; warning?: string;
}
interface PendingEdit { id: string; intent: string; diff: string; verification: Verification; createdAt: string }
interface AppState {
  file: { name: string; path: string }; pending?: PendingEdit; conflict: boolean; canUndo: boolean; providers: ProviderStatus[]; inPlace: boolean; apiToken: string; previewUrl: string;
}

const providerLabel: Record<ProviderName, string> = { "claude-code": "Claude Code", "anthropic-api": "Anthropic API", "openai-compatible": "OpenAI-compatible", demo: "本地演示" };
const scopeOptions: Array<{ value: Scope; label: string; title: string }> = [
  { value: "element", label: "元素", title: "只修改当前选中的元素" },
  { value: "unit", label: "当前单元", title: "只修改元素所在的内容单元" },
  { value: "page", label: "整页", title: "只修改当前 PPT 页或文档页面" },
  { value: "document", label: "整个 HTML", title: "允许统一修改全部页面与全局风格" },
];
let apiToken = "";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(apiToken ? { "x-htmlwright-token": apiToken } : {}), ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
  return body as T;
}

export function App() {
  const [state, setState] = useState<AppState>();
  const [intent, setIntent] = useState("");
  const [scope, setScope] = useState<Scope>("element");
  const [provider, setProvider] = useState<ProviderName>("claude-code");
  const [selectionMode, setSelectionMode] = useState(true);
  const [selected, setSelected] = useState<ElementSummary>();
  const [breadcrumbs, setBreadcrumbs] = useState<ElementSummary[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [activeUnitIndex, setActiveUnitIndex] = useState<number>();
  const [mode, setMode] = useState<"unit" | "page">("page");
  const [previewKey, setPreviewKey] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string }>();
  const [reviewTab, setReviewTab] = useState<"visual" | "code">("visual");
  const [visualFrame, setVisualFrame] = useState<"before" | "after" | "diff">("after");
  const iframeRef = useRef<HTMLIFrameElement>(null);

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
      }
      if (event.data?.type === "htmlwright:selected") {
        setSelected(event.data.element);
        setBreadcrumbs(event.data.breadcrumbs || []);
        if (event.data.element?.unitIndex !== undefined) {
          setActiveUnitIndex(event.data.element.unitIndex);
          setScope("unit");
        }
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: "htmlwright:selection-mode", enabled: selectionMode }, "*");
  }, [selectionMode, previewKey]);

  const run = useCallback(async (label: string, path: string, body?: unknown) => {
    setBusy(label); setNotice(undefined);
    try {
      await api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      await refreshState();
      setNotice({ kind: "success", text: label });
      if (path === "/api/edit") setReviewTab("visual");
      setIntent("");
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "操作失败" });
    } finally { setBusy(undefined); }
  }, [refreshState]);

  const submit = useCallback(() => run("候选改动已生成", "/api/edit", {
    intent,
    scope,
    provider,
    selectedElement: selected,
    unitIndex: scope === "document" ? undefined : selected?.unitIndex ?? activeUnitIndex,
  }), [intent, scope, provider, selected, activeUnitIndex, run]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key === "Enter") { event.preventDefault(); if (intent.trim() && !busy) submit(); }
      if (mod && event.shiftKey && event.key.toLowerCase() === "a" && state?.pending) { event.preventDefault(); run("改动已写回", "/api/accept"); }
      if (mod && event.shiftKey && event.key.toLowerCase() === "r" && state?.pending) { event.preventDefault(); run("候选改动已拒绝", "/api/reject"); }
      if (mod && event.key.toLowerCase() === "z" && state?.canUndo && !intent) { event.preventDefault(); run("已撤销上次写回", "/api/undo"); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [busy, intent, run, state, submit]);

  const verification = state?.pending?.verification;
  const reviewImage = useMemo(() => {
    if (!verification) return undefined;
    if (visualFrame === "before") return verification.beforeShot;
    if (visualFrame === "diff") return verification.diffShot;
    return verification.afterShot;
  }, [verification, visualFrame]);
  const activeProvider = state?.providers.find(item => item.name === provider);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Focus size={18} /></span><strong>htmlwright</strong></div>
        <div className="file-identity" title={state?.file.path}><FileCode2 size={16} /><span>{state?.file.name || "正在载入文件"}</span></div>
        <div className="header-status">
          <span className={`mode-badge ${mode}`}><span className="status-dot" />{mode === "unit" ? "内容单元模式" : "整页模式"}</span>
          <span className={`provider-badge ${activeProvider?.available ? "ready" : "offline"}`} title={activeProvider?.message}><Sparkles size={14} />{providerLabel[provider]}</span>
        </div>
      </header>

      {state?.conflict && <div className="conflict-banner"><AlertCircle size={16} />原文件在外部发生变化，当前候选已暂停写回。请拒绝候选后重新加载。</div>}

      <div className="workspace">
        <aside className="outline-panel">
          <div className="panel-heading"><div><span className="eyebrow">DOCUMENT</span><h2>{mode === "unit" ? "内容单元" : "页面大纲"}</h2></div><PanelLeftClose size={17} /></div>
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
          <div className="preview-toolbar">
            <div className="tool-group">
              <button className={selectionMode ? "tool-button active" : "tool-button"} onClick={() => setSelectionMode(true)} title="选择元素"><MousePointer2 size={16} /><span>选择</span></button>
              <button className={!selectionMode ? "tool-button active" : "tool-button"} onClick={() => setSelectionMode(false)} title="操作页面"><Eye size={16} /><span>操作</span></button>
            </div>
            <button className="icon-button" onClick={() => setPreviewKey(value => value + 1)} title="重新载入预览"><RefreshCw size={16} /></button>
          </div>
          <div className="breadcrumb-bar">
            {breadcrumbs.length ? breadcrumbs.map((item, index) => (
              <span key={`${item.id}-${index}`} className="breadcrumb-item"><button onClick={() => iframeRef.current?.contentWindow?.postMessage({ type: "htmlwright:select-id", id: item.id }, "*")}>{item.breadcrumb}</button>{index < breadcrumbs.length - 1 && <ChevronRight size={13} />}</span>
            )) : <span className="breadcrumb-placeholder">点击页面元素以建立编辑上下文</span>}
          </div>
          <div className="preview-stage">
            <div className="browser-frame">
              <div className="browser-strip"><span /><span /><span /><div>localhost / {state?.file.name || "preview"}</div></div>
              <iframe key={previewKey} ref={iframeRef} title="HTML 文件预览" src={`/preview?version=candidate&t=${previewKey}`} />
            </div>
          </div>
        </section>

        <aside className="inspector-panel">
          <section className="intent-section">
            <div className="section-title"><div><span className="eyebrow">EDIT</span><h2>描述改动</h2></div>{busy && <LoaderCircle className="spin" size={18} />}</div>
            <div className="selection-summary">
              {selected ? <><span className="element-tag">{selected.tag}</span><div><strong>{selected.breadcrumb}</strong><small>{selected.text || "无文本内容"}</small></div><CheckCircle2 size={17} /></> : <><span className="selection-empty-icon"><MousePointer2 size={15} /></span><div><strong>尚未选择元素</strong><small>也可以按整页或整个 HTML 编辑</small></div></>}
            </div>
            <div className="segmented" aria-label="编辑范围">
              {scopeOptions.map(item => <button key={item.value} title={item.title} disabled={item.value === "element" && !selected || item.value === "unit" && (mode !== "unit" || activeUnitIndex === undefined)} className={scope === item.value ? "active" : ""} onClick={() => setScope(item.value)}>{item.label}</button>)}
            </div>
            <textarea value={intent} onChange={event => setIntent(event.target.value)} placeholder="例如：把标题改得更简洁，并增加与正文的间距" rows={5} />
            <div className="provider-row"><label htmlFor="provider">AI 后端</label><select id="provider" value={provider} onChange={event => setProvider(event.target.value as ProviderName)}>{state?.providers.filter(item => item.name !== "demo" || item.available).map(item => <option key={item.name} value={item.name} disabled={!item.available}>{providerLabel[item.name]}{item.available ? "" : "（不可用）"}</option>)}</select></div>
            <button className="primary-button" disabled={!intent.trim() || Boolean(busy) || !activeProvider?.available} onClick={submit}>{busy === "候选改动已生成" ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}生成候选改动<span>⌘↵</span></button>
          </section>

          <section className="review-section">
            <div className="review-tabs"><button className={reviewTab === "visual" ? "active" : ""} onClick={() => setReviewTab("visual")}><Eye size={15} />视觉验证</button><button className={reviewTab === "code" ? "active" : ""} onClick={() => setReviewTab("code")}><Code2 size={15} />代码差异</button></div>
            {!state?.pending ? <div className="empty-review"><ShieldCheck size={26} /><strong>等待候选改动</strong><span>改动生成后，这里会显示视觉结果与代码差异。</span></div> : reviewTab === "visual" ? (
              <div className="visual-review">
                <div className="visual-switch">{(["before", "after", "diff"] as const).map(item => <button key={item} className={visualFrame === item ? "active" : ""} onClick={() => setVisualFrame(item)}>{item === "before" ? "改前" : item === "after" ? "改后" : "热区"}</button>)}</div>
                <div className="shot-frame">{reviewImage ? <img src={reviewImage} alt={visualFrame === "before" ? "改动前截图" : visualFrame === "after" ? "改动后截图" : "变化热区"} /> : <div className="shot-unavailable"><AlertCircle size={20} /><span>{verification?.warning || "截图不可用"}</span></div>}</div>
                <VerificationChecks verification={verification} />
              </div>
            ) : <DiffView diff={state.pending.diff} />}
          </section>

          <div className="action-bar">
            <button className="reject-button" disabled={!state?.pending || Boolean(busy)} onClick={() => run("候选改动已拒绝", "/api/reject")}><X size={17} />拒绝</button>
            <button className="undo-button" disabled={!state?.canUndo || Boolean(busy)} onClick={() => run("已撤销上次写回", "/api/undo")}><Undo2 size={17} /></button>
            <button className="accept-button" disabled={!state?.pending || Boolean(busy) || state.conflict} onClick={() => run("改动已写回", "/api/accept")}><Check size={17} />接受并写回</button>
          </div>
        </aside>
      </div>
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
