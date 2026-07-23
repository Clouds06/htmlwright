function sendPreviewPayload(payload) {
  chrome.runtime.sendMessage({ type: 'htmlwright:preview-message', payload }).catch(() => undefined);
}

function installFileSelector() {
  const STYLE_ID = 'htmlwright-extension-style';
  const HOVER_ID = 'htmlwright-extension-hover';
  const SELECTED_ID = 'htmlwright-extension-selected';
  const PREVIEW_ID = 'htmlwright-extension-preview';
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${HOVER_ID}, #${SELECTED_ID} { position: fixed; display: none; pointer-events: none; z-index: 2147483645; box-sizing: border-box; }
    #${HOVER_ID} { border: 1px solid #1f6feb; background: rgba(31,111,235,.08); }
    #${SELECTED_ID} { border: 2px solid #ef6c35; background: rgba(239,108,53,.08); }
    #${PREVIEW_ID} { position: fixed; inset: 0; width: 100vw; height: 100vh; border: 0; background: white; z-index: 2147483644; }
    html.htmlwright-selecting, html.htmlwright-selecting * { cursor: crosshair !important; }
  `;
  const hover = document.createElement('div');
  const selected = document.createElement('div');
  hover.id = HOVER_ID;
  selected.id = SELECTED_ID;
  document.documentElement.append(style, hover, selected);

  const blocked = new Set(['HTML', 'BODY', 'SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD']);
  let selecting = true;
  let active;
  let highlightTarget;
  let serial = 0;
  const eligible = [...document.querySelectorAll('body *')].filter(element => !blocked.has(element.tagName));
  eligible.forEach(element => { element.dataset.htmlwrightId = String(++serial); });

  const visible = element => {
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    return rect.width > 24 && rect.height > 20 && computed.display !== 'none' && computed.visibility !== 'hidden';
  };
  const unitSelectors = 'section, article, .slide, .page, .screen, .card';
  const allUnits = [...document.querySelectorAll(unitSelectors)].filter(visible);
  const units = allUnits.filter(element => !allUnits.some(parent => parent !== element && parent.contains(element)));
  units.forEach((element, index) => { element.dataset.htmlwrightUnit = String(index); });
  const unitData = units.map((element, index) => ({
    index,
    title: (element.querySelector('h1,h2,h3')?.textContent || element.getAttribute('aria-label') || `内容单元 ${index + 1}`).trim().slice(0, 80),
    tag: element.tagName.toLowerCase(),
  }));
  const dynamic = [...document.scripts].some(script => (script.textContent || '').trim().length > 80 || script.src);

  const position = (element, box) => {
    if (!element) { box.style.display = 'none'; return; }
    const rect = element.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  };
  const describe = element => {
    const classes = [...element.classList].filter(Boolean);
    const sourcePath = [];
    let cursor = element;
    while (cursor && cursor !== document.documentElement) {
      const parent = cursor.parentElement;
      if (!parent) break;
      sourcePath.unshift([...parent.children].indexOf(cursor));
      cursor = parent;
    }
    const computed = getComputedStyle(element);
    const text = (element.innerText || element.textContent || '').trim().slice(0, 300);
    return {
      id: element.dataset.htmlwrightId,
      tag: element.tagName.toLowerCase(),
      classes,
      text,
      editableText: element.children.length === 0 ? (element.innerText || element.textContent || '').trim().slice(0, 10000) : undefined,
      outerHTML: element.outerHTML,
      breadcrumb: element.tagName.toLowerCase() + (element.id ? `#${element.id}` : '') + classes.slice(0, 2).map(name => `.${name}`).join(''),
      sourcePath,
      computedStyle: { color: computed.color, backgroundColor: computed.backgroundColor, fontSize: computed.fontSize },
    };
  };
  const select = element => {
    active = element;
    highlightTarget = element;
    position(highlightTarget, selected);
    const detail = describe(element);
    const unit = element.closest('[data-htmlwright-unit]');
    detail.unitIndex = unit ? Number(unit.dataset.htmlwrightUnit) : undefined;
    sendPreviewPayload({ type: 'htmlwright:selected', element: detail });
  };
  const sendReady = () => sendPreviewPayload({ type: 'htmlwright:ready', mode: units.length > 1 && !dynamic ? 'unit' : 'page', units: unitData, dynamic });

  document.documentElement.classList.toggle('htmlwright-selecting', selecting);
  document.addEventListener('mousemove', event => {
    if (!selecting || document.getElementById(PREVIEW_ID)) return;
    const element = event.target instanceof Element ? event.target.closest('[data-htmlwright-id]') : null;
    position(element, hover);
  }, true);
  document.addEventListener('click', event => {
    if (!selecting || document.getElementById(PREVIEW_ID)) return;
    const element = event.target instanceof Element ? event.target.closest('[data-htmlwright-id]') : null;
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    select(element);
  }, true);
  addEventListener('scroll', () => position(highlightTarget, selected), true);
  addEventListener('resize', () => position(highlightTarget, selected));

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== 'htmlwright:bridge-command') return;
    const command = message.payload || {};
    if (command.type === 'htmlwright:request-state') sendReady();
    if (command.type === 'htmlwright:selection-mode') {
      selecting = Boolean(command.enabled);
      document.documentElement.classList.toggle('htmlwright-selecting', selecting);
      hover.style.display = 'none';
    }
    if (command.type === 'htmlwright:show-candidate' && command.url) {
      document.getElementById(PREVIEW_ID)?.remove();
      const frame = document.createElement('iframe');
      frame.id = PREVIEW_ID;
      frame.src = command.url;
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals');
      document.documentElement.append(frame);
      hover.style.display = 'none';
      selected.style.display = 'none';
    }
    if (command.type === 'htmlwright:highlight-scope') {
      const frame = document.getElementById(PREVIEW_ID);
      if (frame) {
        frame.contentWindow?.postMessage(command, '*');
      } else if (active) {
        highlightTarget = command.scope === 'document'
          ? document.body
          : command.scope === 'page'
            ? (active.closest('[data-htmlwright-unit]') || document.body)
            : active;
        position(highlightTarget, selected);
      }
    }
    if (command.type === 'htmlwright:clear-candidate') document.getElementById(PREVIEW_ID)?.remove();
    if (command.type === 'htmlwright:reload') location.reload();
  });
  sendReady();
}

if (location.protocol === 'file:') {
  window.addEventListener('message', event => {
    const previewFrame = document.getElementById('htmlwright-extension-preview');
    if (!previewFrame || event.source !== previewFrame.contentWindow) return;
    const payload = event.data;
    if (!['htmlwright:ready', 'htmlwright:selected'].includes(payload?.type)) return;
    sendPreviewPayload(payload);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installFileSelector, { once: true });
  else installFileSelector();
} else if (location.pathname === '/preview') {
  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const payload = event.data;
    if (!['htmlwright:ready', 'htmlwright:selected'].includes(payload?.type)) return;
    sendPreviewPayload(payload);
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== 'htmlwright:bridge-command') return;
    window.postMessage(message.payload, '*');
  });

  const requestState = () => window.postMessage({ type: 'htmlwright:request-state' }, '*');
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', requestState, { once: true });
  else requestState();
}
