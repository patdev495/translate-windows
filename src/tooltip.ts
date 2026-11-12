import { sameTranslationSettings } from './services/translation-settings';
import { requestTranslation } from './services/translation-client';
import { latencyEvent } from './services/latency';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { currentMonitor, monitorFromPoint, getCurrentWindow, LogicalSize, LogicalPosition } from '@tauri-apps/api/window';
import { requestOcr } from './services/ocr-client';
import { SettingsManager, type Settings } from './services/settings';
import type { TranslationCoordinatorResult } from './services/translation-coordinator';
import { TranslationTooltip } from './content/tooltip';

interface Payload { translationPending?: boolean; requestId?: string; traceId?: string; x?: number; y?: number; text?: string; dataUrl?: string; error?: string; notice?: string; width?: number; translationData?: TranslationCoordinatorResult }
let shutdown = () => {};
window.addEventListener('DOMContentLoaded', async () => {
  shutdown();
  const lifetime = new AbortController();
  const stops: (() => void)[] = [];
  let generation = 0;
  let latestRequestId = 0n;
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  let active: Payload | undefined;
  let cancelWork = () => {};
  let configure = (_value: Settings) => {};
  let fit = async () => {};
  let settings: Settings | undefined;
  let tooltip: TranslationTooltip | undefined;
  const reset = () => {
    generation++;
    clearTimeout(blurTimer);
    active = undefined;
    cancelWork(); cancelWork = () => {};
    configure = () => {}; fit = async () => {};
    tooltip?.reset();
    window.speechSynthesis?.cancel();
    window.getSelection()?.removeAllRanges();
    document.getElementById('tooltip-status')?.remove();
  };
  const close = () => {
    const requestId = active?.requestId;
    reset();
    void invoke('close_tooltip_window', { requestId });
  };
  shutdown = () => { reset(); lifetime.abort(); stops.splice(0).forEach(stop => stop()); };
  window.addEventListener('beforeunload', shutdown, { once: true, signal: lifetime.signal });
  window.addEventListener('translation-tooltip-hidden', close, { signal: lifetime.signal });
  window.addEventListener('keydown', event => { if (event.key === 'Escape') close(); }, { signal: lifetime.signal });
  window.addEventListener('blur', () => {
    const token = generation, requestId = active?.requestId;
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => { if (token === generation && active) void invoke('dismiss_tooltip_if_external', { requestId }); }, 150);
  }, { signal: lifetime.signal });

  const render = async (payload: Payload | null) => {
    // A ready snapshot may race a newer event. Native IDs are monotonic.
    if (payload?.requestId) {
      if (BigInt(payload.requestId) <= latestRequestId) return;
      latestRequestId = BigInt(payload.requestId);
    }
    reset();
    if (!payload) return;
    active = payload;
    const token = generation;
    const valid = () => token === generation && !lifetime.signal.aborted;
    if (payload.traceId) (globalThis as any).__TRANSLATION_TRACE_ID__ = payload.traceId;
    const traceId = payload.traceId;
    const showStatus = async () => {
      if (!payload.requestId || !valid()) return;
      const monitor = await (payload.x === undefined ? currentMonitor() : monitorFromPoint(payload.x, payload.y || 0));
      if (!valid()) return;
      const scale = monitor?.scaleFactor || 1;
      const area = (monitor?.workArea?.size ?? monitor?.size)?.toLogical(scale);
      const origin = (monitor?.workArea?.position ?? monitor?.position)?.toLogical(scale);
      await invoke('layout_tooltip_window', { requestId: payload.requestId, scale, width: 420, height: 100,
        x: (origin?.x || 0) + ((area?.width || 1000) - 420) / 2,
        y: (origin?.y || 0) + ((area?.height || 800) - 100) / 2, center: true });
    };
    const abort = new AbortController();
    let observer: ResizeObserver | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    cancelWork = () => { abort.abort(); observer?.disconnect(); clearTimeout(timer); };
    const status = document.createElement('div'); status.id = 'tooltip-status'; status.setAttribute('role', 'status'); status.textContent = 'Đang dịch…'; document.body.append(status);
    try {
      settings = await SettingsManager.getSettings();
      if (!valid()) return;
      const snapshot = settings;
      if (!snapshot.translationActive) { close(); return; }
      if (payload.error && !payload.text) {
        status.textContent = payload.error;
        await showStatus();
        if (!valid()) return;
        timer = setTimeout(() => { if (valid()) close(); }, 2000);
        return;
      }
      let text = payload.text || '';
      if (!text && payload.dataUrl) {
        const result = await requestOcr(payload.dataUrl, snapshot.ocrModelTier, snapshot.ocrLanguage, progress => { if (valid()) status.textContent = progress.message; }, abort.signal);
        text = result.fullText;
      }
      if (!valid()) return;
      if (!text.trim()) { status.textContent = 'Không lấy được văn bản'; await showStatus(); return; }
      const data = payload.translationData ?? await (payload.translationPending
        ? invoke<TranslationCoordinatorResult>('translate_tooltip_request', { requestId: payload.requestId })
        : requestTranslation(text));
      if (!valid()) return;
      const latest = await SettingsManager.getSettings();
      if (!valid()) return;
      if (!sameTranslationSettings(snapshot, latest)) { close(); return; }
      const native = '__TAURI_INTERNALS__' in window;
      const monitor = native ? await (payload.x === undefined ? currentMonitor() : monitorFromPoint(payload.x, payload.y || 0)) : null;
      if (!valid()) return;
      const scale = monitor?.scaleFactor || 1;
      const screen = (monitor?.workArea?.size ?? monitor?.size)?.toLogical(scale);
      const origin = (monitor?.workArea?.position ?? monitor?.position)?.toLogical(scale);
      const viewport = native ? { width: screen?.width || 1000, height: screen?.height || 800 } : undefined;
      tooltip ??= new TranslationTooltip();
      configure = value => {
        tooltip!.updateFontSize(value.tooltipFontSize);
        tooltip!.updateHanziStrokeSpeed(value.hanziStrokeSpeed ?? 2);
        tooltip!.updateHanziBreakdownSettings(value.hanziBreakdownEnabled ?? false, value.hanziBreakdownLanguage ?? 'vi');
        tooltip!.updatePhoneticsVisibility(value.phoneticsVisible);
      };
      configure(latest);
      const cropWidth = payload.width ? payload.width / scale : undefined;
      tooltip.show(0, 0, text, data, latest.ttsEnabled, latest.phoneticsVisible, cropWidth, viewport);
      status.remove();
      latencyEvent('result-ready', 0, traceId);
      const card = document.getElementById('translation-extension-root')!.shadowRoot!.querySelector<HTMLElement>('#tooltip')!;
      if (payload.notice) { const notice = document.createElement('p'); notice.setAttribute('role', 'status'); notice.textContent = payload.notice; card.prepend(notice); }
      if (viewport) {
        const maxHeight = Math.max(1, viewport.height - 32);
        const pixelAligned = (value: number) => Math.ceil(value * scale) / scale;
        const width = Math.max(1, Math.min(viewport.width - 32, pixelAligned(card.getBoundingClientRect().width) || Math.max(350, cropWidth || 0) + 32));
        let moved = false;
        card.style.cssText += `;position:relative;left:0;top:0;transform:none;margin:0;width:${width}px;max-width:none;max-height:${maxHeight}px;overflow:auto;outline:none;box-shadow:none;`;
        fit = async () => {
          if (!valid()) return;
          const height = Math.min(maxHeight, Math.max(1, pixelAligned(card.getBoundingClientRect().height) || 120));
          const x = (origin?.x || 0) + (viewport.width - width) / 2, y = (origin?.y || 0) + (viewport.height - height) / 2;
          if (payload.requestId) {
            await invoke('layout_tooltip_window', { requestId: payload.requestId, scale, width, height, x, y, center: !moved });
          } else {
            await getCurrentWindow().setSize(new LogicalSize(width, height));
            if (valid() && !moved) await getCurrentWindow().setPosition(new LogicalPosition(x, y));
          }
        };
        await fit();
        if (!valid()) return;
        if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(() => { void fit(); }); observer.observe(card); }
        card.addEventListener('pointerdown', event => {
          if (!valid()) return;
          const target = event.composedPath()[0] as HTMLElement;
          if (event.button || target.closest('button,input,textarea,select,a,.tt-source-text,.tt-translation-text,.tt-phonetic,.tt-lang-badge')) return;
          moved = true;
          event.preventDefault(); event.stopImmediatePropagation(); void getCurrentWindow().startDragging();
        }, { capture: true, signal: abort.signal });
      }
      requestAnimationFrame(() => requestAnimationFrame(() => { if (valid()) latencyEvent('correct-paint', 0, traceId); }));
    } catch (error) {
      if (!valid()) return;
      latencyEvent('request-error', 0, traceId);
      status.textContent = error instanceof Error ? error.message : String(error);
      await showStatus();
      console.error('Tooltip failed:', error);
    }
  };
  try {
    // Subscribe before snapshot: no polling, including payloads arriving during boot.
    stops.push(await listen<Payload>('tooltip-request', event => { void render(event.payload); }));
    stops.push(await listen<{requestId?: string}>('tooltip-dismissed', event => {
      const id = event.payload.requestId;
      if (!id || BigInt(id) >= latestRequestId) {
        if (id) latestRequestId = BigInt(id);
        reset();
      }
    }));
    stops.push(await listen<Settings>('settings-changed', event => {
      if (settings && !sameTranslationSettings(settings, event.payload)) { close(); return; }
      settings = event.payload; configure(event.payload); void fit();
    }));
    latencyEvent('view-ready');
    const token = generation;
    const payload = await invoke<Payload | null>('get_tooltip_data');
    if (token === generation) await render(payload);
  } catch (error) { console.error('Tooltip startup failed:', error); }
});
