import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TranslationTooltip } from './content/tooltip';
import { SettingsManager } from './services/settings';

interface Breakdown { character: string; path: string[]; reading: string }
const view = new TranslationTooltip();
let current: Breakdown;
async function show(value: Breakdown) {
  current = value;
  const settings = await SettingsManager.getSettings();
  view.updateFontSize(settings.tooltipFontSize);
  view.updateHanziBreakdownSettings(true,settings.hanziBreakdownLanguage);
  await view.showDesktopBreakdown(value.character,value.path,value.reading);
  const root = document.getElementById('translation-extension-hanzi-breakdown-root');
  if (!root) return;
  root.style.cssText += ';position:relative;left:0;top:0;right:auto;margin:10px;';
  const card = root.shadowRoot?.querySelector<HTMLElement>('.hanzi-breakdown-card');
  if (card) card.style.cssText += ';width:100%;max-width:none;max-height:calc(100vh - 20px);overflow:auto;';
  root.shadowRoot?.querySelector('.hanzi-breakdown-heading')?.addEventListener('mousedown',event => {
    event.preventDefault(); event.stopImmediatePropagation(); void getCurrentWindow().startDragging();
  },true);
}
window.addEventListener('DOMContentLoaded', () => {
  void invoke<Breakdown>('get_hanzi_breakdown_data').then(show);
  void listen<Breakdown>('hanzi-breakdown-changed',event => { void show(event.payload); });
  void listen('settings-changed',() => { if (current) void show(current); });
  window.addEventListener('keydown',event => { if (event.key === 'Escape') void invoke('close_hanzi_breakdown'); });
});
