import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { currentMonitor, getCurrentWindow, LogicalPosition, LogicalSize } from '@tauri-apps/api/window';
import { TranslationTooltip } from './content/tooltip';
import { SettingsManager } from './services/settings';

interface Breakdown { character: string; path: string[]; reading: string }
const view = new TranslationTooltip();
let current: Breakdown;
let revision = 0;
let stopLayout = () => {};
let positioned = false;
async function show(value: Breakdown) {
  current = value;
  const token = ++revision;
  stopLayout();
  const [settings, monitor] = await Promise.all([SettingsManager.getSettings(), currentMonitor()]);
  if (token !== revision) return;
  view.updateFontSize(settings.tooltipFontSize);
  view.updateHanziBreakdownSettings(true,settings.hanziBreakdownLanguage);
  await view.showDesktopBreakdown(value.character,value.path,value.reading);
  if (token !== revision) return;
  const root = document.getElementById('translation-extension-hanzi-breakdown-root');
  if (!root?.shadowRoot) return;
  const scale = monitor?.scaleFactor || 1;
  const area = (monitor?.workArea?.size ?? monitor?.size)?.toLogical(scale);
  const origin = (monitor?.workArea?.position ?? monitor?.position)?.toLogical(scale);
  const width = Math.min(480, Math.max(1, (area?.width || 1000) - 32));
  const maxHeight = Math.max(1, (area?.height || 800) - 32);
  root.style.cssText = `position:relative;left:0;top:0;margin:0;width:${width}px;--tooltip-font-size:${settings.tooltipFontSize}px;`;
  // Keep this rule on the shadow root: drilling into a component replaces the
  // card asynchronously, and must not bring back its page-overlay shadow/inset.
  const nativeStyle = root.shadowRoot.querySelector<HTMLStyleElement>('#native-breakdown-layout') ?? document.createElement('style');
  nativeStyle.id = 'native-breakdown-layout';
  nativeStyle.textContent = `.hanzi-breakdown-card{width:100%;max-width:none;max-height:${maxHeight}px;margin:0;border:0;outline:none;box-shadow:none;scrollbar-width:thin;scrollbar-color:#a1a1a1 transparent;}`;
  root.shadowRoot.append(nativeStyle);
  let lastHeight = 0;
  const fit = async () => {
    if (token !== revision) return;
    const card = root.shadowRoot?.querySelector<HTMLElement>('.hanzi-breakdown-card');
    if (!card) return;
    const height = Math.min(maxHeight, Math.max(1, Math.ceil(card.getBoundingClientRect().height * scale) / scale));
    if (height === lastHeight) return;
    lastHeight = height;
    await getCurrentWindow().setSize(new LogicalSize(width,height));
    if (token !== revision || positioned) return;
    positioned = true;
    await getCurrentWindow().setPosition(new LogicalPosition(
      (origin?.x || 0) + ((area?.width || 1000) - width) / 2,
      (origin?.y || 0) + ((area?.height || 800) - height) / 2));
  };
  const resized = new ResizeObserver(() => { void fit(); });
  resized.observe(root);
  const changed = new MutationObserver(() => { void fit(); });
  changed.observe(root.shadowRoot,{childList:true,subtree:true});
  stopLayout = () => { resized.disconnect(); changed.disconnect(); };
  await fit();
}
window.addEventListener('DOMContentLoaded', () => {
  void invoke<Breakdown>('get_hanzi_breakdown_data').then(show);
  void listen<Breakdown>('hanzi-breakdown-changed',event => { void show(event.payload); });
  void listen('settings-changed',() => { if (current) void show(current); });
  window.addEventListener('keydown',event => { if (event.key === 'Escape') void invoke('close_hanzi_breakdown'); });
  window.addEventListener('beforeunload',() => { revision++; stopLayout(); });
});
