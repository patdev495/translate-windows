declare const __LATENCY_SAMPLE_COUNT__: number;
declare const __LATENCY_SOURCE__: string;
declare const __LATENCY_OCR__: boolean;
declare const __LATENCY_SHARED_TEST__: boolean;
declare const __LATENCY_RESTART_TEST__: boolean;
declare const __LATENCY_RECOVERY__: boolean;
import { requestOcr } from '../../src/services/ocr-client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export async function run(label: string): Promise<void> {
  if(label==='tooltip') {
    if (!(globalThis as any).__LATENCY_TOOLTIP_LISTENING__) {
      (globalThis as any).__LATENCY_TOOLTIP_LISTENING__ = true;
      await listen('tooltip-request', () => { void run('tooltip'); });
    }
    try {
      const payload=await invoke<{text:string}>('get_tooltip_data');
      const deadline=Date.now()+30_000;
      while(Date.now()<deadline) {
        const root=document.getElementById('translation-extension-root')?.shadowRoot;
        const translations=[...root?.querySelectorAll('.tt-translation-text') || []];
        if(root?.querySelector('.tt-source-text')?.textContent===payload.text && translations.length===2 && translations.every(node=>node.textContent?.trim())) {
          await invoke('latency_resources',{listeners:(globalThis as any).__LATENCY_LISTENERS__?.size || 0,traceId:(globalThis as any).__TRANSLATION_TRACE_ID__});
          await invoke('latency_event',{stage:'content-verified',durationMs:0,traceId:(globalThis as any).__TRANSLATION_TRACE_ID__});
          return;
        }
        await new Promise(done=>setTimeout(done,25));
      }
      throw new Error('Tooltip content did not match the current request');
    } catch {await invoke('latency_event',{stage:'request-error',durationMs:0,traceId:(globalThis as any).__TRANSLATION_TRACE_ID__});}
    return;
  }
  if (label==='pdf' && __LATENCY_SHARED_TEST__) {
    try {
      const deadline=Date.now()+30_000;
      while(!document.querySelector('.textLayer')?.textContent?.includes('Hello PDF')) {
        if(Date.now()>deadline) throw new Error('PDF did not render');
        await new Promise(done=>setTimeout(done,25));
      }
      const range=document.createRange(); range.selectNodeContents(document.querySelector('.textLayer')!);
      const selection=window.getSelection()!; selection.removeAllRanges();selection.addRange(range);
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'q',code:'KeyQ',altKey:true,bubbles:true}));
      while(!document.getElementById('translation-extension-root')?.shadowRoot?.querySelector('.tt-translation-text')) {
        if(Date.now()>deadline) throw new Error('PDF translation missing');
        await new Promise(done=>setTimeout(done,25));
      }
      if(document.getElementById('translation-extension-root')?.shadowRoot?.querySelector('.tt-source-text')?.textContent?.trim()!=='Hello PDF') throw new Error('PDF source mismatch');
      await invoke('latency_event',{stage:'content-verified',durationMs:0,traceId:(globalThis as any).__TRANSLATION_TRACE_ID__});
      if(__LATENCY_RESTART_TEST__) {
        const before=(await (await fetch('/harness/status')).json()).requests;
        const pending=invoke<any>('desktop_request',{message:{type:'TRANSLATE',text:'Hello',traceId:(globalThis as any).__TRANSLATION_TRACE_ID__}});
        const sending=Date.now()+10_000;
        while((await (await fetch('/harness/status')).json()).requests<=before) {
          if(Date.now()>sending) throw new Error('Provider did not start');
          await new Promise(done=>setTimeout(done,25));
        }
        await invoke('latency_reload_host');
        const old=await pending;
        if(old.success || !old.error?.includes('restarted')) throw new Error('Old host request was not failed clearly');
        const next=await invoke<any>('desktop_request',{message:{type:'TRANSLATE',text:'Hello',traceId:(globalThis as any).__TRANSLATION_TRACE_ID__}});
        if(!next.success || !next.data?.sourcePhonetics?.includes('hə')) throw new Error('Reloaded host did not recover IPA');
      }
      await new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done())));
      await invoke('latency_event',{stage:'correct-paint',durationMs:0,traceId:(globalThis as any).__TRANSLATION_TRACE_ID__});
      if(__LATENCY_RESTART_TEST__) {
        const prefix=JSON.parse(localStorage.getItem('latency-prefix')!);
        prefix.samples.push({id:'pdf-reload',temperature:'warm',content:'PDF host reload',...await invoke<any>('latency_next'),contentVerified:true,error:false});
        await invoke('latency_done',{result:{...prefix,metric:'host-reload-functional',restart:{oldFailed:true,nextSucceeded:true}}});
      }
    } catch {
      if(__LATENCY_RESTART_TEST__) await invoke('latency_done',{result:{error:'Host reload validation failed',samples:[]}});
      else await invoke('latency_event',{stage:'request-error',durationMs:0,traceId:(globalThis as any).__TRANSLATION_TRACE_ID__});
    }
    return;
  }
  if (label !== 'main') return;
  if(__LATENCY_RESTART_TEST__) {
    if(sessionStorage.getItem('latency-running')) return;
    sessionStorage.setItem('latency-running','1');
  }
  const samples: unknown[] = [];
  const memoryCheckpoints: unknown[] = [];
  try {
    // Readiness uses the production RPC and host, not a timer assumption.
    const ready = await invoke<any>('desktop_request', { message: { type: 'GET_ACCOUNT_LINK_STATUS' } });
    if (!ready.success) throw new Error('Host unavailable');
    let painted = false; let failed=false; let contentVerified=false;
    const stopContent=await listen('latency-content-verified',()=> {contentVerified=true;});
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
      if (__LATENCY_RECOVERY__ && index === __LATENCY_SAMPLE_COUNT__ - 1) await invoke('latency_destroy_tooltip');
      painted = false; failed=false; contentVerified=false;
      await invoke('open_tooltip_window', { text: __LATENCY_SOURCE__==='zh' ? (index%2 ? '你好世界。' : `你好世界 ${index}。`) : index % 2 ? 'Hello world.' : `Hello world ${index}.`, x: 100, y: 100, width: 0, height: 0 });
      const deadline = Date.now() + 30_000;
      while ((!painted || !contentVerified) && !failed && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      const sample = await invoke<any>('latency_next');
      samples.push({ id: index, temperature: index ? 'warm' : 'cold', content: index % 2 ? 'repeated' : 'new', ...sample, contentVerified, error: !painted || !contentVerified || failed });
      if (__LATENCY_SAMPLE_COUNT__ > 30 && [9,24,49].includes(index)) {
        memoryCheckpoints.push({ cycle: index+1, ...await invoke<any>('latency_memory') });
        await invoke('latency_next'); // Memory collection is outside the next timed sample.
      }
    }
    if(__LATENCY_SHARED_TEST__) {
      painted=false;failed=false;contentVerified=false;
      if(__LATENCY_RESTART_TEST__) localStorage.setItem('latency-prefix',JSON.stringify({samples,memoryBefore,acquisition:'excluded',ocr:'off',targets:2}));
      await invoke('open_pdf_window');
      if(__LATENCY_RESTART_TEST__) {stop();stopContent();return;}
      const deadline=Date.now()+30_000;
      while((!painted || !contentVerified) && !failed && Date.now()<deadline) await new Promise(done=>setTimeout(done,25));
      samples.push({id:'pdf',temperature:'warm',content:'PDF selection',...await invoke<any>('latency_next'),contentVerified,error:!painted||!contentVerified||failed});
    }
    stop();stopContent();
    await invoke('latency_done', { result: { metric: 'text-ready-to-correct-paint', acquisition: 'excluded', ocr: __LATENCY_OCR__ ? 'concurrent-explicit-recognition' : 'off', ocrResult: await ocrResult, sourceLanguage: __LATENCY_SOURCE__, targets: 2, memoryBefore, memoryCheckpoints, recovery: __LATENCY_RECOVERY__, memoryAfter: await invoke('latency_memory'), samples } });
  } catch { await invoke('latency_done', { result: { error: 'Harness failed', samples } }); }
}
