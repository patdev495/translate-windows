// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { SettingsManager } from '../src/services/settings';

const reply = (text: string) => ({ detectedLang: 'zh', sourcePhonetics: '', translations: [{ lang: 'vi', text, phonetics: '' }] });
const source = () => document.getElementById('translation-extension-root')?.shadowRoot?.querySelector('.tt-source-text')?.textContent;
const commands: Array<{command: string; args: any}> = [];
afterEach(() => { window.dispatchEvent(new Event('beforeunload')); clearMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
async function boot(payload: unknown, boundary: (command: string, args: any) => unknown = () => undefined) {
  commands.length = 0; document.body.innerHTML = ''; localStorage.clear(); mockWindows('tooltip');
  mockIPC((command, args: any) => {
    commands.push({command,args});
    if (command === 'get_app_settings') return {...SettingsManager.DEFAULT_SETTINGS, ttsEnabled:false};
    if (command === 'get_tooltip_data') return payload;
    if (command === 'plugin:window|current_monitor') return null;
    return boundary(command,args);
  }, { shouldMockEvents: true });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0),0));
  await import('../src/tooltip'); window.dispatchEvent(new Event('DOMContentLoaded'));
}

test('a slow native translation A cannot replace or resize the faster B presentation', async () => {
  let finish!: (value: unknown) => void;
  await boot({requestId:'1',text:'A',translationPending:true}, command => command === 'translate_tooltip_request' ? new Promise(resolve => {finish=resolve;}) : undefined);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await emit('tooltip-request',{requestId:'2',text:'B',translationData:reply('bản B')});
  await vi.waitFor(() => expect(source()).toBe('B'));
  finish(reply('bản A')); await new Promise(done=>setTimeout(done,100));
  expect(source()).toBe('B');
  expect(commands.filter(item=>item.command==='layout_tooltip_window').every(item=>item.args.requestId==='2')).toBe(true);
});

test('dismissal before the native result does not render, show or report a stale paint', async () => {
  let finish!: (value: unknown) => void;
  await boot({requestId:'1',text:'A',translationPending:true}, command => command === 'translate_tooltip_request' ? new Promise(resolve => {finish=resolve;}) : undefined);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await emit('tooltip-dismissed',{requestId:'1'});
  finish(reply('bản A')); await new Promise(done=>setTimeout(done,100));
  expect(source()).toBeUndefined();
  expect(commands.some(item=>item.command==='layout_tooltip_window')).toBe(false);
});

test('the old acquisition notice timer cannot dismiss a newer request', async () => {
  await boot({requestId:'1',error:'Không lấy được văn bản'});
  await vi.waitFor(()=>expect(document.querySelector('[role="status"]')?.textContent).toBe('Không lấy được văn bản'));
  await emit('tooltip-request',{requestId:'2',text:'B',translationData:reply('bản B')});
  await vi.waitFor(()=>expect(source()).toBe('B'));
  await new Promise(done=>setTimeout(done,2100));
  expect(source()).toBe('B');
  expect(commands.some(item=>item.command==='close_tooltip_window')).toBe(false);
});

test('hiding during OCR cancels only that job and ignores its late progress and result', async () => {
  let finish!: (value: unknown) => void;
  let job = '';
  await boot({requestId:'1',dataUrl:'data:image/png;base64,AA=='}, (command,args) => {
    if(command==='request_ocr') {job=args.request.requestId;return new Promise(resolve=>{finish=resolve;});}
  });
  await vi.waitFor(()=>expect(job).not.toBe(''));
  await emit('tooltip-dismissed',{requestId:'1'});
  await emit('tooltip-request',{requestId:'2',text:'B',translationData:reply('bản B')});
  await vi.waitFor(()=>expect(source()).toBe('B'));
  await emit('ocr-progress',{requestId:job,progress:{stage:'recognizing',message:'late A'}});
  finish({fullText:'A',blocks:[]}); await new Promise(done=>setTimeout(done,100));
  expect(source()).toBe('B');
  expect(commands.filter(item=>item.command==='cancel_ocr').map(item=>item.args.requestId)).toEqual([job]);
  expect(commands.some(item=>item.command==='release_ocr')).toBe(false);
});
