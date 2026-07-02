import type { Settings } from './services/settings';

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface OcrImageActionPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrImageActionDeps {
  invoke: Invoke;
  settings: Pick<Settings, 'ocrCopyToClipboard' | 'ocrPinImage'>;
}

export async function handleOcrImageActions(
  dataUrl: string,
  position: OcrImageActionPosition,
  deps: OcrImageActionDeps
): Promise<void> {
  if (deps.settings.ocrPinImage) {
    try {
      await deps.invoke('open_snippet_window', {
        dataUrl,
        x: Math.round(position.x),
        y: Math.round(position.y),
        width: Math.round(position.width),
        height: Math.round(position.height),
        displayWidth: Math.round(position.width),
        displayHeight: Math.round(position.height),
      });
    } catch (err) {
      console.error('Failed to open pinned cropped image:', err);
    }
  }

  if (deps.settings.ocrCopyToClipboard) {
    try {
      await deps.invoke('copy_image_to_clipboard', { dataUrl });
    } catch (err) {
      console.error('Failed to copy cropped image to clipboard:', err);
    }
  }
}
