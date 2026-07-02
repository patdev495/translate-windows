// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { CropSelector } from '../src/crop-selector';

// Minimal canvas stub that records drawn operations
function makeCanvas(w = 800, h = 600): HTMLCanvasElement {
  const events: Record<string, EventListener[]> = {};
  const canvas = {
    width: w,
    height: h,
    addEventListener: vi.fn((evt: string, cb: EventListener) => {
      (events[evt] ??= []).push(cb);
    }),
    removeEventListener: vi.fn((evt: string, cb: EventListener) => {
      if (events[evt]) events[evt] = events[evt].filter(h => h !== cb);
    }),
    getContext: vi.fn(() => ({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      setLineDash: vi.fn(),
    })),
    getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0, width: w, height: h })),
    // helper to fire events in tests
    _fire: (type: string, init: Partial<MouseEvent>) => {
      const e = { ...init, type, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent;
      (events[type] ?? []).forEach(h => h(e));
    },
  } as unknown as HTMLCanvasElement & { _fire: (t: string, i: Partial<MouseEvent>) => void };
  return canvas;
}

describe('CropSelector', () => {
  let canvas: ReturnType<typeof makeCanvas>;
  let onCrop: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    canvas = makeCanvas();
    onCrop = vi.fn();
  });

  test('attach binds mousedown on the canvas', () => {
    const selector = new CropSelector(canvas, { onCrop });
    selector.attach();
    expect(canvas.addEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function));
  });

  test('valid drag then mouseup triggers onCrop with rect and deferred image capture', () => {
    const selector = new CropSelector(canvas, { onCrop });
    selector.attach();

    // Simulate drag: mousedown at (10,10), mousemove to (110,210), mouseup
    canvas._fire('mousedown', { clientX: 10, clientY: 10 });
    canvas._fire('mousemove', { clientX: 110, clientY: 210 });
    canvas._fire('mouseup', { clientX: 110, clientY: 210 });

    expect(onCrop).toHaveBeenCalledTimes(1);
    const [calledUrl, rect] = onCrop.mock.calls[0];
    expect(calledUrl).toBeNull();
    expect(rect.x).toBe(10);
    expect(rect.y).toBe(10);
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(200);
  });

  test('extracts from the screenshot using natural image scale rather than CSS pixels', () => {
    const dataUrl = 'data:image/png;base64,SCALED';
    const offscreenCtx = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      setLineDash: vi.fn(),
    };
    const offscreen = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => offscreenCtx),
      toDataURL: vi.fn(() => dataUrl),
    } as unknown as HTMLCanvasElement;
    const bg = document.createElement('img');
    bg.id = 'overlay-bg';
    Object.defineProperties(bg, {
      complete: { value: true },
      naturalWidth: { value: 1600 },
      naturalHeight: { value: 1200 },
    });
    bg.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 800, height: 600 } as DOMRect));
    document.body.append(bg);

    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return offscreen;
      return origCreate(tag);
    });

    const selector = new CropSelector(canvas, { onCrop });
    selector.attach();
    canvas._fire('mousedown', { clientX: 10, clientY: 20 });
    canvas._fire('mouseup', { clientX: 110, clientY: 70 });

    expect(offscreen.width).toBe(200);
    expect(offscreen.height).toBe(100);
    expect(offscreenCtx.drawImage).toHaveBeenCalledWith(bg, 20, 40, 200, 100, 0, 0, 200, 100);

    vi.restoreAllMocks();
  });

  test('zero-size rect (click without drag) does NOT trigger onCrop', () => {
    const selector = new CropSelector(canvas, { onCrop });
    selector.attach();

    canvas._fire('mousedown', { clientX: 50, clientY: 50 });
    canvas._fire('mouseup', { clientX: 50, clientY: 50 });

    expect(onCrop).not.toHaveBeenCalled();
  });

  test('detach removes mouse listeners so further events do not trigger onCrop', () => {
    const dataUrl = 'data:image/png;base64,AAAA';
    const offscreenCtx = { drawImage: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn() };
    const offscreen = { width: 0, height: 0, getContext: vi.fn(() => offscreenCtx), toDataURL: vi.fn(() => dataUrl) } as unknown as HTMLCanvasElement;
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return offscreen;
      return origCreate(tag);
    });

    const selector = new CropSelector(canvas, { onCrop });
    selector.attach();
    selector.detach();

    canvas._fire('mousedown', { clientX: 10, clientY: 10 });
    canvas._fire('mousemove', { clientX: 110, clientY: 210 });
    canvas._fire('mouseup', { clientX: 110, clientY: 210 });

    expect(onCrop).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});
