import type { CropRect } from './crop-selector';
import type { Settings } from './services/settings';
type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface CropCompletionDeps {
  invoke: Invoke;
  toScreenRect?(rect: CropRect): CropRect;
  getSettings(): Promise<Pick<Settings, 'ocrCopyToClipboard' | 'ocrPinImage'>>;
}

export interface CompletedCropResult {
  dataUrl: string | null;
  screenRect: CropRect;
}

function roundRect(rect: CropRect): CropRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

export async function handleCompletedCrop(
  dataUrl: string | null,
  rect: CropRect,
  deps: CropCompletionDeps
): Promise<CompletedCropResult> {
  const rounded = roundRect(rect);
  const screenRect = roundRect(deps.toScreenRect ? deps.toScreenRect(rounded) : rounded);
  const settings = await deps.getSettings();

  if (dataUrl) {
    await deps.invoke('process_crop', {
      dataUrl,
      x: rounded.x,
      y: rounded.y,
      width: rounded.width,
      height: rounded.height,
      displayWidth: rounded.width,
      displayHeight: rounded.height,
      ocrPinImage: settings.ocrPinImage,
      ocrCopyToClipboard: settings.ocrCopyToClipboard,
    });
    return { dataUrl, screenRect };
  }

  const capturedDataUrl = await deps.invoke('process_crop_area', {
    x: screenRect.x,
    y: screenRect.y,
    width: screenRect.width,
    height: screenRect.height,
    displayWidth: rounded.width,
    displayHeight: rounded.height,
    ocrPinImage: settings.ocrPinImage,
    ocrCopyToClipboard: settings.ocrCopyToClipboard,
  }) as string;

  return { dataUrl: capturedDataUrl, screenRect };
}

export async function handleCropImageActions(
  dataUrl: string | null,
  rect: CropRect,
  deps: CropCompletionDeps
): Promise<CompletedCropResult | null> {
  const settings = await deps.getSettings();
  if (!settings.ocrPinImage && !settings.ocrCopyToClipboard) {
    await deps.invoke('close_overlay');
    return null;
  }

  const rounded = roundRect(rect);
  const screenRect = roundRect(deps.toScreenRect ? deps.toScreenRect(rounded) : rounded);
  const capturedDataUrl = await deps.invoke('process_crop_image_actions', {
    dataUrl,
    x: dataUrl ? rounded.x : screenRect.x,
    y: dataUrl ? rounded.y : screenRect.y,
    width: dataUrl ? rounded.width : screenRect.width,
    height: dataUrl ? rounded.height : screenRect.height,
    displayWidth: rounded.width,
    displayHeight: rounded.height,
    ocrPinImage: settings.ocrPinImage,
    ocrCopyToClipboard: settings.ocrCopyToClipboard,
  }) as string;
  await deps.invoke('close_overlay');

  return { dataUrl: capturedDataUrl, screenRect };
}
