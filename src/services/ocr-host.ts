import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { recognizeWithBlocks, unloadOcrModel } from './ocr';
import { disposeOcrModelLifecycle, getOcrModelSettings, initializeOcrModelLifecycle } from './ocr-preload';
import type { OcrJob, OcrProgress, OcrResult } from './ocr-contract';

async function decodeCrop(dataUrl: string): Promise<HTMLCanvasElement> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Failed to decode crop image.'));
    image.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare the OCR image.');
  context.drawImage(image, 0, 0);
  return canvas;
}

export async function startOcrHost(): Promise<() => Promise<void>> {
  const generation = crypto.randomUUID();
  let stopped = false;
  const unlisten = await listen<OcrJob>('ocr-job', ({ payload: job }) => {
    if (stopped || job.generation !== generation) return;
    void run(job).catch((error) => console.error('Failed to deliver OCR result:', error));
  });

  async function run(job: OcrJob): Promise<void> {
    let result: OcrResult | null = null;
    let error: string | null = null;
    const onProgress = (progress: OcrProgress) => {
      if (!stopped) void invoke('ocr_progress', { generation, jobId: job.jobId, progress }).catch(() => {});
    };
    const checkSettings = () => {
      const settings = getOcrModelSettings();
      if (stopped || !settings || !settings.translationActive || (!settings.autoTranslate && !job.allowDisabled) || settings.ocrModelTier !== job.tier || settings.ocrLanguage !== job.language) {
        throw new Error('OCR settings changed. Capture again.');
      }
    };
    try {
      checkSettings();
      const canvas = await decodeCrop(job.dataUrl);
      checkSettings();
      result = await recognizeWithBlocks(canvas, job.tier, job.language, onProgress);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (job.allowDisabled && !getOcrModelSettings()?.autoTranslate) await unloadOcrModel();
    }
    if (!stopped) await invoke('complete_ocr', { generation, jobId: job.jobId, result, error });
  }

  try {
    await initializeOcrModelLifecycle();
    await invoke('ocr_host_ready', { generation });
  } catch (error) {
    unlisten();
    await disposeOcrModelLifecycle();
    throw error;
  }
  return async () => {
    stopped = true;
    unlisten();
    await disposeOcrModelLifecycle();
  };
}
