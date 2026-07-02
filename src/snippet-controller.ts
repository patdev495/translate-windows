import type { WindowAPI } from './overlay-controller';

/**
 * SnippetController manages the draggable pinned snippet sub-window.
 *
 * It shows the cropped image and handles the close button.
 * Dragging is handled by Tauri's native window drag API in the entry script.
 */
export class SnippetController {
  private windowApi: WindowAPI;

  constructor(windowApi: WindowAPI) {
    this.windowApi = windowApi;
  }

  /**
   * Set the image src on the given img element to display the cropped region.
   */
  loadImage(img: HTMLImageElement, dataUrl: string): void {
    img.src = dataUrl;
  }

  /**
   * Attach a click handler to the close button that destroys the window.
   */
  attachCloseButton(btn: HTMLElement): void {
    btn.addEventListener('click', () => {
      this.windowApi.close();
    });
  }
}
