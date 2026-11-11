/** A frameset is not a normal body: paint extension UI in the top layer. */
export function mountOverlay(host: HTMLElement, doc: Document = document): void {
  if (doc.body?.tagName !== 'FRAMESET') {
    (doc.body ?? doc.documentElement).appendChild(host);
    return;
  }
  let layer = doc.getElementById('polytranslate-presentation-layer');
  if (!layer) {
    layer = doc.createElement('div');
    layer.id = 'polytranslate-presentation-layer';
    layer.style.cssText = 'all:initial;position:fixed;inset:0;width:100vw;height:100vh;margin:0;padding:0;border:0;max-width:none;max-height:none;overflow:visible;background:transparent;pointer-events:none;z-index:2147483647';
    const shadow = layer.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = ':host::backdrop { background: transparent; pointer-events: none; }';
    shadow.append(style, doc.createElement('slot'));
    doc.documentElement.appendChild(layer);
    if (typeof layer.showPopover === 'function') {
      layer.setAttribute('popover', 'manual');
      layer.showPopover();
    }
  }
  // One top-layer entry lets z-index order cards, regardless of creation time.
  host.style.pointerEvents ||= 'auto';
  layer.appendChild(host);
}

export function hideOverlaysForCapture(doc: Document = document): () => void {
  const hosts = Array.from(doc.querySelectorAll<HTMLElement>(
    '#translation-extension-root, #translation-extension-hanzi-breakdown-root, #polytranslate-ocr-overlay-root, .polytranslate-pinned-wrapper',
  ));
  const previous = hosts.map(host => host.style.visibility);
  hosts.forEach(host => { host.style.visibility = 'hidden'; });
  return () => hosts.forEach((host, index) => { host.style.visibility = previous[index]; });
}
