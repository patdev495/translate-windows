import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { SnippetController } from "./snippet-controller";

const windowApi = {
  close: () => {
    const label = getCurrentWindow().label;
    invoke("close_snippet_window", { label });
  },
};

const controller = new SnippetController(windowApi);
const CLOSE_GUTTER = 20;

interface SnippetPayload {
  dataUrl: string;
  displayWidth?: number;
  displayHeight?: number;
}

function getDisplaySize(payload: SnippetPayload, img: HTMLImageElement): { width: number; height: number } {
  const width = Math.max(24, Math.ceil(payload.displayWidth || img.naturalWidth || img.clientWidth || 80));
  const height = Math.max(24, Math.ceil(payload.displayHeight || img.naturalHeight || img.clientHeight || 1));
  return { width, height };
}

async function resizeToImage(img: HTMLImageElement, payload: SnippetPayload): Promise<void> {
  const { width, height } = getDisplaySize(payload, img);
  const card = document.getElementById("snippet-card") as HTMLElement | null;
  const windowWidth = width + CLOSE_GUTTER;

  if (card) {
    card.style.width = `${windowWidth}px`;
    card.style.height = `${height}px`;
  }
  img.style.width = `${width}px`;
  img.style.height = `${height}px`;
  img.style.objectFit = "contain";
  await getCurrentWindow().setSize(new LogicalSize(windowWidth, height));
}

window.addEventListener("DOMContentLoaded", async () => {
  const label = getCurrentWindow().label;

  // Fetch cropped image data URL from Rust state keyed by this window's label
  let payload: SnippetPayload = { dataUrl: "" };
  try {
    const data = await invoke<SnippetPayload>("get_snippet_data", { label });
    payload = data ?? payload;
  } catch (err) {
    console.error("[Snippet] Failed to load snippet data:", err);
  }

  const img = document.getElementById("snippet-img") as HTMLImageElement;
  const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;
  const card = document.getElementById("snippet-card") as HTMLElement | null;

  controller.loadImage(img, payload.dataUrl);
  if (img.complete && img.naturalWidth > 0) {
    void resizeToImage(img, payload);
  } else {
    img.addEventListener("load", () => {
      void resizeToImage(img, payload);
    }, { once: true });
  }
  controller.attachCloseButton(closeBtn);
  card?.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button")) return;
    event.preventDefault();
    void getCurrentWindow().startDragging();
  });
});
