import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
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

type TooltipPayload = { text: string; dataUrl?: string; x?: number; y?: number } | null;

async function waitForTooltipData(maxAttempts = 40, intervalMs = 50): Promise<TooltipPayload> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const data = await invoke<TooltipPayload>("get_tooltip_data");
    if (data?.text || data?.dataUrl) {
      return data;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return invoke<TooltipPayload>("get_tooltip_data");
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

  let ocrText = "";
  let dataUrl = "";

  try {
    const data = await waitForTooltipData();
    if (data?.text) {
      ocrText = data.text;
    } else if (data?.dataUrl) {
      dataUrl = data.dataUrl;
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
});
