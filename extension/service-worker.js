const DEFAULT_BASE_URL = "http://localhost:4178";

// The panel is disabled everywhere by default and only opens on the exact tab
// where the user clicks the toolbar icon — it never auto-shows on any other tab.
function initSidePanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
  chrome.sidePanel.setOptions({ enabled: false }).catch(() => undefined);
}
chrome.runtime.onInstalled.addListener(() => {
  initSidePanel();
  // Reload already-open local HTML tabs so they pick up the current content script
  // (reloading the extension does not re-inject into existing tabs on its own).
  chrome.tabs.query({}).then(tabs => {
    for (const tab of tabs) {
      if (tab.id === undefined || !tab.url) continue;
      try { if (new URL(tab.url).protocol === 'file:') chrome.tabs.reload(tab.id).catch(() => undefined); } catch { /* skip */ }
    }
  }).catch(() => undefined);
});
chrome.runtime.onStartup.addListener(initSidePanel);
initSidePanel();

chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  // Enable then open() must run in the same gesture without an await in between,
  // or the user-gesture context is lost and open() is rejected (panel won't show).
  chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true }).catch(() => undefined);
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
});

// The side panel holds this port for its whole lifetime. The service worker is a
// stable observer, so when the panel is destroyed (closed) onDisconnect fires here
// reliably — that's what lets the page revert to passive. The panel reports which
// tab it is currently showing via a message on the port.
let panelTabId;
function tellTab(tabId, type) {
  if (typeof tabId !== 'number') return;
  chrome.tabs.sendMessage(tabId, { type: 'htmlwright:bridge-command', payload: { type } }).catch(() => undefined);
}
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'htmlwright-panel-alive') return;
  port.onMessage.addListener(msg => {
    const next = msg && typeof msg.tabId === 'number' ? msg.tabId : undefined;
    if (next === panelTabId) return;
    tellTab(panelTabId, 'htmlwright:panel-closed');
    panelTabId = next;
    tellTab(panelTabId, 'htmlwright:panel-open');
  });
  port.onDisconnect.addListener(() => {
    tellTab(panelTabId, 'htmlwright:panel-closed');
    panelTabId = undefined;
  });
});

function normalizeBaseUrl(input) {
  const url = new URL(input || DEFAULT_BASE_URL);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('只允许连接本机 htmlwright Helper');
  }
  return url.origin;
}

async function storePreviewMessage(message, sender) {
  const tabId = sender.tab?.id;
  if (!tabId) return;
  const key = `preview:${tabId}`;
  const previous = (await chrome.storage.session.get(key))[key] || {};
  const next = message.payload.type === 'htmlwright:ready'
    ? { ready: message.payload, tabId, url: sender.tab.url }
    : { ...previous, selection: message.payload, tabId, url: sender.tab.url };
  await chrome.storage.session.set({ [key]: next });
  chrome.runtime.sendMessage({ type: 'htmlwright:preview-update', tabId, state: next }).catch(() => undefined);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'htmlwright:preview-message') {
    if (message.payload?.type === 'htmlwright:selected' && sender.tab?.id) {
      chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => undefined);
    }
    storePreviewMessage(message, sender).then(() => sendResponse({ ok: true })).catch(error => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === 'htmlwright:open-preview') {
    Promise.resolve().then(async () => {
      const baseUrl = normalizeBaseUrl(message.baseUrl);
      const tab = await chrome.tabs.create({ url: `${baseUrl}/preview?version=candidate&extension=1` });
      sendResponse({ ok: true, tabId: tab.id });
    }).catch(error => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === 'htmlwright:bridge-command') {
    chrome.tabs.sendMessage(message.tabId, { type: 'htmlwright:bridge-command', payload: message.payload })
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
  return false;
});
