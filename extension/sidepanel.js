const HOST_NAME = 'com.htmlwright.native';
const providerLabels = {
  'claude-code': 'Claude Code',
  'anthropic-api': 'Anthropic API',
  'openai-compatible': 'OpenAI-compatible',
  demo: '本地演示',
};
const scopeLabels = {
  element: '这一处',
  unit: '这个区块',
  page: '这一页',
  document: '整个文件',
};

const elements = {
  fileName: document.querySelector('#file-name'),
  connectionBadge: document.querySelector('#connection-badge'),
  connectionPanel: document.querySelector('#connection-panel'),
  sourceLabel: document.querySelector('#source-label'),
  nativeHint: document.querySelector('#native-hint'),
  baseUrl: document.querySelector('#base-url'),
  connectButton: document.querySelector('#connect-button'),
  openPreviewButton: document.querySelector('#open-preview-button'),
  selectionSummary: document.querySelector('#selection-summary'),
  quickEditPanel: document.querySelector('#quick-edit-panel'),
  quickText: document.querySelector('#quick-text'),
  quickColor: document.querySelector('#quick-color'),
  quickBackground: document.querySelector('#quick-background'),
  quickFontSize: document.querySelector('#quick-font-size'),
  quickApplyButton: document.querySelector('#quick-apply-button'),
  scopeControl: document.querySelector('#scope-control'),
  intentTarget: document.querySelector('#intent-target'),
  intent: document.querySelector('#intent'),
  provider: document.querySelector('#provider'),
  claudeSettingsButton: document.querySelector('#claude-settings-button'),
  claudeDialog: document.querySelector('#claude-dialog'),
  claudeForm: document.querySelector('#claude-form'),
  claudePath: document.querySelector('#claude-path'),
  claudeDialogMessage: document.querySelector('#claude-dialog-message'),
  claudeCloseButton: document.querySelector('#claude-close-button'),
  claudeCancelButton: document.querySelector('#claude-cancel-button'),
  claudeSaveButton: document.querySelector('#claude-save-button'),
  openaiKey: document.querySelector('#openai-key'),
  openaiBase: document.querySelector('#openai-base'),
  openaiModel: document.querySelector('#openai-model'),
  openaiPresets: document.querySelector('#openai-presets'),
  generateButton: document.querySelector('#generate-button'),
  generationQueue: document.querySelector('#generation-queue'),
  generationQueueCount: document.querySelector('#generation-queue-count'),
  generationQueueList: document.querySelector('#generation-queue-list'),
  message: document.querySelector('#message'),
  emptyReview: document.querySelector('#empty-review'),
  reviewContent: document.querySelector('#review-content'),
  changeCount: document.querySelector('#change-count'),
  changeList: document.querySelector('#change-list'),
  verificationStatus: document.querySelector('#verification-status'),
  checks: document.querySelector('#checks'),
  diff: document.querySelector('#diff'),
  rejectButton: document.querySelector('#reject-button'),
  undoButton: document.querySelector('#undo-button'),
  acceptButton: document.querySelector('#accept-button'),
};

let baseUrl = localStorage.getItem('htmlwright-base-url') || 'http://localhost:4178';
let apiToken = '';
let appState;
let selection;
let activeTab;
let scope = 'document';
let multiPage = false;
let busy = false;
let transport = 'offline';
let openedFileUrl = '';
let nativePort;
let requestSerial = 0;
let claudeDialogPrompted = false;
let contentPort;
let contentPortTabId;
let contentPing;
let quickInitial;
let activeGeneration;
const generationQueue = [];
const nativeRequests = new Map();

elements.baseUrl.value = baseUrl;

function normalizeBaseUrl(input) {
  const url = new URL(input);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('只允许连接本机 htmlwright Helper');
  }
  return url.origin;
}

function setMessage(text, type = '') {
  elements.message.textContent = text;
  elements.message.className = `message ${type}`.trim();
}

function connectNative() {
  if (nativePort) return nativePort;
  nativePort = chrome.runtime.connectNative(HOST_NAME);
  nativePort.onMessage.addListener(message => {
    const pending = nativeRequests.get(message.id);
    if (!pending) return;
    nativeRequests.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error || 'Native Host 请求失败'));
  });
  nativePort.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message || 'Native Host 已断开';
    nativePort = undefined;
    for (const pending of nativeRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason.includes('not found') ? '未安装 Native Host，请先运行 htmlwright-install-native' : reason));
    }
    nativeRequests.clear();
  });
  return nativePort;
}

function nativeRequest(action, payload) {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${++requestSerial}`;
    const timer = setTimeout(() => {
      nativeRequests.delete(id);
      reject(new Error('Native Host 操作超时'));
    }, 210_000);
    nativeRequests.set(id, { resolve, reject, timer });
    try { connectNative().postMessage({ id, action, payload }); }
    catch (error) {
      clearTimeout(timer);
      nativeRequests.delete(id);
      reject(error);
    }
  });
}

async function httpRequest(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(apiToken ? { 'x-htmlwright-token': apiToken } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
  return body;
}

async function sendBridge(payload) {
  if (!activeTab?.id) return;
  const result = await chrome.runtime.sendMessage({ type: 'htmlwright:bridge-command', tabId: activeTab.id, payload });
  if (result?.error) throw new Error(result.error);
}

// Hold a port to the current local tab's content script while the panel is open.
// The content script activates selection on connect and reverts to passive when
// this port disconnects (i.e. when the panel closes), so reading is never disturbed.
function stopContentPing() {
  if (contentPing) { clearInterval(contentPing); contentPing = undefined; }
}

function syncContentPort() {
  if (transport === 'native' && activeTab?.id) {
    if (contentPort && contentPortTabId === activeTab.id) return;
    stopContentPing();
    if (contentPort) { try { contentPort.disconnect(); } catch { /* already gone */ } }
    try {
      contentPort = chrome.tabs.connect(activeTab.id, { name: 'htmlwright-panel' });
      contentPortTabId = activeTab.id;
      // Ping while the panel is open; when it closes this interval dies with the
      // document, the pings stop, and the page reverts itself to passive.
      contentPing = setInterval(() => {
        try { contentPort.postMessage({ t: 'ping' }); } catch { stopContentPing(); }
      }, 1000);
    } catch { contentPort = undefined; contentPortTabId = undefined; }
  } else if (contentPort) {
    stopContentPing();
    try { contentPort.disconnect(); } catch { /* already gone */ }
    contentPort = undefined;
    contentPortTabId = undefined;
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;
  selection = undefined;
  if (!tab?.id) return;
  const key = `preview:${tab.id}`;
  const stored = await chrome.storage.session.get(key);
  applyPreviewState(stored[key]);
}

function applyPreviewState(previewState) {
  multiPage = (previewState?.ready?.units?.length || 0) > 1;
  selection = previewState?.selection?.element;
  if (selection) setScope('element');
  else if (scope === 'element') setScope('document');
  renderSelection();
}

function targetLabel(target = selection, targetScope = scope) {
  const scopeLabel = scopeLabels[targetScope] || targetScope;
  if (targetScope === 'document') return scopeLabel;
  if (targetScope === 'page') return target ? `${scopeLabel} · 参考 ${target.breadcrumb || target.tag}` : scopeLabel;
  if (targetScope === 'unit') {
    const unit = target?.unitIndex === undefined ? '' : ` ${target.unitIndex + 1}`;
    return target ? `${scopeLabel}${unit} · 参考 ${target.breadcrumb || target.tag}` : `${scopeLabel}${unit}`;
  }
  return target ? `${scopeLabel} · ${target.breadcrumb || target.tag}` : `${scopeLabel} · 尚未选择`;
}

function renderIntentTarget() {
  const invalid = scope === 'element' && !selection;
  let text;
  if (scope === 'element') text = selection ? `只改你选中的：${selection.breadcrumb || selection.tag}` : '请先在页面上点选一个元素';
  else if (scope === 'page') text = '只改当前这一页';
  else text = '统一修改整个文件的所有内容';
  elements.intentTarget.textContent = text;
  elements.intentTarget.classList.toggle('invalid', invalid);
}

function renderGenerationQueue() {
  const jobs = [activeGeneration, ...generationQueue].filter(Boolean);
  elements.generationQueue.classList.toggle('hidden', jobs.length === 0);
  elements.generationQueueCount.textContent = `${activeGeneration ? '1 处理中' : '0 处理中'} · ${generationQueue.length} 等待`;
  elements.generationQueueList.replaceChildren();
  jobs.forEach(job => {
    const item = document.createElement('li');
    const status = document.createElement('span');
    const body = document.createElement('div');
    const target = document.createElement('strong');
    const intent = document.createElement('small');
    const isActive = job === activeGeneration;
    status.className = `generation-status ${isActive ? 'active' : 'waiting'}`;
    status.textContent = isActive ? '生成中' : '等待';
    target.textContent = job.target;
    intent.textContent = job.body.intent;
    intent.title = job.body.intent;
    body.append(target, intent);
    item.append(status, body);
    if (!isActive) {
      const remove = document.createElement('button');
      remove.className = 'generation-remove';
      remove.type = 'button';
      remove.title = '移出生成队列';
      remove.setAttribute('aria-label', `移出生成队列：${job.target}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        const index = generationQueue.indexOf(job);
        if (index >= 0) generationQueue.splice(index, 1);
        setMessage('已移除等待任务');
        renderState();
      });
      item.append(remove);
    }
    elements.generationQueueList.append(item);
  });
}

function cssColorToHex(value, fallback) {
  if (/^#[0-9a-f]{6}$/i.test(value || '')) return value.toLowerCase();
  const channels = String(value || '').match(/[\d.]+/g)?.map(Number) || [];
  if (channels.length < 3 || (channels.length > 3 && channels[3] === 0)) return fallback;
  return `#${channels.slice(0, 3).map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`;
}

function syncQuickEditor() {
  elements.quickEditPanel.classList.toggle('hidden', !selection);
  if (!selection) {
    quickInitial = undefined;
    elements.quickApplyButton.disabled = true;
    return;
  }
  const textEditable = selection.editableText !== undefined;
  const color = cssColorToHex(selection.computedStyle?.color, '#202522');
  const backgroundColor = cssColorToHex(selection.computedStyle?.backgroundColor, '#ffffff');
  const fontSize = Math.round((Number.parseFloat(selection.computedStyle?.fontSize) || 16) * 10) / 10;
  quickInitial = { text: selection.editableText, color, backgroundColor, fontSize };
  elements.quickText.disabled = !textEditable;
  elements.quickText.classList.toggle('hidden', !textEditable);
  elements.quickText.value = textEditable ? selection.editableText : '';
  elements.quickColor.value = color;
  elements.quickBackground.value = backgroundColor;
  elements.quickFontSize.value = String(fontSize);
  elements.quickApplyButton.disabled = busy || !selection.sourcePath;
}

function renderSelection() {
  const elementButton = elements.scopeControl.querySelector('[data-scope="element"]');
  const pageButton = elements.scopeControl.querySelector('[data-scope="page"]');
  pageButton.classList.toggle('hidden', !multiPage);
  if (!multiPage && scope === 'page') setScope('document');
  if (!selection) {
    elements.selectionSummary.className = 'selection-summary empty';
    elements.selectionSummary.querySelector('.tag').textContent = '—';
    elements.selectionSummary.querySelector('strong').textContent = '尚未选择元素';
    elements.selectionSummary.querySelector('small').textContent = '点选元素可快速调样式或用 AI 精修；未选则改整个文件';
    elementButton.disabled = true;
    if (scope === 'element') setScope('document');
    syncQuickEditor();
    renderIntentTarget();
    return;
  }
  elements.selectionSummary.className = 'selection-summary';
  elements.selectionSummary.querySelector('.tag').textContent = selection.tag;
  elements.selectionSummary.querySelector('strong').textContent = selection.breadcrumb || selection.tag;
  elements.selectionSummary.querySelector('small').textContent = selection.text || '无文本内容';
  elementButton.disabled = false;
  syncQuickEditor();
  renderIntentTarget();
}

function renderProviders() {
  const previous = elements.provider.value;
  elements.provider.replaceChildren();
  for (const provider of appState?.providers || []) {
    if (provider.name === 'demo' && !provider.available) continue;
    const option = document.createElement('option');
    option.value = provider.name;
    option.textContent = `${providerLabels[provider.name] || provider.name}${provider.available ? '' : '（不可用）'}`;
    option.disabled = !provider.available;
    elements.provider.append(option);
  }
  const availableNames = [...elements.provider.options].filter(option => !option.disabled).map(option => option.value);
  if (availableNames.length) elements.provider.value = availableNames.includes(previous) ? previous : availableNames[0];
  else elements.provider.selectedIndex = elements.provider.options.length ? 0 : -1;
  return availableNames.length > 0;
}

function addCheck(ok, text) {
  const row = document.createElement('div');
  row.className = `check ${ok ? 'passed' : 'warning'}`;
  row.textContent = `${ok ? '✓' : '!'} ${text}`;
  elements.checks.append(row);
}

function renderDiff(diff) {
  elements.diff.replaceChildren();
  String(diff || '').split('\n').forEach(line => {
    const row = document.createElement('span');
    row.className = 'diff-line';
    if (line.startsWith('+') && !line.startsWith('+++')) row.classList.add('added');
    else if (line.startsWith('-') && !line.startsWith('---')) row.classList.add('removed');
    else if (line.startsWith('@@')) row.classList.add('hunk');
    else if (line.startsWith('---') || line.startsWith('+++')) row.classList.add('header');
    row.textContent = line || ' ';
    elements.diff.append(row);
  });
}

function renderReview() {
  const pending = appState?.pending;
  elements.rejectButton.disabled = busy || !pending;
  elements.acceptButton.disabled = busy || !pending || appState?.conflict;
  elements.undoButton.disabled = busy || !appState?.canUndo;
  if (!pending) {
    elements.emptyReview.classList.remove('hidden');
    elements.reviewContent.classList.add('hidden');
    elements.verificationStatus.textContent = '等待改动';
    return;
  }
  elements.emptyReview.classList.add('hidden');
  elements.reviewContent.classList.remove('hidden');
  const changes = Array.isArray(pending.changes) && pending.changes.length
    ? pending.changes
    : [{ id: pending.id, kind: 'ai', intent: pending.intent, scope: 'document' }];
  elements.changeCount.textContent = `${changes.length} 条`;
  elements.changeList.replaceChildren();
  changes.forEach((change, index) => {
    const item = document.createElement('li');
    const indexLabel = document.createElement('span');
    const body = document.createElement('div');
    const meta = document.createElement('div');
    const intent = document.createElement('p');
    indexLabel.className = 'change-index';
    indexLabel.textContent = String(index + 1);
    meta.className = 'change-meta';
    const where = change.target?.breadcrumb || change.target?.tag
      || (change.scope === 'document' ? '整个文件' : change.scope === 'page' ? '这一页' : '选中项');
    meta.textContent = change.legacy ? '升级前候选' : where;
    intent.textContent = change.intent;
    intent.title = change.intent;
    body.append(meta, intent);
    item.append(indexLabel, body);
    elements.changeList.append(item);
  });
  elements.checks.replaceChildren();
  const verification = pending.verification;
  if (verification?.available) {
    elements.verificationStatus.textContent = '验证完成';
    addCheck(verification.targetChanged, verification.targetChanged ? '目标区域已变化' : '视觉变化低于检测阈值，仍可根据预览和代码差异接受');
    addCheck(!verification.overflow, verification.overflow ? '发现内容溢出' : '未发现内容溢出');
    addCheck(verification.collateralUnits?.length === 0, verification.collateralUnits?.length ? '发现非目标页面变化' : '未发现越界改动');
  } else {
    elements.verificationStatus.textContent = '验证受限';
    addCheck(false, verification?.warning || '视觉验证不可用');
  }
  renderDiff(pending.diff);
}

function renderConnection() {
  const connected = Boolean(appState);
  elements.connectionBadge.textContent = connected ? (transport === 'native' ? '本地文件' : '已连接') : '未连接';
  elements.connectionBadge.className = `connection ${connected ? 'ready' : 'offline'}`;
  elements.connectionPanel.classList.toggle('native-connected', transport === 'native' && connected);
  elements.connectionPanel.classList.toggle('hidden', transport === 'native' && connected);
  elements.connectionBadge.title = connected
    ? (transport === 'native' ? '已通过 Native Host 连接当前文件，无需启动 localhost 服务' : '已连接本地 Helper')
    : '未连接，请用 Chrome 打开一个本地 HTML 文件';
  elements.nativeHint.classList.toggle('hidden', transport !== 'native' || !connected);
  elements.sourceLabel.textContent = transport === 'native' ? 'Native Host' : '本地 Helper 地址';
}

function renderState() {
  renderConnection();
  elements.fileName.textContent = appState?.file?.name || '打开本地 HTML 后使用';
  const hasProvider = renderProviders();
  elements.claudeSettingsButton.classList.toggle('hidden', transport !== 'native' || !appState);
  const generationCanQueue = Boolean(activeGeneration);
  elements.generateButton.disabled = (busy && !generationCanQueue) || !appState || !elements.intent.value.trim() || !elements.provider.value || (scope === 'element' && !selection);
  elements.generateButton.textContent = generationCanQueue ? '加入生成队列' : '生成候选改动';
  elements.quickApplyButton.disabled = busy || !selection?.sourcePath;
  if (appState && !hasProvider && !busy) {
    const claudeStatus = appState.providers?.find(provider => provider.name === 'claude-code');
    setMessage(claudeStatus?.message || '没有可用的 AI 后端', 'error');
    if (transport === 'native' && !claudeDialogPrompted) queueMicrotask(() => openClaudeDialog(true));
  }
  renderReview();
  renderGenerationQueue();
}

function openClaudeDialog(automatic = false) {
  if (transport !== 'native' || !appState) return;
  claudeDialogPrompted = true;
  const settings = appState.settings || {};
  elements.claudePath.value = settings.claudeExecutable || settings.defaultClaudeExecutable || '~/.local/bin/claude';
  elements.openaiKey.value = settings.openaiApiKey || '';
  elements.openaiBase.value = settings.openaiBaseUrl || '';
  elements.openaiModel.value = settings.openaiModel || '';
  elements.claudeDialogMessage.textContent = automatic ? '未检测到可用后端。设置 Claude 路径，或填入任一 OpenAI 兼容后端。' : '';
  if (!elements.claudeDialog.open) elements.claudeDialog.showModal();
}

function closeClaudeDialog() {
  if (elements.claudeDialog.open) elements.claudeDialog.close();
}

async function saveClaudeConfiguration(event) {
  event.preventDefault();
  const settings = {
    claudeExecutable: elements.claudePath.value.trim(),
    openaiApiKey: elements.openaiKey.value.trim(),
    openaiBaseUrl: elements.openaiBase.value.trim(),
    openaiModel: elements.openaiModel.value.trim(),
  };
  elements.claudeDialogMessage.textContent = '正在保存并检测…';
  elements.claudeSaveButton.disabled = true;
  try {
    appState = await nativeRequest('configure', settings);
    const available = (appState.providers || []).filter(provider => provider.available).map(provider => providerLabels[provider.name] || provider.name);
    if (!available.length) throw new Error('仍没有可用的 AI 后端，请检查 Claude 路径或 OpenAI Key');
    closeClaudeDialog();
    setMessage(`已保存，可用后端：${available.join('、')}`, 'success');
  } catch (error) {
    elements.claudeDialogMessage.textContent = error.message;
  } finally {
    elements.claudeSaveButton.disabled = false;
    renderState();
  }
}

async function showCandidateIfNeeded() {
  if (transport !== 'native' || !appState?.pending || !appState.previewUrl) return;
  await sendBridge({ type: 'htmlwright:show-candidate', url: appState.previewUrl }).catch(error => {
    setMessage(`候选已生成，但页面预览失败：${error.message}`, 'error');
  });
}

async function refreshState({ quiet = true, forceOpen = false } = {}) {
  try {
    await getActiveTab();
    if (activeTab?.url?.startsWith('file://')) {
      const allowed = await chrome.extension.isAllowedFileSchemeAccess();
      if (!allowed) throw new Error('请在扩展详情页开启“允许访问文件网址”');
      transport = 'native';
      const action = forceOpen || openedFileUrl !== activeTab.url ? 'open' : 'state';
      appState = await nativeRequest(action, action === 'open' ? { fileUrl: activeTab.url } : undefined);
      openedFileUrl = activeTab.url;
      apiToken = '';
      await showCandidateIfNeeded();
      if (!quiet) setMessage('已连接当前本地文件', 'success');
    } else {
      const activeUrl = new URL(activeTab?.url || 'about:blank');
      if (!['localhost', '127.0.0.1'].includes(activeUrl.hostname)) throw new Error('请先用 Chrome 打开一个本地 HTML 文件');
      transport = 'http';
      appState = await httpRequest('/api/state');
      apiToken = appState.apiToken;
      if (!quiet) setMessage('已连接本地 Helper', 'success');
    }
  } catch (error) {
    appState = undefined;
    apiToken = '';
    transport = activeTab?.url?.startsWith('file://') ? 'native' : 'offline';
    if (!quiet) setMessage(error.message, 'error');
  }
  syncContentPort();
  renderState();
}

async function perform(label, path, body) {
  if (busy) return;
  busy = true;
  setMessage(`${label}…`);
  renderState();
  try {
    if (transport === 'native') {
      const action = path.replace('/api/', '');
      appState = await nativeRequest(action, body);
      if (action === 'edit') {
        elements.intent.value = '';
        await showCandidateIfNeeded();
      } else {
        await sendBridge({ type: 'htmlwright:clear-candidate' }).catch(() => undefined);
        if (['accept', 'undo'].includes(action)) await sendBridge({ type: 'htmlwright:reload' }).catch(() => undefined);
      }
    } else {
      await httpRequest(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      await refreshState();
      if (path === '/api/edit') elements.intent.value = '';
    }
    setMessage(appState?.pending && transport === 'native' ? `${label}完成，可继续在候选页面点选元素追加修改` : `${label}完成`, 'success');
  } catch (error) {
    setMessage(error.message, 'error');
  } finally {
    busy = false;
    renderState();
  }
}

async function processGenerationQueue() {
  if (activeGeneration || generationQueue.length === 0) return;
  activeGeneration = generationQueue.shift();
  busy = true;
  setMessage(`正在生成：${activeGeneration.target}`);
  renderState();
  try {
    if (transport === 'native') {
      appState = await nativeRequest('edit', activeGeneration.body);
      await showCandidateIfNeeded();
    } else {
      await httpRequest('/api/edit', { method: 'POST', body: JSON.stringify(activeGeneration.body) });
      await refreshState();
    }
    setMessage(generationQueue.length
      ? `当前候选已完成，继续处理 ${generationQueue.length} 条等待任务`
      : '候选改动生成完成，可继续在候选页面点选元素追加修改', 'success');
  } catch (error) {
    setMessage(`${activeGeneration.target}：${error.message}`, 'error');
  } finally {
    activeGeneration = undefined;
    busy = generationQueue.length > 0;
    renderState();
    if (generationQueue.length) queueMicrotask(processGenerationQueue);
  }
}

function enqueueGeneration() {
  if (busy && !activeGeneration) return;
  const intent = elements.intent.value.trim();
  if (!intent || (scope === 'element' && !selection)) return;
  const body = {
    intent,
    scope,
    provider: elements.provider.value,
    selectedElement: selection ? structuredClone(selection) : undefined,
    unitIndex: scope === 'document' ? undefined : selection?.unitIndex,
  };
  const job = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    body,
    target: targetLabel(body.selectedElement, body.scope),
  };
  elements.intent.value = '';
  generationQueue.push(job);
  if (activeGeneration) setMessage(`已加入队列，当前共有 ${generationQueue.length} 条等待任务`, 'success');
  renderState();
  void processGenerationQueue();
}

async function applyQuickChanges() {
  if (busy || !selection || !quickInitial) return;
  if (transport !== 'native') {
    setMessage('快速编辑目前仅支持直接打开的本地 HTML', 'error');
    return;
  }
  const changes = {};
  if (!elements.quickText.disabled && elements.quickText.value !== quickInitial.text) changes.text = elements.quickText.value;
  if (elements.quickColor.value.toLowerCase() !== quickInitial.color) changes.color = elements.quickColor.value;
  if (elements.quickBackground.value.toLowerCase() !== quickInitial.backgroundColor) changes.backgroundColor = elements.quickBackground.value;
  const fontSize = Number(elements.quickFontSize.value);
  if (Number.isFinite(fontSize) && fontSize !== quickInitial.fontSize) changes.fontSize = fontSize;
  if (!Object.keys(changes).length) {
    setMessage('快速编辑没有变化', 'error');
    return;
  }
  busy = true;
  setMessage('正在应用快速修改…');
  renderState();
  try {
    appState = await nativeRequest('quick-edit', { selectedElement: selection, changes, unitIndex: selection.unitIndex });
    await showCandidateIfNeeded();
    selection = undefined;
    renderSelection();
    setMessage('快速修改完成，可继续在候选页面点选元素追加修改', 'success');
  } catch (error) {
    setMessage(error.message, 'error');
  } finally {
    busy = false;
    renderState();
  }
}

function setScope(nextScope) {
  scope = nextScope;
  elements.scopeControl.querySelectorAll('button').forEach(item => item.classList.toggle('active', item.dataset.scope === scope));
  void sendBridge({ type: 'htmlwright:highlight-scope', scope }).catch(() => undefined);
  renderIntentTarget();
  renderState();
}

elements.connectButton.addEventListener('click', async () => {
  try {
    baseUrl = normalizeBaseUrl(elements.baseUrl.value);
    elements.baseUrl.value = baseUrl;
    localStorage.setItem('htmlwright-base-url', baseUrl);
    await refreshState({ quiet: false, forceOpen: true });
  } catch (error) { setMessage(error.message, 'error'); }
});

elements.openPreviewButton.addEventListener('click', async () => {
  try {
    baseUrl = normalizeBaseUrl(elements.baseUrl.value);
    localStorage.setItem('htmlwright-base-url', baseUrl);
    const result = await chrome.runtime.sendMessage({ type: 'htmlwright:open-preview', baseUrl });
    if (result?.error) throw new Error(result.error);
    setMessage('已打开本地预览', 'success');
  } catch (error) { setMessage(error.message, 'error'); }
});

elements.scopeControl.addEventListener('click', event => {
  const button = event.target.closest('[data-scope]');
  if (!button || button.disabled) return;
  setScope(button.dataset.scope);
});

elements.intent.addEventListener('input', renderState);
elements.provider.addEventListener('change', renderState);
elements.quickApplyButton.addEventListener('click', applyQuickChanges);
elements.claudeSettingsButton.addEventListener('click', () => openClaudeDialog());
elements.claudeCloseButton.addEventListener('click', closeClaudeDialog);
elements.claudeCancelButton.addEventListener('click', closeClaudeDialog);
elements.claudeForm.addEventListener('submit', saveClaudeConfiguration);
elements.openaiPresets.addEventListener('click', event => {
  const chip = event.target.closest('[data-base]');
  if (!chip) return;
  elements.openaiBase.value = chip.dataset.base;
  elements.openaiModel.value = chip.dataset.model;
  elements.openaiKey.focus();
});
elements.generateButton.addEventListener('click', enqueueGeneration);
elements.acceptButton.addEventListener('click', () => perform('接受并写回', '/api/accept'));
elements.rejectButton.addEventListener('click', () => perform('拒绝候选', '/api/reject'));
elements.undoButton.addEventListener('click', () => perform('撤销写回', '/api/undo'));

chrome.runtime.onMessage.addListener(message => {
  if (message?.type !== 'htmlwright:preview-update' || message.tabId !== activeTab?.id) return;
  applyPreviewState(message.state);
});
chrome.tabs.onActivated.addListener(() => refreshState({ quiet: false, forceOpen: true }));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === activeTab?.id && changeInfo.status === 'complete') refreshState({ forceOpen: true });
});

refreshState({ quiet: false, forceOpen: true });
setInterval(() => {
  if (transport === 'http') refreshState();
}, 2000);
