const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const labels = {
  eyebrow: { tag: "span", name: "全新 3.0 · 支持实时协作", path: "header.hero › span.eyebrow", className: "eyebrow" },
  title: { tag: "h1", name: "让团队数据在同一个画布上流动", path: "header.hero › h1", className: "hero-title" },
  lead: { tag: "p", name: "云图把分散的数据连起来…", path: "header.hero › p.lead", className: "lead" },
  primary: { tag: "a", name: "免费试用 14 天", path: "header.hero › a.btn-primary", className: "btn btn-primary" },
  secondary: { tag: "a", name: "预约演示 →", path: "header.hero › a.btn-ghost", className: "btn btn-ghost" },
};

const initial = {
  eyebrow: { text: "全新 3.0 · 支持实时协作", color: "#6147da", background: "#eeebff", fontSize: 8, radius: 999, shadow: "none" },
  title: { text: "让团队数据在同一个\n画布上流动", color: "#151522", background: "transparent", fontSize: 31, radius: 0, shadow: "none" },
  lead: { text: "云图把分散在表格、文档和看板里的数据连起来，实时同步、自动分析，让每个人都看到同一份真相。", color: "#767681", background: "transparent", fontSize: 9, radius: 0, shadow: "none" },
  primary: { text: "免费试用 14 天", color: "#ffffff", background: "#7043e4", fontSize: 8, radius: 7, shadow: "0 6px 14px rgba(112,67,228,.24)" },
  secondary: { text: "预约演示 →", color: "#33333a", background: "#ffffff", fontSize: 8, radius: 7, shadow: "none" },
};

const clone = (value) => JSON.parse(JSON.stringify(value));
let committed = clone(initial);
let candidate = null;
let selectedKey = "eyebrow";
let history = [];
let currentView = "preview";

const samplePage = $("#sample-page");
const diffPanel = $("#diff-panel");
const diffCode = $("#diff-code");
const previewTab = $(".view-tabs button:first-child");
const beforeTab = $("#before-tab");
const diffTab = $("#diff-tab");
const intentInput = $("#intent");
const generateButton = $("#generate");
const reviewCard = $("#review-card");
const acceptButton = $("#accept");
const rejectButton = $("#reject");
const undoButton = $("#undo");
const checkBar = $("#check-bar");
const toast = $("#toast");

function renderTitle(element, text) {
  const parts = text.split("\n");
  element.replaceChildren(document.createTextNode(parts[0]));
  if (parts.length > 1) {
    element.append(document.createElement("br"));
    const accent = document.createElement("em");
    accent.textContent = parts.slice(1).join(" ");
    element.append(accent);
  }
}

function renderModel(model) {
  for (const [key, values] of Object.entries(model)) {
    const element = document.querySelector(`[data-edit-key="${key}"]`);
    if (!element) continue;
    if (key === "title") renderTitle(element, values.text);
    else element.textContent = values.text;
    element.style.color = values.color;
    element.style.background = values.background;
    element.style.fontSize = `${values.fontSize}px`;
    element.style.borderRadius = `${values.radius}px`;
    element.style.boxShadow = values.shadow;
    element.classList.toggle("selected", key === selectedKey);
  }
  updateSelection();
}

function updateSelection() {
  const meta = labels[selectedKey];
  const model = candidate ?? committed;
  $("#element-tag").textContent = meta.tag;
  $("#selection-name").textContent = model[selectedKey].text.replace("\n", " ");
  $("#selection-path").textContent = meta.path;
  $("#target-copy").textContent = `目标：${meta.path}`;
}

function selectElement(key) {
  selectedKey = key;
  renderModel(currentView === "before" ? committed : (candidate ?? committed));
}

samplePage.addEventListener("click", (event) => {
  const editable = event.target.closest("[data-edit-key]");
  if (!editable || currentView !== "preview") return;
  event.preventDefault();
  selectElement(editable.dataset.editKey);
});

function setView(view) {
  currentView = view;
  [previewTab, beforeTab, diffTab].forEach(button => button.classList.remove("active"));
  samplePage.hidden = view === "diff";
  diffPanel.hidden = view !== "diff";
  if (view === "diff") {
    diffTab.classList.add("active");
    renderDiff();
  } else if (view === "before") {
    beforeTab.classList.add("active");
    renderModel(committed);
  } else {
    previewTab.classList.add("active");
    renderModel(candidate ?? committed);
  }
}

previewTab.addEventListener("click", () => setView("preview"));
beforeTab.addEventListener("click", () => setView("before"));
diffTab.addEventListener("click", () => setView("diff"));
$("#show-diff").addEventListener("click", () => setView("diff"));

function readQuotedText(intent) {
  const match = intent.match(/[「“\"]([^」”\"]+)[」”\"]/);
  return match?.[1]?.trim();
}

function parseIntent(intent, key, source) {
  const next = { ...source };
  const changes = [];
  const quoted = readQuotedText(intent);
  if (quoted && /(文案|文字|标题|改成|换成)/.test(intent)) {
    next.text = key === "title" && quoted.includes("，") ? quoted.replace("，", "\n") : quoted;
    changes.push("文字");
  }

  const colors = [
    [/紫色|紫一点/, "#7c3aed"],
    [/绿色|绿一点/, "#169b62"],
    [/蓝色|蓝一点/, "#2563eb"],
    [/橙色|橘色/, "#ea7100"],
    [/红色|红一点/, "#dc3545"],
    [/黑色|深色/, "#16161a"],
  ];
  const color = colors.find(([pattern]) => pattern.test(intent))?.[1];
  if (color) {
    if (/背景/.test(intent) || key === "primary" || key === "secondary" || key === "eyebrow") {
      next.background = color;
      if (["primary", "secondary"].includes(key)) next.color = "#ffffff";
      if (key === "eyebrow") next.color = "#ffffff";
      changes.push("背景色");
    } else {
      next.color = color;
      changes.push("文字颜色");
    }
  }

  const px = intent.match(/(\d{1,3})\s*(?:px|像素)/i);
  if (px) {
    next.fontSize = Math.min(64, Math.max(7, Number(px[1]) * .55));
    changes.push("字号");
  } else if (/更大|大一点|放大/.test(intent)) {
    next.fontSize = Math.min(64, next.fontSize + (key === "title" ? 5 : 2));
    changes.push("字号");
  } else if (/更小|小一点|缩小/.test(intent)) {
    next.fontSize = Math.max(7, next.fontSize - (key === "title" ? 4 : 1));
    changes.push("字号");
  }

  if (/圆角|圆润/.test(intent)) {
    next.radius = Math.max(next.radius, key === "title" || key === "lead" ? 8 : 14);
    changes.push("圆角");
  }
  if (/醒目|突出|强调/.test(intent)) {
    if (["primary", "secondary", "eyebrow"].includes(key)) {
      next.background = color ?? "#7137e8";
      next.color = "#ffffff";
    } else {
      next.color = color ?? "#7137e8";
    }
    next.shadow = "0 7px 18px rgba(113,55,232,.26)";
    next.fontSize += key === "title" ? 3 : 1;
    changes.push("强调样式");
  }

  if (!changes.length) {
    if (["primary", "secondary", "eyebrow"].includes(key)) {
      next.background = source.background === "#169b62" ? "#7137e8" : "#169b62";
      next.color = "#ffffff";
      next.shadow = "0 7px 18px rgba(22,155,98,.24)";
      changes.push("强调样式");
    } else {
      next.color = source.color === "#7137e8" ? "#151522" : "#7137e8";
      changes.push("文字颜色");
    }
  }
  return { next, changes: [...new Set(changes)] };
}

function codeLine(key, values) {
  const meta = labels[key];
  const style = [
    `color: ${values.color}`,
    values.background !== "transparent" && `background: ${values.background}`,
    `font-size: ${values.fontSize}px`,
    values.radius > 0 && `border-radius: ${values.radius}px`,
  ].filter(Boolean).join("; ");
  const text = values.text.replace("\n", " ");
  return `<${meta.tag} class="${meta.className}" style="${style}">${text}</${meta.tag}>`;
}

function renderDiff() {
  diffCode.replaceChildren();
  const context = document.createElement("span");
  context.textContent = "  <section class=\"hero\">\n    ...";
  diffCode.append(context);
  if (!candidate) return;
  const before = document.createElement("span");
  before.className = "diff-remove";
  before.textContent = `-   ${codeLine(selectedKey, committed[selectedKey])}`;
  const after = document.createElement("span");
  after.className = "diff-add";
  after.textContent = `+   ${codeLine(selectedKey, candidate[selectedKey])}`;
  const tail = document.createElement("span");
  tail.textContent = "    ...\n  </section>";
  diffCode.append(document.createTextNode("\n"), before, document.createTextNode("\n"), after, document.createTextNode("\n"), tail);
}

function markCandidate(changes) {
  reviewCard.hidden = false;
  $("#change-summary").textContent = `修改 ${labels[selectedKey].path}：${changes.join("、")}`;
  beforeTab.disabled = false;
  diffTab.disabled = false;
  acceptButton.disabled = false;
  rejectButton.disabled = false;
  checkBar.classList.add("verified");
  checkBar.innerHTML = [
    "目标已变化 · 0.42%",
    "未发现跨单元改动",
    "未发现内容溢出",
    "未发现风险重叠",
  ].map(text => `<span><i>✓</i> ${text}</span>`).join("");
}

function clearCandidate() {
  candidate = null;
  reviewCard.hidden = true;
  beforeTab.disabled = true;
  diffTab.disabled = true;
  acceptButton.disabled = true;
  rejectButton.disabled = true;
  checkBar.classList.remove("verified");
  checkBar.innerHTML = [
    "目标未变化",
    "未发现跨单元改动",
    "未发现内容溢出",
    "未发现风险重叠",
  ].map(text => `<span><i>✓</i> ${text}</span>`).join("");
  setView("preview");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

generateButton.addEventListener("click", () => {
  const intent = intentInput.value.trim() || "让它更醒目一点";
  generateButton.classList.add("loading");
  generateButton.innerHTML = "<span>◌</span> 正在生成候选改动…";
  window.setTimeout(() => {
    candidate = clone(committed);
    const result = parseIntent(intent, selectedKey, committed[selectedKey]);
    candidate[selectedKey] = result.next;
    markCandidate(result.changes);
    setView("preview");
    generateButton.classList.remove("loading");
    generateButton.innerHTML = "<span>⌁</span> 重新生成候选改动";
  }, 620);
});

acceptButton.addEventListener("click", () => {
  if (!candidate) return;
  history.push(clone(committed));
  committed = clone(candidate);
  clearCandidate();
  undoButton.disabled = false;
  intentInput.value = "";
  generateButton.innerHTML = "<span>⌁</span> 生成候选改动";
  showToast("已模拟写回 · 原版本已加入快照");
});

rejectButton.addEventListener("click", () => {
  clearCandidate();
  generateButton.innerHTML = "<span>⌁</span> 生成候选改动";
  showToast("候选改动已拒绝，页面保持不变");
});

undoButton.addEventListener("click", () => {
  const previous = history.pop();
  if (!previous) return;
  committed = previous;
  clearCandidate();
  undoButton.disabled = history.length === 0;
  showToast("已回退到上一个快照");
});

$$('[data-prompt]').forEach(button => button.addEventListener("click", () => {
  intentInput.value = button.dataset.prompt;
  intentInput.focus();
}));

$(".locate").addEventListener("click", () => {
  const element = document.querySelector(`[data-edit-key="${selectedKey}"]`);
  element?.animate([
    { boxShadow: "0 0 0 8px rgba(116,66,231,.08)" },
    { boxShadow: "0 0 0 15px rgba(116,66,231,.18)" },
    { boxShadow: "0 0 0 8px rgba(116,66,231,.08)" },
  ], { duration: 520 });
});

intentInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") generateButton.click();
});

renderModel(committed);
