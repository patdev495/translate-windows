import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('onnxruntime-web', () => ({
  env: { wasm: { wasmPaths: '' } },
}));

vi.mock('ppu-paddle-ocr/web', () => ({
  PaddleOcrService: class MockPaddleOcrService {
    constructor(_opts: unknown) {}
    async initialize() {}
    async recognize(): Promise<{ text: string; blocks: Array<{ text: string; bbox: { x: number; y: number; width: number; height: number } }> }> {
      return {
        text: 'hello world',
        blocks: [
          { text: 'hello', bbox: { x: 5, y: 7, width: 40, height: 12 } },
        ],
      };
    }
  },
}));

import { recognizeScreenRegion } from '../src/services/ocr';

describe('recognizeScreenRegion', () => {
  beforeEach(() => {
    const makeTx = () => ({
      objectStore: () => ({
        get: () => {
          const request = { onsuccess: null as null | (() => void), onerror: null, result: null, error: null };
          queueMicrotask(() => request.onsuccess?.());
          return request;
        },
        put: () => {
          const request = { onsuccess: null as null | (() => void), onerror: null, error: null };
          queueMicrotask(() => request.onsuccess?.());
          return request;
        },
      }),
      oncomplete: null as null | (() => void),
    });
    const db = {
      objectStoreNames: { contains: () => true },
      transaction: () => {
        const tx = makeTx();
        queueMicrotask(() => tx.oncomplete?.());
        return tx;
      },
      close: vi.fn(),
    };
    const open = () => {
      const request = {
        result: db,
        error: null,
        onupgradeneeded: null as null | (() => void),
        onsuccess: null as null | (() => void),
        onerror: null,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    };

    vi.stubGlobal('indexedDB', { open });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
  });

  test('returns OCR blocks with bounding boxes offset to screen coordinates', async () => {
    const canvas = {} as HTMLCanvasElement;

    const result = await recognizeScreenRegion(canvas, { x: 100, y: 200, width: 320, height: 160 });

    expect(result.fullText).toBe('hello world');
    expect(result.blocks).toEqual([
      { text: 'hello', bbox: { x: 105, y: 207, width: 40, height: 12 } },
    ]);
  });
});
