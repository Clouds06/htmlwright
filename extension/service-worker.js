const DEFAULT_BASE_URL = "http://localhost:4178";

function initSidePanel() {
  // Don't auto-open on the toolbar action — we open it per-tab on an explicit click.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
  // Disabled by default; only a tab the user explicitly opens it on gets it enabled,
  // so it never auto-shows on any other tab (even another local HTML file).
  chrome.sidePanel.setOptions({ enabled: false }).catch(() => undefined);
}
chrome.runtime.onInstalled.addListener(initSidePanel);
chrome.runtime.onStartup.addListener(initSidePanel);

async function openSidePanelForTab(tabId) {
  await chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: true }).catch(() => undefined);
  await chrome.sidePanel.open({ tabId }).catch(() => undefined);
}

chrome.action.onClicked.addListener(tab => { if (tab.id !== undefined) openSidePanelForTab(tab.id); });

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
      openSidePanelForTab(sender.tab.id);
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
