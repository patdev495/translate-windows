// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { TranslationTooltip } from '../src/content/tooltip';
import { mockIPC, mockWindows, clearMocks } from '@tauri-apps/api/mocks';

afterEach(() => { clearMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

test('selecting Chinese translation text exposes independently selectable stroke-order characters', () => {
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  const tooltip = new TranslationTooltip();
  tooltip.show(0, 0, 'hello', { detectedLang: 'en', sourcePhonetics: '', translations: [{ lang: 'zh', text: '我你', phonetics: '' }] }, false);
  const root = document.getElementById('translation-extension-root')!.shadowRoot!;
  const text = root.querySelector('.tt-translation-text')!;
  const range = document.createRange();
  range.selectNodeContents(text);
  // JSDOM cannot expose a browser selection inside a shadow root.
  vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, rangeCount: 1,
    anchorNode: text.firstChild, focusNode: text.firstChild,
    getRangeAt: () => range, toString: () => range.toString(),
  } as unknown as Selection);
  text.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }));
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('.tt-hanzi-button')];
  expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual(['Loop stroke order for 我', 'Loop stroke order for 你']);
  buttons[0].click();
  buttons[1].click();
  buttons[0].click();
  expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
  tooltip.hide();
});

test('enabling Hanzi breakdown opens its own desktop window when a character starts looping', async () => {
  mockWindows('tooltip');
  const opened: unknown[] = [];
  mockIPC((command,args) => { if (command === 'open_hanzi_breakdown') opened.push(args); return {}; }, { shouldMockEvents: true });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0),0));
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  const tooltip = new TranslationTooltip();
  tooltip.updateHanziBreakdownSettings(true,'vi');
  tooltip.show(0,0,'hello',{ detectedLang:'en',translations:[{ lang:'zh',text:'我',phonetics:'' }] },false);
  const root = document.getElementById('translation-extension-root')!.shadowRoot!;
  const text = root.querySelector('.tt-translation-text')!;
  const range = document.createRange(); range.selectNodeContents(text);
  vi.spyOn(window,'getSelection').mockReturnValue({ isCollapsed:false,rangeCount:1,anchorNode:text.firstChild,focusNode:text.firstChild,getRangeAt:()=>range,toString:()=>range.toString() } as unknown as Selection);
  text.dispatchEvent(new MouseEvent('mouseup',{ bubbles:true,composed:true }));
  root.querySelector<HTMLButtonElement>('.tt-hanzi-button')!.click();
  await vi.waitFor(() => expect(opened).toMatchObject([{ character:'我', path:['我'] }]));
  tooltip.hide();
});

test('the native tooltip Copy button writes exactly its source text through the desktop clipboard',async()=> {
  mockWindows('tooltip');
  let clipboard='old';
  mockIPC((command,args)=> { if(command==='copy_text_to_clipboard') clipboard=(args as {text:string}).text; return {}; },{shouldMockEvents:true});
  vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0));
  const tooltip=new TranslationTooltip();
  tooltip.show(0,0,'你好',{detectedLang:'zh',translations:[{lang:'vi',text:'xin chào',phonetics:''}]},false);
  document.getElementById('translation-extension-root')!.shadowRoot!.querySelector<HTMLButtonElement>('.copy-button')!.click();
  await vi.waitFor(()=>expect(clipboard).toBe('你好'));
  tooltip.hide();
});
