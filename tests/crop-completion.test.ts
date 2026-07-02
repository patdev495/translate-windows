// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { handleCompletedCrop, handleCropImageActions } from '../src/crop-completion';
import type { CropRect } from '../src/crop-selector';

function makeRect(): CropRect {
  return { x: 24.4, y: 36.6, width: 140.2, height: 80.8 };
}

describe('handleCompletedCrop', () => {
  test('sends a frontend cropped data URL to the Tauri crop processor', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);

    const result = await handleCompletedCrop('data:image/png;base64,AAAA', makeRect(), {
      invoke,
      getSettings: vi.fn().mockResolvedValue({ ocrPinImage: true, ocrCopyToClipboard: false }),
    });

    expect(invoke).toHaveBeenCalledWith('process_crop', {
      dataUrl: 'data:image/png;base64,AAAA',
      x: 24,
      y: 37,
      width: 140,
      height: 81,
      displayWidth: 140,
      displayHeight: 81,
      ocrPinImage: true,
      ocrCopyToClipboard: false,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      dataUrl: 'data:image/png;base64,AAAA',
      screenRect: { x: 24, y: 37, width: 140, height: 81 },
    });
  });

  test('captures the selected area natively when the overlay has no preloaded screenshot', async () => {
    const invoke = vi.fn().mockResolvedValue('data:image/png;base64,NATIVE');

    const result = await handleCompletedCrop(null, makeRect(), {
      invoke,
      getSettings: vi.fn().mockResolvedValue({ ocrPinImage: false, ocrCopyToClipboard: true }),
    });

    expect(invoke).toHaveBeenCalledWith('process_crop_area', {
      x: 24,
      y: 37,
      width: 140,
      height: 81,
      displayWidth: 140,
      displayHeight: 81,
      ocrPinImage: false,
      ocrCopyToClipboard: true,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.dataUrl).toBe('data:image/png;base64,NATIVE');
  });

  test('uses transformed screen coordinates for native area capture', async () => {
    const invoke = vi.fn().mockResolvedValue('data:image/png;base64,NATIVE');

    const result = await handleCompletedCrop(null, makeRect(), {
      invoke,
      getSettings: vi.fn().mockResolvedValue({ ocrPinImage: false, ocrCopyToClipboard: false }),
      toScreenRect: (rect) => ({
        x: rect.x + 1920,
        y: rect.y + 120,
        width: rect.width * 1.25,
        height: rect.height * 1.25,
      }),
    });

    expect(invoke).toHaveBeenCalledWith('process_crop_area', {
      x: 1944,
      y: 157,
      width: 175,
      height: 101,
      displayWidth: 140,
      displayHeight: 81,
      ocrPinImage: false,
      ocrCopyToClipboard: false,
    });
    expect(result.screenRect).toEqual({ x: 1944, y: 157, width: 175, height: 101 });
  });

  test('does not pin or copy cropped images before OCR succeeds', async () => {
    const invoke = vi.fn().mockResolvedValue('data:image/png;base64,NATIVE');

    await handleCompletedCrop(null, makeRect(), {
      invoke,
      getSettings: vi.fn().mockResolvedValue({ ocrPinImage: true, ocrCopyToClipboard: true }),
    });

    expect(invoke).not.toHaveBeenCalledWith('open_snippet_window', expect.anything());
    expect(invoke).not.toHaveBeenCalledWith('copy_image_to_clipboard', expect.anything());
  });

  test('can pin or copy the crop image without running OCR', async () => {
    const invoke = vi.fn().mockResolvedValue('data:image/png;base64,NATIVE');

    const result = await handleCropImageActions(null, makeRect(), {
      invoke,
      getSettings: vi.fn().mockResolvedValue({ ocrPinImage: true, ocrCopyToClipboard: true }),
      toScreenRect: (rect) => ({
        x: rect.x + 1920,
        y: rect.y + 120,
        width: rect.width,
        height: rect.height,
      }),
    });

    expect(invoke).toHaveBeenNthCalledWith(1, 'process_crop_image_actions', {
      dataUrl: null,
      x: 1944,
      y: 157,
      width: 140,
      height: 81,
      displayWidth: 140,
      displayHeight: 81,
      ocrPinImage: true,
      ocrCopyToClipboard: true,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'close_overlay');
    expect(invoke).not.toHaveBeenCalledWith('process_crop_area', expect.anything());
    expect(result).toEqual({
      dataUrl: 'data:image/png;base64,NATIVE',
      screenRect: { x: 1944, y: 157, width: 140, height: 81 },
    });
  });

  test('closes the overlay when crop image actions are disabled', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);

    const result = await handleCropImageActions(null, makeRect(), {
      invoke,
      getSettings: vi.fn().mockResolvedValue({ ocrPinImage: false, ocrCopyToClipboard: false }),
    });

    expect(invoke).toHaveBeenCalledWith('close_overlay');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });
});
