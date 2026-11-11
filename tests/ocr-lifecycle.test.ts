// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';

const runtime = vi.hoisted(() => ({
  sessions: [] as Array<{ release: ReturnType<typeof vi.fn>; inputNames: string[]; outputNames: string[] }>,
  failAt: -1,
  attempts: 0,
  run: async () => ({ output: { data: new Float32Array(1024), dims: [1, 1, 32, 32] } }),
}));

vi.mock('onnxruntime-web', () => ({
  env: { wasm: {} },
  Tensor: class {
    constructor(public type: string, public data: unknown, public dims: number[]) {}
    dispose() {}
  },
  InferenceSession: {
    create: vi.fn(async () => {
      if (runtime.attempts++ === runtime.failAt) throw new Error('Model could not be initialized');
      const session = { release: vi.fn(async () => {}), inputNames: ['input'], outputNames: ['output'], run: () => runtime.run() };
      runtime.sessions.push(session);
      return session;
    }),
  },
}));

import { getActiveOcrModelKey, preloadOcrModel, recognizeWithBlocks, unloadOcrModel } from '../src/services/ocr';
import { startOcrHost } from '../src/services/ocr-host';
import { SettingsManager } from '../src/services/settings';

function canvas(): HTMLCanvasElement {
  return {
    width: 4, height: 4,
    getContext: () => ({
      drawImage: () => {},
      getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: () => {},
    }),
  } as unknown as HTMLCanvasElement;
}

beforeEach(() => {
  localStorage.clear();
  runtime.sessions = [];
  runtime.failAt = -1;
  runtime.attempts = 0;
  runtime.run = async () => ({ output: { data: new Float32Array(1024), dims: [1, 1, 32, 32] } });
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode('a\nb\nc\n').buffer,
  })));
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request: any = {};
      const store = {
        get: () => {
          const get: any = { result: null };
          queueMicrotask(() => get.onsuccess());
          return get;
        },
        put: () => {
          const put: any = {};
          queueMicrotask(() => put.onsuccess());
          return put;
        },
      };
      request.result = {
        objectStoreNames: { contains: () => true },
        transaction: () => ({ objectStore: () => store }),
        close: () => {},
      };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  });
});

afterEach(async () => {
  await unloadOcrModel();
  clearMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('prepares the entire Latin pipeline once and releases it when OCR is disabled', async () => {
  await preloadOcrModel('medium', 'latin');
  await preloadOcrModel('medium', 'latin');
  // Paddle detector/recognizer plus VietOCR CNN, encoder and decoder.
  expect(runtime.sessions).toHaveLength(5);
  await unloadOcrModel();
  expect(runtime.sessions.every((session) => session.release.mock.calls.length === 1)).toBe(true);
});

test('simultaneous preload callers share the same prepared model', async () => {
  const [first, second] = await Promise.all([
    preloadOcrModel('medium', 'latin'),
    preloadOcrModel('medium', 'latin'),
  ]);
  expect(first === second).toBe(true);
});

test('a partially failed model load releases resources and a later request can retry', async () => {
  runtime.failAt = 3; // VietOCR encoder fails after the Paddle sessions have loaded.
  await expect(preloadOcrModel('medium', 'latin')).rejects.toThrow('Model could not be initialized');
  expect(runtime.sessions.every((session) => session.release.mock.calls.length === 1)).toBe(true);
  runtime.failAt = -1;
  await expect(preloadOcrModel('medium', 'latin')).resolves.toBeDefined();
});

test('disabling OCR waits for an active Latin recognition before releasing its model', async () => {
  vi.stubGlobal('HTMLCanvasElement', class {});
  vi.stubGlobal('document', { createElement: () => canvas() });
  await preloadOcrModel('medium', 'latin');
  let finish!: () => void;
  let started!: () => void;
  const running = new Promise<void>((resolve) => { started = resolve; });
  runtime.run = async () => {
    started();
    await new Promise<void>((resolve) => { finish = resolve; });
    return { output: { data: new Float32Array(1024), dims: [1, 1, 32, 32] } };
  };
  const recognition = recognizeWithBlocks(canvas(), 'medium', 'latin');
  await running;
  const unloading = unloadOcrModel();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const releasedWhileRunning = runtime.sessions.some((session) => session.release.mock.calls.length > 0);
  finish();
  await recognition;
  await unloading;
  expect(releasedWhileRunning).toBe(false);
  expect(runtime.sessions.every((session) => session.release.mock.calls.length === 1)).toBe(true);
});

test('the main host receives crop images and returns OCR results using its resident model', async () => {
  vi.stubGlobal('document', { createElement: () => canvas() });
  vi.stubGlobal('Image', class {
    naturalWidth = 4;
    naturalHeight = 4;
    onload: null | (() => void) = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  let generation = '';
  let complete!: (value: any) => void;
  const progress: string[] = [];
  mockIPC((command, args: any) => {
    if (command === 'get_app_settings') return { ...SettingsManager.DEFAULT_SETTINGS, ocrLanguage: 'latin' };
    if (command === 'ocr_host_ready') generation = args.generation;
    if (command === 'ocr_progress') progress.push(args.progress.stage);
    if (command === 'complete_ocr') complete(args);
  }, { shouldMockEvents: true });
  const stop = await startOcrHost();
  try {
    for (const jobId of ['one', 'two']) {
      const completed = new Promise<any>((resolve) => { complete = resolve; });
      await emit('ocr-job', { jobId, generation, dataUrl: 'data:image/png;base64,AA==', tier: 'medium', language: 'latin' });
      expect((await completed).result).toEqual({ fullText: '', blocks: [] });
    }
    expect(runtime.sessions).toHaveLength(5);
    expect(progress).toContain('recognizing');
  } finally { await stop(); }
});

test('a settings change during startup wins over an older settings snapshot', async () => {
  let read!: () => void;
  const reading = new Promise<void>((resolve) => { read = resolve; });
  let snapshot!: (value: unknown) => void;
  mockIPC((command) => {
    if (command === 'get_app_settings') {
      read();
      return new Promise((resolve) => { snapshot = resolve; });
    }
  }, { shouldMockEvents: true });
  const starting = startOcrHost();
  await reading;
  await emit('settings-changed', { ...SettingsManager.DEFAULT_SETTINGS, autoTranslate: false });
  snapshot(SettingsManager.DEFAULT_SETTINGS);
  const stop = await starting;
  try { expect(getActiveOcrModelKey()).toBeNull(); }
  finally { await stop(); }
});

test('an already delivered job cannot reload models after automatic translation is disabled', async () => {
  vi.stubGlobal('document', { createElement: () => canvas() });
  vi.stubGlobal('Image', class {
    naturalWidth = 4; naturalHeight = 4; onload: null | (() => void) = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  let generation = '';
  let complete!: (value: any) => void;
  mockIPC((command, args: any) => {
    if (command === 'get_app_settings') return { ...SettingsManager.DEFAULT_SETTINGS, autoTranslate: false };
    if (command === 'ocr_host_ready') generation = args.generation;
    if (command === 'complete_ocr') complete(args);
  }, { shouldMockEvents: true });
  const stop = await startOcrHost();
  try {
    const completed = new Promise<any>((resolve) => { complete = resolve; });
    await emit('ocr-job', { generation, jobId: 'late', dataUrl: 'data:image/png;base64,AA==', tier: 'medium', language: 'ch' });
    expect((await completed).error).toContain('settings changed');
    expect(runtime.sessions).toHaveLength(0);
  } finally { await stop(); }
});

test('turning off translation releases resident OCR while preserving the screen-crop preference',async()=> {
  mockIPC(command=> {
    if(command==='get_app_settings') return {...SettingsManager.DEFAULT_SETTINGS,ocrLanguage:'latin'};
  },{shouldMockEvents:true});
  const stop=await startOcrHost();
  try {
    expect(getActiveOcrModelKey()).not.toBeNull();
    await emit('settings-changed',{...SettingsManager.DEFAULT_SETTINGS,ocrLanguage:'latin',translationActive:false});
    await vi.waitFor(()=>expect(getActiveOcrModelKey()).toBeNull());
  } finally { await stop(); }
});

test('the hidden main window starts the OCR host even when a capture image is pending', async () => {
  mockWindows('main');
  let ready = false;
  mockIPC((command) => {
    if (command === 'get_app_settings') return { ...SettingsManager.DEFAULT_SETTINGS, autoTranslate: false };
    if (command === 'get_capture_image') return 'data:image/png;base64,AA==';
    if (command === 'ocr_host_ready') ready = true;
  }, { shouldMockEvents: true });
  await import('../src/main');
  window.dispatchEvent(new Event('DOMContentLoaded'));
  try { await vi.waitFor(() => expect(ready).toBe(true)); }
  finally {
    window.dispatchEvent(new Event('beforeunload'));
    const { disposeOcrModelLifecycle } = await import('../src/services/ocr-preload');
    await disposeOcrModelLifecycle();
  }
}, 15_000);

test('a tooltip sends its crop to the shared OCR host without creating local sessions', async () => {
  mockWindows('tooltip');
  document.body.innerHTML = '<div id="source-text"></div><div id="phonetic"></div><div id="translation"></div><button id="tts-btn"></button>';
  vi.stubGlobal('Image', class {
    naturalWidth = 4; naturalHeight = 4; onload: null | (() => void) = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(canvas().getContext as any);
  let submitted = false;
  mockIPC((command) => {
    if (command === 'get_app_settings') return { ...SettingsManager.DEFAULT_SETTINGS, autoTranslate: false };
    if (command === 'get_tooltip_data') return { text: '', dataUrl: 'data:image/png;base64,AA==' };
    if (command === 'get_capture_image') return null;
    if (command === 'request_ocr') { submitted = true; return { fullText: '', blocks: [] }; }
  }, { shouldMockEvents: true });
  await import('../src/tooltip');
  window.dispatchEvent(new Event('DOMContentLoaded'));
  try {
    await vi.waitFor(() => expect(submitted).toBe(true));
    expect(runtime.sessions).toHaveLength(0);
  } finally {
    const { disposeOcrModelLifecycle } = await import('../src/services/ocr-preload');
    await disposeOcrModelLifecycle();
  }
}, 15_000);
