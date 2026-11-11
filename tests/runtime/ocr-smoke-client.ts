import { invoke } from '@tauri-apps/api/core';
import { requestOcr } from '../../src/services/ocr-client';

const job = await invoke<any>('smoke_job');
try {
  const started = performance.now();
  const result = await requestOcr(job.dataUrl, job.tier, job.language);
  await invoke('smoke_capture_done', { result: { ...result, durationMs: performance.now() - started } });
} catch (error) {
  await invoke('smoke_capture_done', { result: { error: String(error) } });
}
