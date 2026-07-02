// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { handleOcrImageActions } from '../src/ocr-image-actions';

describe('handleOcrImageActions', () => {
  test('pins and copies the cropped image when both settings are enabled', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);

    await handleOcrImageActions('data:image/png;base64,CROP', { x: 12.4, y: 45.6, width: 120.2, height: 40.8 }, {
      invoke,
      settings: { ocrPinImage: true, ocrCopyToClipboard: true },
    });

    expect(invoke).toHaveBeenCalledWith('open_snippet_window', {
      dataUrl: 'data:image/png;base64,CROP',
      x: 12,
      y: 46,
      width: 120,
      height: 41,
      displayWidth: 120,
      displayHeight: 41,
    });
    expect(invoke).toHaveBeenCalledWith('copy_image_to_clipboard', {
      dataUrl: 'data:image/png;base64,CROP',
    });
  });

  test('does not run disabled crop image actions', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);

    await handleOcrImageActions('data:image/png;base64,CROP', { x: 0, y: 0, width: 1, height: 1 }, {
      invoke,
      settings: { ocrPinImage: false, ocrCopyToClipboard: false },
    });

    expect(invoke).not.toHaveBeenCalled();
  });

  test('continues to copy if pinning fails', async () => {
    const invoke = vi.fn().mockImplementation(async (command: string) => {
      if (command === 'open_snippet_window') throw new Error('pin failed');
      return undefined;
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await handleOcrImageActions('data:image/png;base64,CROP', { x: 0, y: 0, width: 1, height: 1 }, {
      invoke,
      settings: { ocrPinImage: true, ocrCopyToClipboard: true },
    });

    expect(invoke).toHaveBeenCalledWith('copy_image_to_clipboard', {
      dataUrl: 'data:image/png;base64,CROP',
    });
    errorSpy.mockRestore();
  });
});
