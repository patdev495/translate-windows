// @vitest-environment jsdom
import { handleDesktopRequest } from '../src/services/desktop-host';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { afterEach, expect, test, vi } from 'vitest';
import { createTranslationContext, initTranslationListeners, loadSettings } from '../src/content/translation-init';
import { SettingsManager } from '../src/services/settings';

afterEach(() => { clearMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

test('a standalone Ctrl translates PDF selected text on release while Ctrl+C remains a copy chord', async () => {
  localStorage.clear();
  const settings=await SettingsManager.updateSettings({ translationShortcut: 'Ctrl', secondaryTargetLang: 'none', ttsEnabled: false });
  mockWindows('pdf');
  mockIPC((command,args: any)=> {
    if(command==='get_app_settings') return settings;
    if(command==='desktop_request') return handleDesktopRequest(args.message);
    if(command==='get_desktop_values') return {};
  },{shouldMockEvents:true});
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  const requests = vi.fn(async () => ({ ok: true, json: async () => [[['xin chào', '你好']], null, 'zh'] }));
  vi.stubGlobal('fetch', requests);
  const context = createTranslationContext();
  await loadSettings(context);
  const selection = { rangeCount: 1, isCollapsed: false, toString: () => '你好', getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 40, bottom: 80 }) }) };
  vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection);
  const page = document.createElement('div'); document.body.append(page);
  initTranslationListeners(context, page);
  for (const [type, key, code, ctrlKey] of [['keydown', 'Control', 'ControlLeft', true], ['keydown', 'c', 'KeyC', true], ['keyup', 'c', 'KeyC', true], ['keyup', 'Control', 'ControlLeft', false]] as const) {
    page.dispatchEvent(new KeyboardEvent(type, { key, code, ctrlKey, bubbles: true }));
  }
  expect(requests).not.toHaveBeenCalled();
  page.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, bubbles: true }));
  page.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', bubbles: true }));
  await vi.waitFor(() => expect(document.getElementById('translation-extension-root')?.shadowRoot?.querySelector('.tt-translation-text')?.textContent).toBe('xin chào'));
  context.tooltip.hide();
});

test('PDF target changes while a host reply is in transit suppress the old selected-text result',async()=> {
  localStorage.clear(); mockWindows('pdf');
  let settings={...SettingsManager.DEFAULT_SETTINGS,secondaryTargetLang:'none' as const,ttsEnabled:false};
  const context=createTranslationContext(); let delivered=false;
  mockIPC(async(command,args: any)=> {
    if(command==='get_app_settings') return settings;
    if(command==='get_desktop_values') return {};
    if(command==='desktop_request') {
      const response=await handleDesktopRequest(args.message);
      if(args.message.type==='TRANSLATE') {
        settings={...settings,primaryTargetLang:'en'};
        await loadSettings(context); delivered=true;
      }
      return response;
    }
  },{shouldMockEvents:true});
  vi.stubGlobal('fetch',async()=>new Response(JSON.stringify([[['xin chào','你好']],null,'zh'])));
  vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0));
  await loadSettings(context);
  vi.spyOn(window,'getSelection').mockReturnValue({rangeCount:1,isCollapsed:false,toString:()=> '你好',getRangeAt:()=>({getBoundingClientRect:()=>({left:40,bottom:80})})} as unknown as Selection);
  const page=document.createElement('div');document.body.append(page);initTranslationListeners(context,page);
  page.dispatchEvent(new KeyboardEvent('keydown',{key:'q',code:'KeyQ',altKey:true,bubbles:true}));
  await vi.waitFor(()=>expect(delivered).toBe(true));
  expect(document.getElementById('translation-extension-root')?.shadowRoot?.querySelector('.tt-translation-text')).toBeNull();
});

test('PDF master off-on events invalidate an already completed reply even when a settings read sees only the final state',async()=> {
  localStorage.clear(); mockWindows('pdf');
  let settings={...SettingsManager.DEFAULT_SETTINGS,secondaryTargetLang:'none' as const,ttsEnabled:false};
  const context=createTranslationContext(); let delivered=false;
  mockIPC(async(command,args: any)=> {
    if(command==='get_app_settings') {await Promise.resolve();return settings;}
    if(command==='get_desktop_values') return {};
    if(command==='desktop_request') {
      const response=await handleDesktopRequest(args.message);
      if(args.message.type==='TRANSLATE') {
        settings={...settings,translationActive:false};
        const off=loadSettings(context,settings);
        settings={...settings,translationActive:true};
        await Promise.all([off,loadSettings(context,settings)]); delivered=true;
      }
      return response;
    }
  },{shouldMockEvents:true});
  vi.stubGlobal('fetch',async()=>new Response(JSON.stringify([[['xin chào','你好']],null,'zh'])));
  vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0));
  await loadSettings(context);
  vi.spyOn(window,'getSelection').mockReturnValue({rangeCount:1,isCollapsed:false,toString:()=> '你好',getRangeAt:()=>({getBoundingClientRect:()=>({left:40,bottom:80})})} as unknown as Selection);
  const page=document.createElement('div');document.body.append(page);initTranslationListeners(context,page);
  page.dispatchEvent(new KeyboardEvent('keydown',{key:'q',code:'KeyQ',altKey:true,bubbles:true}));
  await vi.waitFor(()=>expect(delivered).toBe(true));
  expect(document.getElementById('translation-extension-root')?.shadowRoot?.querySelector('.tt-translation-text')).toBeNull();
});
