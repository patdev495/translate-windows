// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { createTranslationContext, initTranslationListeners, loadSettings } from '../src/content/translation-init';
import { SettingsManager } from '../src/services/settings';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

test('a standalone Ctrl translates PDF selected text on release while Ctrl+C remains a copy chord', async () => {
  localStorage.clear();
  await SettingsManager.updateSettings({ translationShortcut: 'Ctrl', secondaryTargetLang: 'none', ttsEnabled: false });
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
