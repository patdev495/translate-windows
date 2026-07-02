import { invoke } from "@tauri-apps/api/core";
import { OverlayController } from "./overlay-controller";

let greetInputEl: HTMLInputElement | null;
let greetMsgEl: HTMLElement | null;

async function greet() {
  if (greetMsgEl && greetInputEl) {
    greetMsgEl.textContent = await invoke("greet", {
      name: greetInputEl.value,
    });
  }
}

const windowApi = {
  close: () => {
    invoke("close_overlay");
  }
};

const overlayController = new OverlayController(windowApi);

window.addEventListener("DOMContentLoaded", async () => {
  // Try to load capture image if in overlay mode
  try {
    const imgUrl = await invoke<string | null>("get_capture_image");
    if (imgUrl) {
      // Switch DOM to overlay mode
      document.body.classList.add("overlay-mode");
      const mainContainer = document.getElementById("main-container");
      if (mainContainer) {
        mainContainer.style.display = "none";
      }

      const overlayBg = document.getElementById("overlay-bg") as HTMLImageElement | null;
      if (overlayBg) {
        overlayBg.src = imgUrl;
        overlayBg.style.display = "block";
      }

      // Bind Escape key listener to close overlay
      window.addEventListener("keydown", (e) => {
        overlayController.handleKeyDown(e);
      });
      return;
    }
  } catch (err) {
    console.error("Failed to query capture image:", err);
  }

  // Fallback / Standard main window settings UI
  greetInputEl = document.querySelector("#greet-input");
  greetMsgEl = document.querySelector("#greet-msg");
  document.querySelector("#greet-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    greet();
  });
});
