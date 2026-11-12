import { latencyEvent } from './services/latency';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { currentMonitor, getCurrentWindow, LogicalSize, LogicalPosition } from '@tauri-apps/api/window';
import { requestOcr } from './services/ocr-client';
import { SettingsManager, type Settings } from './services/settings';
import { TranslationCoordinator, type TranslationCoordinatorResult } from './services/translation-coordinator';
import { TranslationTooltip } from './content/tooltip';

interface Payload { text?: string; dataUrl?: string; error?: string; notice?: string; width?: number; translationData?: TranslationCoordinatorResult }
const close = () => invoke('close_tooltip_window');

window.addEventListener('DOMContentLoaded', async () => {
  latencyEvent('view-ready');
  let status = document.getElementById('tooltip-status');
  if (!status) { status = document.createElement('div'); status.id = 'tooltip-status'; document.body.append(status); }
  status.setAttribute('role', 'status');
  status.textContent = 'Đang dịch…';
  try {
    const settings = await SettingsManager.getSettings();
    if (!settings.translationActive) { void close(); return; }
    if ('__TAURI_INTERNALS__' in window) {
      const stop = await listen<Settings>('settings-changed',event => { if (!event.payload.translationActive) void close(); });
      window.addEventListener('beforeunload',stop,{once:true});
    }
    let payload: Payload = {};
    for (let attempt = 0; attempt < 40; attempt++) {
      payload = await invoke<Payload>('get_tooltip_data') || {};
      if (payload.text || payload.dataUrl || payload.error) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (payload.error && !payload.text) {
      status.textContent = payload.error;
      setTimeout(() => { void close(); }, 2000);
      return;
    }
    let text = payload.text || '';
    if (!text && payload.dataUrl) {
      const result = await requestOcr(payload.dataUrl, settings.ocrModelTier, settings.ocrLanguage, progress => { status!.textContent = progress.message; });
      text = result.fullText;
    }
    if (!text.trim()) { status.textContent = 'Không lấy được văn bản'; return; }
    const data = payload.translationData ?? await TranslationCoordinator.translate(text, settings);
    if (!(await SettingsManager.getSettings()).translationActive) { void close(); return; }
    const native = '__TAURI_INTERNALS__' in window;
    const monitor = native ? await currentMonitor() : null;
    const scale = monitor?.scaleFactor || 1;
    const screen = (monitor?.workArea?.size ?? monitor?.size)?.toLogical(scale);
    const origin = (monitor?.workArea?.position ?? monitor?.position)?.toLogical(scale);
    const viewport = native ? { width: screen?.width || 1000, height: screen?.height || 800 } : undefined;
    const tooltip = new TranslationTooltip();
    const configure = (value: Settings) => {
      const hanzi = value as Settings & { hanziStrokeSpeed?: number; hanziBreakdownEnabled?: boolean; hanziBreakdownLanguage?: 'vi' | 'en' };
      tooltip.updateFontSize(value.tooltipFontSize);
      tooltip.updateHanziStrokeSpeed(hanzi.hanziStrokeSpeed ?? 2);
      tooltip.updateHanziBreakdownSettings(hanzi.hanziBreakdownEnabled ?? false, hanzi.hanziBreakdownLanguage ?? 'vi');
      tooltip.updatePhoneticsVisibility(value.phoneticsVisible);
    };
    configure(settings);
    const cropWidth = payload.width ? payload.width / scale : undefined;
    tooltip.show(0, 0, text, data, settings.ttsEnabled, settings.phoneticsVisible, cropWidth, viewport);
    status.remove();
    latencyEvent('result-ready');
    const root = document.getElementById('translation-extension-root')!.shadowRoot!;
    const card = root.querySelector<HTMLElement>('#tooltip')!;
    if (payload.notice) {
      const notice = document.createElement('p'); notice.setAttribute('role', 'status'); notice.textContent = payload.notice; card.prepend(notice);
    }
    if (viewport) {
      const maxHeight = Math.max(1, viewport.height - 32);
      // Round once in physical pixels; rounding CSS pixels first leaves a strip at 150% DPI.
      const pixelAligned = (value: number) => Math.ceil(value * scale) / scale;
      const width = Math.max(1, Math.min(viewport.width - 32, pixelAligned(card.getBoundingClientRect().width) || Math.max(350, cropWidth || 0) + 32));
      let moved = false;
      card.style.cssText += `;position:relative;left:0;top:0;transform:none;margin:0;width:${width}px;max-width:none;max-height:${maxHeight}px;overflow:auto;outline:none;box-shadow:none;`;
      const fit = () => {
        const height = Math.min(maxHeight, Math.max(1, pixelAligned(card.getBoundingClientRect().height) || 120));
        return getCurrentWindow().setSize(new LogicalSize(width,height)).then(() => {
          if (!moved) return getCurrentWindow().setPosition(new LogicalPosition((origin?.x || 0)+(viewport.width-width)/2,(origin?.y || 0)+(viewport.height-height)/2));
        }).catch(error => console.error('Tooltip layout failed:', error));
      };
      await fit();
      if (typeof ResizeObserver !== 'undefined') { const observer = new ResizeObserver(fit); observer.observe(card); window.addEventListener('beforeunload', () => observer.disconnect(), { once: true }); }
      // Intercept before the shared PDF tooltip captures the pointer and moves its DOM card.
      card.addEventListener('pointerdown', event => {
        const target = event.composedPath()[0] as HTMLElement;
        if (event.button || target.closest('button,input,textarea,select,a,.tt-source-text,.tt-translation-text,.tt-phonetic,.tt-lang-badge')) return;
        moved = true;
        event.preventDefault(); event.stopImmediatePropagation(); void getCurrentWindow().startDragging();
      }, true);
      window.addEventListener('blur', () => { setTimeout(() => { void invoke('dismiss_tooltip_if_external'); }, 150); });
      void listen<Settings>('settings-changed', event => { configure(event.payload); fit(); });
    }
    requestAnimationFrame(() => requestAnimationFrame(() => latencyEvent('correct-paint')));
    window.addEventListener('translation-tooltip-hidden', () => { void close(); });
    window.addEventListener('keydown', event => { if (event.key === 'Escape') void close(); });
    window.addEventListener('beforeunload', () => { window.speechSynthesis?.cancel(); }, { once: true });
  } catch (error) {
    latencyEvent('request-error');
    status.textContent = error instanceof Error ? error.message : String(error);
    console.error('Tooltip failed:', error);
  }
});
