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
