// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { requestOcr } from '../src/services/ocr-client';

afterEach(() => { clearMocks(); vi.useRealTimers(); });

test('returns OCR text and crop-relative blocks, forwarding only its own progress until completion', async () => {
  let requestId = '';
  const progress: string[] = [];
  const result = { fullText: 'hello', blocks: [{ text: 'hello', bbox: { x: 5, y: 7, width: 40, height: 12 } }] };
  mockIPC(async (command, args: any) => {
    if (command === 'request_ocr') {
      requestId = args.request.requestId;
      await emit('ocr-progress', { requestId: 'another-capture', progress: { stage: 'loading', message: 'wrong' } });
      await emit('ocr-progress', { requestId, progress: { stage: 'recognizing', message: 'Reading text' } });
      return result;
    }
  }, { shouldMockEvents: true });
  expect(await requestOcr('data:image/png;base64,AA==', 'medium', 'ch', (event) => progress.push(event.message))).toEqual(result);
  await emit('ocr-progress', { requestId, progress: { stage: 'recognizing', message: 'late' } });
  expect(progress).toEqual(['Reading text']);
});

test('closing a client cancels its OCR request and removes its progress listener', async () => {
  let began!: () => void;
  const started = new Promise<void>((resolve) => { began = resolve; });
  let canceled = '';
  let requestId = '';
  mockIPC((command, args: any) => {
    if (command === 'request_ocr') {
      requestId = args.request.requestId;
      began();
      return new Promise(() => {});
    }
    if (command === 'cancel_ocr') canceled = args.requestId;
  }, { shouldMockEvents: true });
  const progress = vi.fn();
  const request = requestOcr('data:image/png;base64,AA==', 'tiny', 'ch', progress);
  const rejection = expect(request).rejects.toThrow('canceled');
  await started;
  window.dispatchEvent(new Event('beforeunload'));
  await rejection;
  expect(canceled).toBe(requestId);
  await emit('ocr-progress', { requestId, progress: { stage: 'recognizing', message: 'late' } });
  expect(progress).not.toHaveBeenCalled();
});

test('a lost IPC reply times out locally and cancels the native request', async () => {
  vi.useFakeTimers();
  let began!: () => void;
  const started = new Promise<void>((resolve) => { began = resolve; });
  let canceled = false;
  mockIPC((command) => {
    if (command === 'request_ocr') { began(); return new Promise(() => {}); }
    if (command === 'cancel_ocr') canceled = true;
  }, { shouldMockEvents: true });
  let outcome = 'pending';
  void requestOcr('data:image/png;base64,AA==', 'medium', 'ch').catch((error) => { outcome = error.message; });
  await started;
  await vi.advanceTimersByTimeAsync(120_000);
  expect(outcome).toContain('timed out');
  expect(canceled).toBe(true);
});
