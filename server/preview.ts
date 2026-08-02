const BRIDGE = String.raw`
<style id="htmlwright-bridge-style">
  #htmlwright-hover, #htmlwright-selected { position: fixed; pointer-events: none; z-index: 2147483646; box-sizing: border-box; }
  #htmlwright-hover { border: 1px solid #1f6feb; background: rgba(31,111,235,.08); }
  #htmlwright-selected { border: 2px solid #ef6c35; background: rgba(239,108,53,.08); }
  html.htmlwright-selecting, html.htmlwright-selecting * { cursor: crosshair !important; }
  html.htmlwright-verifying *, html.htmlwright-verifying *::before, html.htmlwright-verifying *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
</style>
<script id="htmlwright-bridge">
(() => {
  const hover = document.createElement('div');
  const selected = document.createElement('div');
  hover.id = 'htmlwright-hover';
  selected.id = 'htmlwright-selected';
  document.documentElement.append(hover, selected);
  const blocked = new Set(['HTML','BODY','SCRIPT','STYLE','LINK','META','HEAD']);
  let selecting = true;
  let active = null;
  let highlightTarget = null;
  let serial = 0;

  const eligible = [...document.querySelectorAll('body *')].filter(el => !blocked.has(el.tagName) && el.id !== hover.id && el.id !== selected.id);
  eligible.forEach(el => el.dataset.htmlwrightId = String(++serial));

  const describe = (el) => {
    const classes = [...el.classList].filter(Boolean);
    const label = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + classes.slice(0, 2).map(c => '.' + c).join('');
    const sourcePath = [];
    let cursor = el;
    while (cursor && cursor !== document.documentElement) {
      const parent = cursor.parentElement;
      if (!parent) break;
      sourcePath.unshift([...parent.children].indexOf(cursor));
      cursor = parent;
    }
    const computed = getComputedStyle(el);
    const text = (el.innerText || el.textContent || '').trim().slice(0, 300);
    return {
      id: el.dataset.htmlwrightId,
      tag: el.tagName.toLowerCase(),
      classes,
      text,
      editableText: el.children.length === 0 ? (el.innerText || el.textContent || '').trim().slice(0, 10000) : undefined,
      outerHTML: el.outerHTML,
      breadcrumb: label,
      sourcePath,
      computedStyle: { color: computed.color, backgroundColor: computed.backgroundColor, fontSize: computed.fontSize }
    };
  };
  const rect = (el, box) => {
    if (!el) { box.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 24 && r.height > 20 && s.display !== 'none' && s.visibility !== 'hidden';
  };
  const unitSelectors = 'section, article, .slide, .page, .screen, .card';
  const allUnits = [...document.querySelectorAll(unitSelectors)].filter(visible);
  const units = allUnits.filter(el => !allUnits.some(parent => parent !== el && parent.contains(el)));
  const isDynamic = [...document.scripts].some(s => !s.id.includes('htmlwright') && ((s.textContent || '').trim().length > 80 || s.src));
  const mode = units.length > 1 && !isDynamic ? 'unit' : 'page';
  units.forEach((el, index) => el.dataset.htmlwrightUnit = String(index));
  const unitData = units.map((el, index) => ({ index, title: (el.querySelector('h1,h2,h3')?.textContent || el.getAttribute('aria-label') || '内容单元 ' + (index + 1)).trim().slice(0, 80), tag: el.tagName.toLowerCase() }));

  const select = (el) => {
    active = el;
    highlightTarget = el;
    rect(highlightTarget, selected);
    const chain = [];
    let cursor = el;
    while (cursor && cursor !== document.body && chain.length < 7) {
      if (cursor.dataset.htmlwrightId) chain.unshift(describe(cursor));
      cursor = cursor.parentElement;
    }
    const unit = el.closest('[data-htmlwright-unit]');
    const detail = describe(el);
    detail.unitIndex = unit ? Number(unit.dataset.htmlwrightUnit) : undefined;
    parent.postMessage({ type: 'htmlwright:selected', element: detail, breadcrumbs: chain }, '*');
  };

  document.documentElement.classList.toggle('htmlwright-selecting', selecting);
  if (new URLSearchParams(location.search).has('verify')) document.documentElement.classList.add('htmlwright-verifying');
  document.addEventListener('mousemove', event => {
    if (!selecting) return;
    const el = event.target instanceof Element ? event.target.closest('[data-htmlwright-id]') : null;
    rect(el, hover);
  }, true);
  document.addEventListener('click', event => {
    if (!selecting) {
      // View mode: hand local .html links to the parent so it can open them for editing;
      // block external navigation from leaving the preview; let same-page anchors scroll.
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!anchor) return;
      const url = new URL(anchor.href);
      const isLocalHtml = url.origin === location.origin && url.pathname.startsWith('/target-assets/') && url.pathname.toLowerCase().endsWith('.html');
      const isInPageHash = url.pathname === location.pathname && !!url.hash;
      if (isLocalHtml) {
        event.preventDefault();
        parent.postMessage({ type: 'htmlwright:navigate', file: decodeURIComponent(url.pathname.slice('/target-assets/'.length)) }, '*');
      } else if (!isInPageHash) {
        event.preventDefault();
      }
      return;
    }
    const el = event.target instanceof Element ? event.target.closest('[data-htmlwright-id]') : null;
    if (!el) return;
    event.preventDefault(); event.stopPropagation();
    select(el);
  }, true);
  addEventListener('scroll', () => { if (selecting) rect(highlightTarget, selected); }, true);
  addEventListener('resize', () => { if (selecting) rect(highlightTarget, selected); });
  addEventListener('message', event => {
    const msg = event.data || {};
    if (msg.type === 'htmlwright:request-state') {
      parent.postMessage({ type: 'htmlwright:ready', mode, units: unitData, dynamic: isDynamic }, '*');
    }
    if (msg.type === 'htmlwright:selection-mode') {
      selecting = Boolean(msg.enabled);
      document.documentElement.classList.toggle('htmlwright-selecting', selecting);
      hover.style.display = 'none';
      // View mode hides the selection outline; switching back restores it on the last target.
      if (selecting) rect(highlightTarget, selected);
      else selected.style.display = 'none';
    }
    if (msg.type === 'htmlwright:select-id') {
      const el = document.querySelector('[data-htmlwright-id="' + CSS.escape(String(msg.id)) + '"]');
      if (el) select(el);
    }
    if (msg.type === 'htmlwright:scroll-unit') {
      document.querySelector('[data-htmlwright-unit="' + Number(msg.index) + '"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (msg.type === 'htmlwright:locate' && Array.isArray(msg.sourcePath)) {
      let node = document.documentElement;
      for (const index of msg.sourcePath) node = node && node.children ? node.children[index] : null;
      if (node && node.nodeType === 1) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightTarget = node;
        rect(node, selected);
      }
    }
    if (msg.type === 'htmlwright:highlight-scope' && active) {
      highlightTarget = msg.scope === 'document'
        ? document.body
        : msg.scope === 'page'
          ? (active.closest('[data-htmlwright-unit]') || document.body)
          : active;
      rect(highlightTarget, selected);
    }
  });
  parent.postMessage({ type: 'htmlwright:ready', mode, units: unitData, dynamic: isDynamic }, '*');
})();
</script>`;

export function injectPreview(html: string, assetBase = "/target-assets/"): string {
  const base = /<base\b/i.test(html) ? "" : `<base href="${assetBase}">`;
  let output = html;
  if (/<head\b[^>]*>/i.test(output)) {
    output = output.replace(/<head\b[^>]*>/i, (match) => `${match}${base}`);
  } else {
    output = `${base}${output}`;
  }
  if (/<\/body\s*>/i.test(output)) {
    return output.replace(/<\/body\s*>/i, `${BRIDGE}</body>`);
  }
  return `${output}${BRIDGE}`;
}

export function stripRuntimeAttributes(html: string): string {
  return html
    .replace(/\sdata-htmlwright-id="[^"]*"/g, "")
    .replace(/\sdata-htmlwright-unit="[^"]*"/g, "");
}
