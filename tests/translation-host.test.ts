// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { IDBFactory } from 'fake-indexeddb';
import { emit } from '@tauri-apps/api/event';

let stopHost: (() => void) | undefined;
afterEach(() => { stopHost?.(); stopHost=undefined; clearMocks(); vi.unstubAllGlobals(); });

async function fixture(dictionary: () => Promise<Response>, provider?: () => Promise<void>, detectedLang = 'en', settingsRead?: (count: number) => Promise<void>) {
  vi.resetModules(); localStorage.clear(); vi.stubGlobal('indexedDB',new IDBFactory());
  const { SettingsManager }=await import('../src/services/settings');
  let settings={...SettingsManager.DEFAULT_SETTINGS,secondaryTargetLang:'none' as const,ttsEnabled:false};
  const completions: any[]=[]; let reads=0;
  mockWindows('main');
  let dispatch!: (message: any) => Promise<any>;
  mockIPC(async(command,args: any)=> {
    if(command==='get_app_settings') {await settingsRead?.(++reads); return settings;}
    if(command==='update_app_settings') {
      settings={...settings,...args.patch};
      await emit('settings-changed',settings); return settings;
    }
    if(command==='desktop_request') return dispatch(args.message);
    if(command==='get_desktop_values') return {};
    if(command==='complete_input_replacement') completions.push(args);
  },{shouldMockEvents:true});
  const requests: string[]=[];
  vi.stubGlobal('fetch',async(url: RequestInfo | URL)=> {
    if(String(url).includes('cmu-dict.json')) return dictionary();
    requests.push(String(url)); await provider?.();
    const target=new URL(String(url)).searchParams.get('tl');
    return new Response(JSON.stringify([[[target==='zh'?'你好':target==='en'?'Hello':'xin chào','Hello']],null,detectedLang]));
  });
  const host=await import('../src/services/desktop-host'); dispatch=host.handleDesktopRequest;
  const {desktopRuntime}=await import('../src/platform/runtime');
  return {
    request: desktopRuntime.runtime.sendMessage,
    settings: SettingsManager,
    requests,completions,
    async start() {stopHost=await host.startDesktopHost();},
    stop() {stopHost?.();stopHost=undefined;},
  };
}

test('concurrent translation clients share the in-flight dictionary and receive complete IPA',async()=> {
  let loads=0; let release!:()=>void;
  const ready=new Promise<void>(resolve=>{release=resolve;});
  const host=await fixture(async()=> {loads++; await ready; return new Response(JSON.stringify({hello:'həˈloʊ'}));});
  const responses=Array.from({length:3},()=>host.request({type:'TRANSLATE',text:'Hello'}));
  await vi.waitFor(()=>expect(loads).toBeGreaterThan(0)); release();
  for(const response of await Promise.all(responses)) {
    expect(response.data.sourcePhonetics).toBe('Hello həˈloʊ');
    expect(response.data.translations).toEqual([{lang:'vi',text:'xin chào',phonetics:''}]);
  }
  expect(loads).toBe(1);
  expect(host.requests).toHaveLength(3); // Dictionary sharing must not become a translation cache.
});

test('a failed dictionary response keeps text readable and a later request retries loading IPA',async()=> {
  let loads=0;
  const host=await fixture(async()=> ++loads===1 ? new Response('{}',{status:503}) : new Response(JSON.stringify({hello:'həˈloʊ'})));
  const first=await host.request({type:'TRANSLATE',text:'Hello'});
  expect(first.data.sourcePhonetics).toBe('Hello');
  const second=await host.request({type:'TRANSLATE',text:'Hello'});
  expect(second.data.sourcePhonetics).toBe('Hello həˈloʊ');
  expect(loads).toBe(2);
});

test('changing targets discards an in-flight result and the next request uses the new target',async()=> {
  let release!:()=>void; const ready=new Promise<void>(resolve=>{release=resolve;});
  const host=await fixture(async()=>new Response(JSON.stringify({hello:'həˈloʊ'})),()=>ready);
  const pending=host.request({type:'TRANSLATE',text:'Hello'});
  await vi.waitFor(()=>expect(host.requests).toHaveLength(1));
  await host.settings.updateSettings({primaryTargetLang:'zh'}); release();
  expect((await pending).success).toBe(false);
  const next=await host.request({type:'TRANSLATE',text:'Hello'});
  expect(next.data.translations).toEqual([{lang:'zh',text:'你好',phonetics:'你好 nǐ hǎo'}]);
});

test('turning master off and back on never revives work started before it was disabled',async()=> {
  let release!:()=>void; const ready=new Promise<void>(resolve=>{release=resolve;});
  const host=await fixture(async()=>new Response(JSON.stringify({hello:'həˈloʊ'})),()=>ready);
  await host.start();
  const pending=host.request({type:'TRANSLATE',text:'Hello'});
  await vi.waitFor(()=>expect(host.requests).toHaveLength(1));
  await host.settings.updateSettings({translationActive:false});
  await host.settings.updateSettings({translationActive:true}); release();
  expect((await pending).success).toBe(false);
  expect((await host.request({type:'TRANSLATE',text:'Hello'})).success).toBe(true);
});

test('restarting the host invalidates old work and accepts the next translation',async()=> {
  let release!:()=>void; const ready=new Promise<void>(resolve=>{release=resolve;});
  const host=await fixture(async()=>new Response(JSON.stringify({hello:'həˈloʊ'})),()=>ready);
  await host.start();
  const pending=host.request({type:'TRANSLATE',text:'Hello'});
  await vi.waitFor(()=>expect(host.requests).toHaveLength(1));
  host.stop(); await host.start(); release();
  expect((await pending).success).toBe(false);
  expect((await host.request({type:'TRANSLATE',text:'Hello'})).success).toBe(true);
});

test('Input Replacement cannot complete with a translation from superseded target settings',async()=> {
  let release!:()=>void; const ready=new Promise<void>(resolve=>{release=resolve;});
  const host=await fixture(async()=>new Response(JSON.stringify({hello:'həˈloʊ'})),()=>ready);
  await host.start();
  await emit('input-translation-request',{id:'synthetic-selection',text:'Hello'});
  await vi.waitFor(()=>expect(host.requests).toHaveLength(1));
  await host.settings.updateSettings({primaryTargetLang:'zh'}); release();
  await vi.waitFor(()=>expect(host.completions).toHaveLength(1));
  expect(host.completions[0]).toMatchObject({id:'synthetic-selection',data:null,error:expect.stringContaining('settings changed')});
});

test('OCR blocks keep detection and first-target fallback in the shared host without adding IPA work',async()=> {
  let dictionaryLoads=0;
  const host=await fixture(async()=> {dictionaryLoads++;return new Response('{}');},undefined,'vi');
  const response=await host.request({type:'TRANSLATE_OCR_BLOCK',text:'Xin chao'});
  expect(response).toMatchObject({success:true,data:{translation:'Hello',detectedLang:'vi'}});
  expect(host.requests.map(url=>new URL(url).searchParams.get('tl'))).toEqual(['vi','en']);
  expect(dictionaryLoads).toBe(0);
});

test('a host restart during final settings validation cannot deliver the old result',async()=> {
  let entered!:()=>void, release!:()=>void;
  const arrived=new Promise<void>(resolve=>{entered=resolve;});
  const ready=new Promise<void>(resolve=>{release=resolve;});
  const host=await fixture(async()=>new Response(JSON.stringify({hello:'həˈloʊ'})),undefined,'en',async count=> {
    if(count===3) {entered();await ready;}
  });
  await host.start();
  const pending=host.request({type:'TRANSLATE',text:'Hello'});
  await arrived; host.stop(); await host.start(); release();
  expect(await pending).toMatchObject({success:false,error:expect.stringContaining('restarted')});
});

test('display changes preserve dictionary and parallel provider targets across requests',async()=> {
  let loads=0; let release!:()=>void;
  const ready=new Promise<void>(resolve=>{release=resolve;});
  const host=await fixture(async()=> {loads++;return new Response(JSON.stringify({hello:'həˈloʊ'}));},()=>ready);
  await host.start();
  await host.settings.updateSettings({secondaryTargetLang:'zh'});
  const first=host.request({type:'TRANSLATE',text:'Hello'});
  await vi.waitFor(()=>expect(host.requests).toHaveLength(2));
  await host.settings.updateSettings({tooltipFontSize:'24',phoneticsVisible:false}); release();
  expect((await first).success).toBe(true);
  expect((await host.request({type:'TRANSLATE',text:'Hello'})).success).toBe(true);
  expect(loads).toBe(1);
  expect(host.requests).toHaveLength(4);
});
