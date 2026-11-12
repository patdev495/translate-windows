// @vitest-environment jsdom
import { handleDesktopRequest } from '../src/services/desktop-host';
import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { SettingsManager } from '../src/services/settings';
import { emit } from '@tauri-apps/api/event';

afterEach(() => { clearMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

test('a native Selected Text tooltip renders the extension reading sheet and Chinese learning controls', async () => {
  document.body.innerHTML = readFileSync('tooltip.html', 'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
  localStorage.clear();
  mockWindows('tooltip');
  mockIPC((cmd,args: any) => {
    if (cmd === 'get_app_settings') return { ...SettingsManager.DEFAULT_SETTINGS, secondaryTargetLang: 'none', ttsEnabled: false };
    if (cmd === 'get_tooltip_data') return { text: '我', dataUrl: '' };
    if (cmd === 'get_desktop_values') return {};
    if (cmd === 'desktop_request') return args.message.type==='TRANSLATE' ? handleDesktopRequest(args.message) : { success: true, status: { state: 'unlinked' } };
    if (cmd === 'plugin:window|current_monitor') return null;
  }, { shouldMockEvents: true });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [[['tôi', '我']], null, 'zh'] })));
  await import('../src/tooltip');
  window.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() => {
    const root = document.getElementById('translation-extension-root')?.shadowRoot;
    expect(root?.querySelector('.tt-source-text')?.textContent).toBe('我');
    expect(root?.querySelector('.tt-translation-text')?.textContent).toBe('tôi');
    expect(root?.querySelector('.tt-save-button')).not.toBeNull();
  }, { timeout: 4000 });
}, 60_000);

test('a native tooltip keeps the extension measured width and centers in usable monitor space at high DPI',async()=> {
  document.body.innerHTML=readFileSync('tooltip.html','utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
  mockWindows('tooltip');
  const positioned: unknown[]=[];
  const sized: unknown[]=[];
  const bounds = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return this.id === 'tooltip' ? new DOMRect(0, 0, 642, 210) : bounds.call(this);
  });
  mockIPC((command,args)=> {
    if(command==='get_app_settings') return {...SettingsManager.DEFAULT_SETTINGS,secondaryTargetLang:'none',ttsEnabled:false};
    if(command==='desktop_request') return handleDesktopRequest((args as any).message);
    if(command==='get_tooltip_data') return {text:'我',dataUrl:''};
    if(command==='plugin:window|current_monitor') return {name:'test',size:{width:1600,height:1200},position:{x:-1600,y:0},workArea:{position:{x:-1600,y:0},size:{width:1600,height:1120}},scaleFactor:2};
    if(command==='plugin:window|set_position') positioned.push(args);
    if(command==='plugin:window|set_size') sized.push(args);
  },{shouldMockEvents:true});
  vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0));
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>[[['tôi','我']],null,'zh']})));
  await import('../src/tooltip'); window.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(()=>expect(positioned).toMatchObject([{value:{position:{type:'Logical',x:-721,y:175}}}]));
  expect(sized).toMatchObject([{value:{size:{type:'Logical',width:642,height:210}}}]);
});

test('one loaded tooltip accepts a new request after dismissal without showing the old card', async () => {
  document.body.innerHTML = '<div id="tooltip-status"></div>';
  mockWindows('tooltip');
  const data = (requestId: string, text: string) => ({ requestId, text, translationData: { detectedLang: 'zh', translations: [{ lang: 'vi', text: `dịch ${text}`, phonetics: '' }] } });
  mockIPC(command => {
    if (command === 'get_app_settings') return { ...SettingsManager.DEFAULT_SETTINGS, ttsEnabled: false };
    if (command === 'get_tooltip_data') return data('1', '我');
    if (command === 'plugin:window|current_monitor') return null;
  }, { shouldMockEvents: true });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  await import('../src/tooltip'); window.dispatchEvent(new Event('DOMContentLoaded'));
  const source = () => document.getElementById('translation-extension-root')?.shadowRoot?.querySelector('.tt-source-text')?.textContent;
  await vi.waitFor(() => expect(source()).toBe('我'));
  await emit('tooltip-dismissed', { requestId: '1' });
  await emit('tooltip-request', data('2', '你'));
  await vi.waitFor(() => expect(source()).toBe('你'));
  expect(document.getElementById('translation-extension-root')?.shadowRoot?.querySelector('.tt-translation-text')?.textContent).toBe('dịch 你');
});

test('a dismissed request cannot return through a delayed payload event', async () => {
  document.body.innerHTML = '<div id="tooltip-status"></div>';
  mockWindows('tooltip');
  const payload = { requestId: '10', text: '我', translationData: { detectedLang: 'zh', translations: [] } };
  mockIPC(command => {
    if (command === 'get_app_settings') return SettingsManager.DEFAULT_SETTINGS;
    if (command === 'get_tooltip_data') return payload;
    if (command === 'plugin:window|current_monitor') return null;
  }, { shouldMockEvents: true });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  await import('../src/tooltip'); window.dispatchEvent(new Event('DOMContentLoaded'));
  const card = () => document.getElementById('translation-extension-root')?.shadowRoot?.querySelector<HTMLElement>('#tooltip');
  await vi.waitFor(() => expect(card()?.textContent).toContain('我'));
  await emit('tooltip-dismissed', { requestId: '10' });
  await emit('tooltip-request', payload);
  await new Promise(done => setTimeout(done, 100));
  expect(card()?.style.display).toBe('none');
  expect(card()?.textContent).toBe('');
});

test('dismissal arriving before its payload prevents that payload from rendering', async () => {
  document.body.innerHTML = '<div id="tooltip-status"></div>';
  mockWindows('tooltip');
  mockIPC(command => {
    if (command === 'get_app_settings') return SettingsManager.DEFAULT_SETTINGS;
    if (command === 'get_tooltip_data') return null;
    if (command === 'plugin:window|current_monitor') return null;
  }, { shouldMockEvents: true });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  await import('../src/tooltip'); window.dispatchEvent(new Event('DOMContentLoaded'));
  await new Promise(done => setTimeout(done, 50));
  await emit('tooltip-dismissed', { requestId: '20' });
  await emit('tooltip-request', { requestId: '20', text: '我', translationData: { detectedLang: 'zh', translations: [] } });
  await new Promise(done => setTimeout(done, 100));
  expect(document.getElementById('translation-extension-root')).toBeNull();
});

test('a failed acquisition reveals its notice in the initially hidden native window', async () => {
  document.body.innerHTML = '<div id="tooltip-status"></div>';
  mockWindows('tooltip');
  const layouts: unknown[] = [];
  mockIPC((command, args) => {
    if (command === 'get_app_settings') return SettingsManager.DEFAULT_SETTINGS;
    if (command === 'get_tooltip_data') return { requestId: '30', error: 'Không lấy được văn bản' };
    if (command === 'plugin:window|current_monitor') return null;
    if (command === 'layout_tooltip_window') layouts.push(args);
  }, { shouldMockEvents: true });
  await import('../src/tooltip'); window.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() => expect(layouts).toMatchObject([{ requestId: '30', width: 420, height: 100 }]));
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Không lấy được văn bản');
});

test('a warm request uses its source monitor scale rather than the hidden window monitor', async () => {
  document.body.innerHTML = '';
  mockWindows('tooltip');
  const layouts: any[] = [];
  mockIPC((command,args) => {
    if(command==='get_app_settings') return SettingsManager.DEFAULT_SETTINGS;
    if(command==='get_tooltip_data') return {requestId:'40',x:-1200,y:100,text:'我',translationData:{detectedLang:'zh',translations:[]}};
    if(command==='plugin:window|monitor_from_point') return {name:'source',size:{width:1600,height:1200},position:{x:-1600,y:0},workArea:{position:{x:-1600,y:0},size:{width:1600,height:1120}},scaleFactor:2};
    if(command==='plugin:window|current_monitor') throw new Error('Hidden window monitor is stale');
    if(command==='layout_tooltip_window') layouts.push(args);
  },{shouldMockEvents:true});
  vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0));
  await import('../src/tooltip');window.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(()=>expect(layouts).toMatchObject([{requestId:'40',scale:2,center:true}]));
});

test('a settings change while a valid host reply is in transit prevents the old native card from painting',async()=> {
  document.body.innerHTML=readFileSync('tooltip.html','utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
  localStorage.clear(); mockWindows('tooltip');
  let settings={...SettingsManager.DEFAULT_SETTINGS,secondaryTargetLang:'none' as const,ttsEnabled:false};
  let closes=0;
  mockIPC(async(command,args: any)=> {
    if(command==='get_app_settings') return settings;
    if(command==='get_tooltip_data') return {text:'Hello'};
    if(command==='close_tooltip_window') closes++;
    if(command==='plugin:window|current_monitor') return null;
    if(command==='desktop_request') {
      const response=await handleDesktopRequest(args.message);
      if(args.message.type==='TRANSLATE') {
        settings={...settings,primaryTargetLang:'zh'};
        await emit('settings-changed',settings);
      }
      return response;
    }
  },{shouldMockEvents:true});
  vi.stubGlobal('fetch',async(url: RequestInfo | URL)=>new Response(JSON.stringify(String(url).includes('cmu-dict.json') ? {hello:'həˈloʊ'} : [[['xin chào','Hello']],null,'en'])));
  vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0));
  await import('../src/tooltip'); window.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(()=>expect(closes).toBeGreaterThan(0));
  expect(document.getElementById('translation-extension-root')).toBeNull();
});
