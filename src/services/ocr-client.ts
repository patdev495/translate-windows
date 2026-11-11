import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { OcrLanguage, OcrProgress, OcrProgressEvent, OcrResult, OcrTier } from './ocr-contract';

export async function requestOcr(
  dataUrl: string,
  tier: OcrTier,
  language: OcrLanguage,
  onProgress?: (progress: OcrProgress) => void,
  signal?: AbortSignal,
): Promise<OcrResult> {
  if (signal?.aborted) throw new Error('OCR canceled.');
  const requestId = crypto.randomUUID();
  const unlisten = await listen<OcrProgressEvent>('ocr-progress', ({ payload }) => {
    if (payload.requestId === requestId) onProgress?.(payload.progress);
  });
  let rejectCancellation!: (error: Error) => void;
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const cancel = () => {
    rejectCancellation(new Error('OCR canceled.'));
    void invoke('cancel_ocr', { requestId }).catch(() => {});
  };
  const timer = window.setTimeout(() => {
    rejectCancellation(new Error('OCR timed out. Capture again.'));
    void invoke('cancel_ocr', { requestId }).catch(() => {});
  }, 120_000);
  window.addEventListener('beforeunload', cancel);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (signal?.aborted) throw new Error('OCR canceled.');
    return await Promise.race([
      invoke<OcrResult>('request_ocr', { request: { requestId, dataUrl, tier, language } }),
      cancellation,
    ]);
  } finally {
    window.clearTimeout(timer);
    window.removeEventListener('beforeunload', cancel);
    signal?.removeEventListener('abort', cancel);
    unlisten();
  }
}
