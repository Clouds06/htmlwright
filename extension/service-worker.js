const DEFAULT_BASE_URL = "http://localhost:4178";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
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
