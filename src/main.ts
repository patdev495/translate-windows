import { invoke } from "@tauri-apps/api/core";
import { OverlayController } from "./overlay-controller";
import { CropSelector, type CropRect } from "./crop-selector";
import { handleCompletedCrop, handleCropImageActions } from "./crop-completion";
import { SettingsManager } from "./services/settings";
import { getScreenRectMapper } from "./screen-rect";

const windowApi = {
  close: () => {
    invoke("close_overlay");
  }
};

const overlayController = new OverlayController(windowApi);

window.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const isOverlayWindow = params.get("overlay") === "1";
  const toScreenRect = getScreenRectMapper(params, window.innerWidth, window.innerHeight);
  // ── Overlay mode ─────────────────────────────────────────────────────────
  try {
    const imgUrl = await invoke<string | null>("get_capture_image");
    if (isOverlayWindow || imgUrl) {
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
        cropCanvas.width = window.innerWidth;
        cropCanvas.height = window.innerHeight;

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

              await handleCompletedCrop(dataUrl, rect, {
                invoke,
                toScreenRect,
                getSettings: () => SettingsManager.getSettings(),
              });
            } catch (err) {
              console.error("[PolyTranslate] process_crop invoke failed:", err);
            }
          },
        });
        selector.attach();
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
  document.getElementById("main-container")?.setAttribute("hidden", "");
});
