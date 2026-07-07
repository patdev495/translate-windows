import { invoke } from "@tauri-apps/api/core";
import { OverlayController } from "./overlay-controller";
import { CropSelector, type CropRect } from "./crop-selector";
import { handleCompletedCrop, handleCropImageActions } from "./crop-completion";
import { SettingsManager } from "./services/settings";
import { initializeOcrModelLifecycle } from "./services/ocr-preload";
import { getScreenRectMapper } from "./screen-rect";
import { recognizeWithBlocks } from "./services/ocr";
import { TranslationEngine } from "./services/translation";
import { getDetectionTarget, getTranslationTargets } from "./services/translation-plan";
import {
  getDockedRecordingOverlayBounds,
  getRecordingControlPosition,
  getTopRecordingHoverStripBounds,
  getTopRecordingToolbarBounds,
  RecordingOverlayController,
  type RecordingCommandApi,
} from "./recording-overlay";

const windowApi = {
  close: () => {
    invoke("close_overlay");
  }
};

const overlayController = new OverlayController(windowApi);

window.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const isOverlayWindow = params.get("overlay") === "1";
  const isRecordingWindow = params.get("recording") === "1";

  // Compute logical (CSS-pixel) viewport dimensions from the physical screen
  // dimensions embedded in the URL params. window.innerWidth/Height can be 0
  // during DOMContentLoaded on a window created with visible=false because the
  // browser has not finished layout yet. Dividing by devicePixelRatio converts
  // physical pixels → CSS pixels and works synchronously without requestAnimationFrame.
  const physW = Number(params.get("screenWidth"));
  const physH = Number(params.get("screenHeight"));
  const dpr = window.devicePixelRatio || 1;
  const logicalW = physW > 0 ? Math.round(physW / dpr) : window.innerWidth;
  const logicalH = physH > 0 ? Math.round(physH / dpr) : window.innerHeight;

  const toScreenRect = getScreenRectMapper(params, logicalW, logicalH) ?? ((rect: CropRect) => rect);
  if (isOverlayWindow && isRecordingWindow) {
    document.documentElement.classList.add("overlay-mode");
    document.body.classList.add("overlay-mode");
    document.getElementById("main-container")?.setAttribute("hidden", "");

    const cropCanvas = document.getElementById("crop-canvas") as HTMLCanvasElement | null;
    if (cropCanvas) {
      cropCanvas.style.display = "block";
      cropCanvas.width = logicalW;
      cropCanvas.height = logicalH;
      setupRecordingOverlay(cropCanvas, toScreenRect);
      void invoke("show_overlay");
    }

    window.addEventListener("keydown", (e) => {
      overlayController.handleKeyDown(e);
    });

    return;
  }
  // ── Overlay mode ─────────────────────────────────────────────────────────
  try {
    const imgUrl = await invoke<string | null>("get_capture_image");
    if (isOverlayWindow || imgUrl) {
      // Preload OCR model in the overlay window
      void initializeOcrModelLifecycle();
      // Switch DOM to overlay mode
      document.documentElement.classList.add("overlay-mode");
      document.body.classList.add("overlay-mode");

      const mainContainer = document.getElementById("main-container");
      if (mainContainer) {
        mainContainer.style.display = "none";
      }

      // Show the background screenshot
      const overlayBg = document.getElementById("overlay-bg") as HTMLImageElement | null;
      if (overlayBg && imgUrl) {
        overlayBg.src = imgUrl;
        overlayBg.style.display = "block";
      }

      // Show and size the crop canvas
      const cropCanvas = document.getElementById("crop-canvas") as HTMLCanvasElement | null;
      if (cropCanvas) {
        cropCanvas.style.display = "block";
        // Use logicalW/H derived from URL params (not window.innerWidth which can be
        // 0 before layout is computed). Correct canvas size ensures the idle mask fills
        // the whole screen and the crop-selector maps coordinates correctly.
        cropCanvas.width = logicalW;
        cropCanvas.height = logicalH;

        const selector = new CropSelector(cropCanvas, {
          onCrop: async (dataUrl: string | null, rect: CropRect) => {
            console.log(
              "[PolyTranslate] Crop selected:",
              rect,
              dataUrl ? dataUrl.substring(0, 80) + "..." : "(native area capture)"
            );
            try {
              const settings = await SettingsManager.getSettings();
              if (!settings.autoTranslate) {
                await handleCropImageActions(dataUrl, rect, {
                  invoke,
                  toScreenRect,
                  getSettings: () => Promise.resolve(settings),
                });
                return;
              }

              if (dataUrl) {
                await runOverlayTranslation(dataUrl, rect, toScreenRect, cropCanvas);
              } else {
                await handleCompletedCrop(dataUrl, rect, {
                  invoke,
                  toScreenRect,
                  getSettings: () => SettingsManager.getSettings(),
                });
              }
            } catch (err) {
              console.error("[PolyTranslate] process_crop invoke failed:", err);
            }
          },
        });
        selector.attach(); // draws dark idle mask on the canvas
        // Reveal the overlay window now that canvas is correctly sized and drawn.
        // The backend created it with visible=false to prevent WebView2's white flash.
        void invoke("show_overlay");
      }

      // Escape key still closes the overlay
      window.addEventListener("keydown", (e) => {
        overlayController.handleKeyDown(e);
      });

      return;
    }
  } catch (err) {
    console.error("Failed to query capture image:", err);
  }

  // ── Standard main window (settings / greet placeholder) ─────────────────
  void initializeOcrModelLifecycle();
  document.getElementById("main-container")?.setAttribute("hidden", "");
});

function setupRecordingOverlay(
  cropCanvas: HTMLCanvasElement,
  toScreenRect: (r: CropRect) => CropRect
): void {
  const controlBar = document.getElementById("recording-control-bar") as HTMLDivElement | null;
  const status = document.getElementById("recording-status") as HTMLDivElement | null;
  const startBtn = document.getElementById("recording-start-btn") as HTMLButtonElement | null;
  const stopBtn = document.getElementById("recording-stop-btn") as HTMLButtonElement | null;
  const cancelBtn = document.getElementById("recording-cancel-btn") as HTMLButtonElement | null;

  if (!controlBar || !status || !startBtn || !stopBtn || !cancelBtn) {
    return;
  }

  const api: RecordingCommandApi = {
    start: (rect) => invoke("start_screen_recording", {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    }),
    dock: (bounds) => invoke("dock_recording_overlay", {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    }),
    stop: () => invoke<string | null>("stop_screen_recording"),
    cancel: () => invoke("cancel_screen_recording"),
    close: () => invoke("close_overlay"),
  };
  const controller = new RecordingOverlayController(api);

  const render = () => {
    const state = controller.getState();
    startBtn.style.display = state.status === "ready" || state.status === "error" ? "inline-flex" : "none";
    stopBtn.style.display = state.status === "recording" ? "inline-flex" : "none";
    cancelBtn.textContent = state.status === "saved" || state.status === "discarded" ? "Close" : "Cancel";

    if (state.status === "recording" && state.startedAt) {
      const elapsed = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
      const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const seconds = String(elapsed % 60).padStart(2, "0");
      status.textContent = `Recording ${minutes}:${seconds}`;
      return;
    }

    if (state.status === "saved") {
      status.textContent = "Saved";
      return;
    }

    if (state.status === "discarded") {
      status.textContent = "Discarded";
      return;
    }

    status.textContent = state.error ?? (state.status === "ready" ? "Ready" : "Select area");
  };
  const controlSize = { width: 300, height: 52 };
  const topToolbarSize = { width: 300, height: 60 };
  const topHoverStripSize = { width: 300, height: 8 };
  let dockBounds: ReturnType<typeof getDockedRecordingOverlayBounds> | null = null;
  let controlsDockedAtTop = false;

  const selector = new CropSelector(cropCanvas, {
    onCrop: (_dataUrl, rect) => {
      const rounded = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      const screenRect = toScreenRect(rounded);
      controller.selectRegion(rect, screenRect);

      const position = getRecordingControlPosition(
        rect,
        { width: window.innerWidth || cropCanvas.width, height: window.innerHeight || cropCanvas.height },
        controlSize
      );
      dockBounds = getDockedRecordingOverlayBounds(position, controlSize);
      controlBar.style.left = `${position.x}px`;
      controlBar.style.top = `${position.y}px`;
      controlBar.style.display = "flex";
      render();
    },
  });

  selector.attach();

  let timer: number | undefined;
  const startTimer = () => {
    window.clearInterval(timer);
    timer = window.setInterval(render, 500);
  };
  const stopTimer = () => {
    window.clearInterval(timer);
    timer = undefined;
  };

  startBtn.onclick = async () => {
    await controller.start();
    if (controller.getState().status === "recording" && dockBounds) {
      const hoverBounds = getTopRecordingHoverStripBounds(
        { width: cropCanvas.width },
        topHoverStripSize
      );
      await controller.dockControls(hoverBounds);
      cropCanvas.style.display = "none";
      controlBar.style.left = "0px";
      controlBar.style.top = "8px";
      controlBar.style.display = "none";
      controlsDockedAtTop = true;
    }
    startTimer();
    render();
  };

  window.addEventListener("mouseenter", async () => {
    if (!controlsDockedAtTop || controller.getState().status !== "recording") return;
    const toolbarBounds = getTopRecordingToolbarBounds(
      { width: cropCanvas.width },
      topToolbarSize
    );
    await controller.dockControls(toolbarBounds);
    controlBar.style.display = "flex";
    render();
  });

  window.addEventListener("mouseleave", async () => {
    if (!controlsDockedAtTop || controller.getState().status !== "recording") return;
    const hoverBounds = getTopRecordingHoverStripBounds(
      { width: cropCanvas.width },
      topHoverStripSize
    );
    controlBar.style.display = "none";
    await controller.dockControls(hoverBounds);
  });

  stopBtn.onclick = async () => {
    stopTimer();
    await controller.stop();
    controlsDockedAtTop = false;
    render();
  };

  cancelBtn.onclick = async () => {
    stopTimer();
    await controller.cancel();
  };
}

function sampleBackgroundColor(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bbox: { x: number; y: number; width: number; height: number }
): string {
  const points = [
    { x: bbox.x, y: bbox.y }, // Top-left
    { x: bbox.x + bbox.width / 2, y: bbox.y }, // Top-middle
    { x: bbox.x + bbox.width, y: bbox.y }, // Top-right
    { x: bbox.x, y: bbox.y + bbox.height / 2 }, // Middle-left
    { x: bbox.x + bbox.width, y: bbox.y + bbox.height / 2 }, // Middle-right
    { x: bbox.x, y: bbox.y + bbox.height }, // Bottom-left
    { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height }, // Bottom-middle
    { x: bbox.x + bbox.width, y: bbox.y + bbox.height }, // Bottom-right
  ];

  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  for (const pt of points) {
    const px = Math.min(Math.max(Math.round(pt.x), 0), width - 1);
    const py = Math.min(Math.max(Math.round(pt.y), 0), height - 1);
    try {
      const data = ctx.getImageData(px, py, 1, 1).data;
      rSum += data[0];
      gSum += data[1];
      bSum += data[2];
      count++;
    } catch (e) {
      // Ignore
    }
  }

  if (count === 0) {
    return "rgb(255, 255, 255)";
  }

  const r = Math.round(rSum / count);
  const g = Math.round(gSum / count);
  const b = Math.round(bSum / count);
  return `rgb(${r}, ${g}, ${b})`;
}

function getContrastColor(rgbStr: string): string {
  const match = rgbStr.match(/\d+/g);
  if (!match || match.length < 3) {
    return "#000000";
  }
  const r = parseInt(match[0], 10);
  const g = parseInt(match[1], 10);
  const b = parseInt(match[2], 10);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "#000000" : "#ffffff";
}

async function runOverlayTranslation(
  dataUrl: string,
  rect: CropRect,
  toScreenRect: (r: CropRect) => CropRect,
  cropCanvas: HTMLCanvasElement
) {
  // Hide the crop canvas
  cropCanvas.style.display = "none";

  // Show a loading spinner centered on the crop region
  const spinnerContainer = document.createElement("div");
  spinnerContainer.className = "overlay-spinner-container";
  spinnerContainer.style.left = `${rect.x + (rect.width - 120) / 2}px`;
  spinnerContainer.style.top = `${rect.y + (rect.height - 60) / 2}px`;
  spinnerContainer.innerHTML = `<div class="overlay-spinner"></div><div>Translating...</div>`;
  document.body.appendChild(spinnerContainer);

  let ocrTextCombined = "";
  try {
    const settings = await SettingsManager.getSettings();

    // 1. Trigger background actions (pin image, copy image)
    const rounded = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    const screenRect = toScreenRect(rounded);
    if (settings.ocrPinImage) {
      void invoke("open_snippet_window", {
        dataUrl,
        x: screenRect.x,
        y: screenRect.y,
        width: screenRect.width,
        height: screenRect.height,
      });
    }
    if (settings.ocrCopyToClipboard) {
      void invoke("copy_image_to_clipboard", { dataUrl });
    }

    // 2. Decode the crop image into canvas for OCR
    const img = new Image();
    img.src = dataUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load crop image"));
    });

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);

    // 3. Recognize blocks
    const { fullText, blocks } = await recognizeWithBlocks(
      canvas,
      settings.ocrModelTier,
      settings.ocrLanguage
    );
    ocrTextCombined = fullText;

    if (blocks.length === 0) {
      spinnerContainer.remove();
      await invoke("close_overlay");
      return;
    }

    // 4. Translate blocks
    const overlayContainer = document.getElementById("translation-overlay-container")!;
    overlayContainer.innerHTML = "";
    overlayContainer.style.display = "block";

    for (const block of blocks) {
      try {
        const detectionTarget = getDetectionTarget(settings);
        const detectionResult = detectionTarget
          ? await TranslationEngine.translateWithSettings(block.text, detectionTarget, settings)
          : { translation: block.text, detectedLang: "auto" };
        const detectedLang = detectionResult.detectedLang || "auto";
        const targets = getTranslationTargets(settings, detectedLang);

        let translatedText = block.text;
        if (targets.length > 0) {
          const target = targets[0];
          if (target.lang === detectionTarget) {
            translatedText = detectionResult.translation;
          } else {
            const res = await TranslationEngine.translateWithSettings(block.text, target.lang, settings);
            translatedText = res.translation;
          }
        }

        const bgColor = sampleBackgroundColor(ctx, canvas.width, canvas.height, block.bbox);
        const textColor = getContrastColor(bgColor);

        const blockX = rect.x + block.bbox.x;
        const blockY = rect.y + block.bbox.y;

        const blockDiv = document.createElement("div");
        blockDiv.className = "translation-block";
        blockDiv.setAttribute("data-original", block.text);
        blockDiv.setAttribute("data-translated", translatedText);
        blockDiv.style.position = "absolute";
        blockDiv.style.left = `${blockX}px`;
        blockDiv.style.top = `${blockY}px`;
        blockDiv.style.width = `${block.bbox.width}px`;
        blockDiv.style.height = `${block.bbox.height}px`;
        blockDiv.style.backgroundColor = bgColor;
        blockDiv.style.color = textColor;

        const calculatedFontSize = Math.max(11, Math.min(24, Math.round(block.bbox.height * 0.75)));
        blockDiv.style.fontSize = `${calculatedFontSize}px`;
        blockDiv.textContent = translatedText;

        overlayContainer.appendChild(blockDiv);
      } catch (err) {
        console.error("Failed to translate block:", err);
      }
    }

    // 5. Position and show the control bar
    const controlBar = document.getElementById("translation-control-bar")!;
    controlBar.style.display = "flex";

    let controlY = rect.y + rect.height + 12;
    if (controlY + 50 > window.innerHeight) {
      controlY = rect.y - 60;
    }
    controlY = Math.max(12, controlY);

    let controlX = rect.x + (rect.width - 320) / 2;
    controlX = Math.max(12, Math.min(controlX, window.innerWidth - 340));

    controlBar.style.left = `${controlX}px`;
    controlBar.style.top = `${controlY}px`;

    // 6. Hook up the control bar events
    const toggleViewBtn = document.getElementById("toggle-view-btn") as HTMLButtonElement;
    const openDetailsBtn = document.getElementById("open-details-btn") as HTMLButtonElement;
    const closeOverlayBtn = document.getElementById("close-overlay-btn") as HTMLButtonElement;

    let showingOriginal = false;
    toggleViewBtn.onclick = () => {
      showingOriginal = !showingOriginal;
      const divs = overlayContainer.getElementsByClassName("translation-block");
      for (let i = 0; i < divs.length; i++) {
        const div = divs[i] as HTMLElement;
        const originalText = div.getAttribute("data-original") || "";
        const translatedText = div.getAttribute("data-translated") || "";
        div.textContent = showingOriginal ? originalText : translatedText;
        if (showingOriginal) {
          div.style.backgroundColor = "rgba(0,0,0,0.7)";
          div.style.color = "#ffffff";
        } else {
          const bgColor = sampleBackgroundColor(ctx, canvas.width, canvas.height, blocks[i].bbox);
          div.style.backgroundColor = bgColor;
          div.style.color = getContrastColor(bgColor);
        }
      }
      toggleViewBtn.textContent = showingOriginal ? "👁 Show Translated" : "👁 Show Original";
    };

    openDetailsBtn.onclick = async () => {
      await invoke("open_tooltip_window", {
        text: ocrTextCombined,
        x: screenRect.x,
        y: screenRect.y,
        width: screenRect.width,
        height: screenRect.height,
      });
      await invoke("close_overlay");
    };

    closeOverlayBtn.onclick = async () => {
      await invoke("close_overlay");
    };

  } catch (err) {
    console.error("Overlay translation failed:", err);
    await invoke("close_overlay");
  } finally {
    spinnerContainer.remove();
  }
}
