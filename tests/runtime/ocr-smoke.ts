import { invoke } from '@tauri-apps/api/core';
import * as ort from 'onnxruntime-web';
import { getActiveOcrModelKey, preloadOcrModel, unloadOcrModel } from '../../src/services/ocr';
import { getOcrModelSettings } from '../../src/services/ocr-preload';
import { requestOcr } from '../../src/services/ocr-client';
import type { OcrLanguage } from '../../src/services/ocr-contract';

let created = 0;
let released = 0;
const originalCreate = ort.InferenceSession.create.bind(ort.InferenceSession);
ort.InferenceSession.create = async (...args: any[]) => {
  const session = await (originalCreate as any)(...args);
  created += 1;
  const release = session.release.bind(session);
  session.release = async () => { await release(); released += 1; };
  return session;
};

function image(language: OcrLanguage, index: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 90;
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'black';
  context.font = '32px "Microsoft YaHei", Arial';
  context.fillText(language === 'ch' ? `你好 世界 ${index}` : `Xin chào Việt Nam ${index}`, 15, 55);
  return canvas.toDataURL('image/png');
}

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Host/settings did not become ready.');
}

const phases: any[] = [];
try {
  await waitFor(() => getOcrModelSettings() !== null);
  const idle = await invoke('smoke_memory');
  for (const language of ['ch', 'latin'] as const) {
    const before = { created, released };
    const loading = performance.now();
    await invoke('smoke_settings', { enabled: true, tier: 'medium', language });
    await waitFor(() => getOcrModelSettings()?.ocrLanguage === language && getOcrModelSettings()?.autoTranslate === true);
    await preloadOcrModel('medium', language);
    const loadMs = performance.now() - loading;
    const loaded = { created, released };
    const samples: any[] = [];
    let memoryAfterFive: unknown;
    for (let index = 0; index < 10; index += 1) {
      const result: any = await invoke('smoke_capture', { job: { dataUrl: image(language, index), tier: 'medium', language } });
      if (result.error) throw new Error(result.error);
      if (!result.fullText.trim()) throw new Error(`Empty OCR text for ${language} capture ${index}.`);
      if (result.blocks.length === 0) throw new Error(`Missing OCR blocks for ${language} capture ${index}.`);
      if (!result.fullText.endsWith(String(index))) throw new Error(`Stale/incorrect text for ${language} capture ${index}: ${result.fullText}`);
      samples.push(result);
      if (index === 4) memoryAfterFive = await invoke('smoke_memory');
    }
    if (created !== loaded.created) throw new Error('Repeated captures recreated ONNX sessions.');
    const memory = await invoke('smoke_memory');
    const afterCaptures = { created, released };
    // Controlled comparison: same final engine and crop IPC, with model unload
    // before each capture. This isolates reload cost; it is not a legacy-app run.
    const reloadPerCaptureSamples: any[] = [];
    for (let index = 0; index < 10; index += 1) {
      const started = performance.now();
      await unloadOcrModel();
      const result: any = await invoke('smoke_capture', { job: { dataUrl: image(language, index), tier: 'medium', language } });
      if (result.error || !result.fullText.endsWith(String(index)) || !result.blocks.length) throw new Error(`Reload comparison failed for ${language}/${index}.`);
      reloadPerCaptureSamples.push({ durationMs: performance.now() - started, ocrMs: result.durationMs });
    }
    phases.push({ language, before, loaded, afterCaptures, loadMs, samples, memoryAfterFive, memory, reloadPerCaptureSamples });
  }
  await invoke('smoke_settings', { enabled: false, tier: 'medium', language: 'latin' });
  await waitFor(() => getOcrModelSettings()?.autoTranslate === false);
  await unloadOcrModel();
  if (getActiveOcrModelKey() !== null || created !== released) throw new Error('Disabling OCR did not release every ONNX session.');
  const disabledMemory = await invoke('smoke_memory');
  await invoke('smoke_settings', { enabled: true, tier: 'tiny', language: 'ch' });
  await waitFor(() => getOcrModelSettings()?.ocrModelTier === 'tiny' && getOcrModelSettings()?.autoTranslate === true);
  const restarted = await requestOcr(image('ch', 11), 'tiny', 'ch');
  if (!restarted.fullText.trim()) throw new Error('OCR failed after re-enabling.');
  await invoke('smoke_settings', { enabled: false, tier: 'tiny', language: 'ch' });
  await waitFor(() => getOcrModelSettings()?.autoTranslate === false);
  await unloadOcrModel();
  await invoke('smoke_report', { result: { created, released, idle, phases, disabledMemory, restarted, userAgent: navigator.userAgent } });
} catch (error) {
  await invoke('smoke_report', { result: { error: String(error), created, released, phases } });
}
