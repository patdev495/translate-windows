import { describe, expect, test } from 'vitest';
import { getScreenRectMapper, mapOverlayRectToScreenRect } from '../src/screen-rect';

describe('screen rect mapping', () => {
  test('maps overlay CSS pixels into monitor logical coordinates without DPI double-scaling', () => {
    const rect = mapOverlayRectToScreenRect(
      { x: 100, y: 50, width: 200, height: 80 },
      {
        screenX: 1920,
        screenY: 0,
        screenWidth: 1920,
        screenHeight: 1080,
        viewportWidth: 1920,
        viewportHeight: 1080,
      }
    );

    expect(rect).toEqual({ x: 2020, y: 50, width: 200, height: 80 });
  });

  test('compensates only for viewport-to-monitor mismatch, not physical DPI scale', () => {
    const mapper = getScreenRectMapper(
      new URLSearchParams('screenX=0&screenY=0&screenWidth=1920&screenHeight=1080&scaleFactor=1.5'),
      1536,
      864
    );

    expect(mapper?.({ x: 100, y: 80, width: 200, height: 120 })).toEqual({
      x: 125,
      y: 100,
      width: 250,
      height: 150,
    });
  });
});
