import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { TooltipController } from "./tooltip-controller";
import { recognizeWithBlocks } from "./services/ocr";
import type { OcrProgress } from "./services/ocr";
import { SettingsManager } from "./services/settings";
import { initializeOcrModelLifecycle } from "./services/ocr-preload";

const windowApi = {
  close: () => {
    invoke("close_tooltip_window");
  },
};

const controller = new TooltipController(windowApi);

type TooltipData = {
  text: string;
  dataUrl?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
} | null;

const MIN_TOOLTIP_WIDTH = 320;
const DEFAULT_TOOLTIP_WIDTH = 420;
const TOOLTIP_WIDTH_SCREEN_RATIO = 0.9;
const TOOLTIP_HEIGHT_SCREEN_RATIO = 0.8;
const TOOLTIP_WINDOW_PADDING = 32;
const MIN_TOOLTIP_HEIGHT = 120;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForTooltipData(maxAttempts = 40, intervalMs = 50): Promise<TooltipData> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const data = await invoke<TooltipData>("get_tooltip_data");
    if (data?.text || data?.dataUrl) {
      return data;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return invoke<TooltipData>("get_tooltip_data");
}

async function resizeAndCenterTooltip(card: HTMLElement, payload: TooltipData): Promise<void> {
  const appWindow = getCurrentWindow();
  const monitor = await currentMonitor();
  const monitorSize = monitor?.size.toLogical(monitor.scaleFactor);
  const monitorPosition = monitor?.position.toLogical(monitor.scaleFactor);
  const screenWidth = monitorSize?.width ?? window.screen.availWidth ?? DEFAULT_TOOLTIP_WIDTH;
  const screenHeight = monitorSize?.height ?? window.screen.availHeight ?? 600;
  const screenX = monitorPosition?.x ?? 0;
  const screenY = monitorPosition?.y ?? 0;
  const maxWidth = Math.max(MIN_TOOLTIP_WIDTH, Math.floor(screenWidth * TOOLTIP_WIDTH_SCREEN_RATIO));
  const maxHeight = Math.max(MIN_TOOLTIP_HEIGHT, Math.floor(screenHeight * TOOLTIP_HEIGHT_SCREEN_RATIO));
  const preferredWidth = payload?.width
    ? Math.ceil(payload.width + TOOLTIP_WINDOW_PADDING)
    : DEFAULT_TOOLTIP_WIDTH;
  const width = clamp(preferredWidth, MIN_TOOLTIP_WIDTH, maxWidth);

  card.style.width = `${width}px`;
  card.style.height = "auto";
  card.style.maxHeight = `${maxHeight}px`;
  await nextFrame();

  const naturalHeight = Math.ceil(card.scrollHeight);
  const height = clamp(naturalHeight, MIN_TOOLTIP_HEIGHT, maxHeight);
  card.style.height = `${height}px`;

  await appWindow.setSize(new LogicalSize(width, height));
  await appWindow.setPosition(new LogicalPosition(
    screenX + (screenWidth - width) / 2,
    screenY + (screenHeight - height) / 2
  ));
}

function attachNativeDrag(card: HTMLElement): void {
  card.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, select, textarea, a")) {
      return;
    }
    event.preventDefault();
    void getCurrentWindow().startDragging();
  });
}

function attachOutsideFocusClose(card: HTMLElement): void {
  let ignoreBlurUntil = 0;

  card.addEventListener("pointerdown", () => {
    ignoreBlurUntil = Date.now() + 1200;
  }, true);

  const closeAfterBlur = () => {
    window.setTimeout(() => {
      if (Date.now() < ignoreBlurUntil) return;
      windowApi.close();
    }, 80);
  };

  window.addEventListener("blur", closeAfterBlur);

  void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (focused) return;
    closeAfterBlur();
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  const tooltipCard = document.getElementById("tooltip-card") as HTMLElement;
  const sourceEl = document.getElementById("source-text") as HTMLElement;
  const phoneticEl = document.getElementById("phonetic") as HTMLElement;
  const translationEl = document.getElementById("translation") as HTMLElement;
  const ttsBtn = document.getElementById("tts-btn") as HTMLButtonElement;
  const translationLangEl = document.getElementById("translation-lang") as HTMLElement | null;
  const settings = await SettingsManager.getSettings();
  void initializeOcrModelLifecycle();

  if (tooltipCard) {
    controller.attachDismissHandlers(tooltipCard);
    attachNativeDrag(tooltipCard);
    attachOutsideFocusClose(tooltipCard);
  } else {
    controller.attachEscapeClose();
  }

  let tooltipPayload: TooltipData = null;
  let ocrText = "";
  let dataUrl = "";

  try {
    tooltipPayload = await waitForTooltipData();
    if (tooltipPayload?.text) {
      ocrText = tooltipPayload.text;
    } else if (tooltipPayload?.dataUrl) {
      dataUrl = tooltipPayload.dataUrl;
    }
  } catch (err) {
    console.error("[Tooltip] Failed to load tooltip data:", err);
  }

  sourceEl.innerHTML = '<span class="skeleton">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>';
  translationEl.innerHTML = '<span class="skeleton">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>';
  if (translationLangEl) translationLangEl.textContent = "";
  phoneticEl.textContent = "";

  if (!ocrText && dataUrl) {
    try {
      const onProgress = (p: OcrProgress) => {
        translationEl.innerHTML = `<span class="skeleton">&nbsp;</span> ${p.message}`;
      };

      const img = new Image();
      img.src = dataUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to decode crop image"));
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

      const { fullText } = await recognizeWithBlocks(
        canvas,
        settings.ocrModelTier,
        settings.ocrLanguage,
        onProgress
      );
      ocrText = fullText;
    } catch (err) {
      console.error("[Tooltip] OCR failed:", err);
      ocrText = "(OCR failed)";
    }
  }

  await controller.initialize(ocrText, sourceEl, phoneticEl, translationEl, ttsBtn);
  if (tooltipCard) {
    await resizeAndCenterTooltip(tooltipCard, tooltipPayload);
    if ("__TAURI_INTERNALS__" in window) {
      void listen<Awaited<ReturnType<typeof SettingsManager.getSettings>>>("settings-changed", (event) => {
        controller.applyPhoneticsVisibility(event.payload.phoneticsVisible !== false);
        void resizeAndCenterTooltip(tooltipCard, tooltipPayload);
      });
    }
  }
});
