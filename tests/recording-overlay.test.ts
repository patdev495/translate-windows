import { describe, expect, test, vi } from 'vitest';
import {
  createInitialRecordingState,
  getDockedRecordingOverlayBounds,
  getRecordingControlPosition,
  getTopRecordingHoverStripBounds,
  getTopRecordingToolbarBounds,
  RecordingOverlayController,
  type RecordingCommandApi,
} from '../src/recording-overlay';
import type { CropRect } from '../src/crop-selector';

function makeApi(): RecordingCommandApi {
  return {
    start: vi.fn(async () => undefined),
    dock: vi.fn(async () => undefined),
    stop: vi.fn(async () => 'C:\\Videos\\clip.mp4'),
    cancel: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

describe('recording overlay', () => {
  test('initial state waits for a selected region', () => {
    expect(createInitialRecordingState()).toEqual({
      selectedRect: null,
      screenRect: null,
      status: 'selecting',
      error: null,
      savedPath: null,
      startedAt: null,
    });
  });

  test('positions controls below the selected region when there is room', () => {
    const position = getRecordingControlPosition(
      { x: 100, y: 100, width: 300, height: 200 },
      { width: 1000, height: 800 },
      { width: 260, height: 52 }
    );

    expect(position).toEqual({ x: 120, y: 312 });
  });

  test('positions controls above the selected region near the bottom edge', () => {
    const position = getRecordingControlPosition(
      { x: 100, y: 700, width: 300, height: 80 },
      { width: 1000, height: 800 },
      { width: 260, height: 52 }
    );

    expect(position).toEqual({ x: 120, y: 636 });
  });

  test('start calls backend with rounded screen coordinates', async () => {
    const api = makeApi();
    const controller = new RecordingOverlayController(api, () => 1000);
    const selectedRect: CropRect = { x: 10, y: 20, width: 120, height: 80 };
    const screenRect: CropRect = { x: 110.4, y: 220.6, width: 120.2, height: 80.7 };

    controller.selectRegion(selectedRect, screenRect);
    await controller.start();

    expect(api.start).toHaveBeenCalledWith({ x: 110, y: 221, width: 120, height: 81 });
    expect(controller.getState().status).toBe('recording');
    expect(controller.getState().startedAt).toBe(1000);
  });

  test('docked overlay bounds match the visible recording controls', () => {
    expect(getDockedRecordingOverlayBounds(
      { x: 120, y: 312 },
      { width: 260, height: 52 }
    )).toEqual({ x: 120, y: 312, width: 260, height: 52 });
  });

  test('dockControls shrinks the overlay to the recording controls', async () => {
    const api = makeApi();
    const controller = new RecordingOverlayController(api, () => 1000);

    await controller.dockControls({ x: 120, y: 312, width: 260, height: 52 });

    expect(api.dock).toHaveBeenCalledWith({ x: 120, y: 312, width: 260, height: 52 });
  });

  test('top hover strip is centered at the top edge', () => {
    expect(getTopRecordingHoverStripBounds(
      { width: 1000 },
      { width: 300, height: 8 }
    )).toEqual({ x: 350, y: 0, width: 300, height: 8 });
  });

  test('top toolbar is centered at the top edge', () => {
    expect(getTopRecordingToolbarBounds(
      { width: 1000 },
      { width: 300, height: 60 }
    )).toEqual({ x: 350, y: 0, width: 300, height: 60 });
  });

  test('stop stores saved path and moves to saved state', async () => {
    const api = makeApi();
    const controller = new RecordingOverlayController(api, () => 1000);
    controller.selectRegion({ x: 10, y: 20, width: 120, height: 80 }, { x: 10, y: 20, width: 120, height: 80 });
    await controller.start();
    await controller.stop();

    expect(api.stop).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe('saved');
    expect(controller.getState().savedPath).toBe('C:\\Videos\\clip.mp4');
  });

  test('cancel closes overlay after backend cleanup', async () => {
    const api = makeApi();
    const controller = new RecordingOverlayController(api, () => 1000);
    await controller.cancel();

    expect(api.cancel).toHaveBeenCalledTimes(1);
    expect(api.close).toHaveBeenCalledTimes(1);
  });
});
