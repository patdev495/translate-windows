declare const __LATENCY_SAMPLE_COUNT__: number;
declare const __LATENCY_SOURCE__: string;
declare const __LATENCY_OCR__: boolean;
import { requestOcr } from '../../src/services/ocr-client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export async function run(label: string): Promise<void> {
  if (label !== 'main') return;
  const samples: unknown[] = [];
  try {
    // Readiness uses the production RPC and host, not a timer assumption.
    const ready = await invoke<any>('desktop_request', { message: { type: 'GET_ACCOUNT_LINK_STATUS' } });
    if (!ready.success) throw new Error('Host unavailable');
    let painted = false; let failed=false;
    const stop = await listen<string>('latency-painted', event => { painted = true; failed=event.payload==='request-error'; });
    const memoryBefore = await invoke('latency_memory');
    let ocrResult: Promise<string> | undefined;
    if (__LATENCY_OCR__) {
      const canvas=document.createElement('canvas'); canvas.width=600;canvas.height=90;
      const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,600,90);ctx.fillStyle='black';ctx.font='32px Arial';ctx.fillText('Hello world',15,55);
      ocrResult=requestOcr(canvas.toDataURL(),'medium','latin').then(value=>value.fullText ? 'recognized' : 'empty',()=> 'failed');
    }
    await invoke('latency_next');
    for (let index = 0; index < __LATENCY_SAMPLE_COUNT__; index++) {
      painted = false; failed=false;
      await invoke('open_tooltip_window', { text: __LATENCY_SOURCE__==='zh' ? (index%2 ? '你好世界。' : `你好世界 ${index}。`) : index % 2 ? 'Hello world.' : `Hello world ${index}.`, x: 100, y: 100, width: 0, height: 0 });
      const deadline = Date.now() + 30_000;
      while (!painted && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      const sample = await invoke<any>('latency_next');
      samples.push({ id: index, temperature: index ? 'warm' : 'cold', content: index % 2 ? 'repeated' : 'new', ...sample, error: !painted || failed });
    }
    stop();
    await invoke('latency_done', { result: { metric: 'text-ready-to-correct-paint', acquisition: 'excluded', ocr: __LATENCY_OCR__ ? 'concurrent-explicit-recognition' : 'off', ocrResult: await ocrResult, sourceLanguage: __LATENCY_SOURCE__, targets: 2, memoryBefore, memoryAfter: await invoke('latency_memory'), samples } });
  } catch { await invoke('latency_done', { result: { error: 'Harness failed', samples } }); }
}
