// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { TooltipController } from '../src/tooltip-controller';
import type { WindowAPI } from '../src/overlay-controller';

vi.mock('../src/services/translation', () => ({
  TranslationEngine: {
    translate: vi.fn().mockResolvedValue({ translation: 'Xin chao', detectedLang: 'en' }),
    translateWithSettings: vi.fn().mockImplementation(async (_text: string, targetLang: string) => ({
      translation: targetLang === 'vi' ? 'Xin chao' : 'Ni hao',
      detectedLang: 'en',
    })),
    translateGoogle: vi.fn().mockResolvedValue({ translation: 'Xin chao', detectedLang: 'en' }),
  },
}));

vi.mock('../src/services/phonetics', () => ({
  PhoneticEngine: {
    getPinyin: vi.fn().mockReturnValue('ni hao'),
    getEnglishIPA: vi.fn().mockReturnValue('/helo/'),
  },
}));

vi.mock('../src/services/settings', () => ({
  SettingsManager: {
    getSettings: vi.fn().mockResolvedValue({
      primaryTargetLang: 'vi',
      secondaryTargetLang: 'zh',
      reverseTargetLang: 'en',
      provider: 'google',
      deeplApiKey: '',
      ttsEnabled: true,
      ocrLanguage: 'ch',
    }),
  },
}));

function makeWindowAPI(): WindowAPI & { closeCalled: boolean } {
  return {
    closeCalled: false,
    close: vi.fn(function (this: any) { this.closeCalled = true; }),
  };
}

function makeDOM(): {
  sourceEl: HTMLElement;
  phoneticEl: HTMLElement;
  translationEl: HTMLElement;
  ttsBtn: HTMLButtonElement;
  card: HTMLElement;
} {
  const sourceEl = document.createElement('div');
  sourceEl.id = 'source-text';
  const phoneticEl = document.createElement('div');
  phoneticEl.id = 'phonetic';
  const translationEl = document.createElement('div');
  translationEl.id = 'translation';
  const ttsBtn = document.createElement('button');
  ttsBtn.id = 'tts-btn';
  const card = document.createElement('div');
  card.id = 'tooltip-card';
  document.body.append(sourceEl, phoneticEl, translationEl, ttsBtn, card);
  return { sourceEl, phoneticEl, translationEl, ttsBtn, card };
}

describe('TooltipController', () => {
  let windowApi: WindowAPI;
  let dom: ReturnType<typeof makeDOM>;

  beforeEach(() => {
    document.body.innerHTML = '';
    dom = makeDOM();
    windowApi = makeWindowAPI();
    vi.clearAllMocks();
  });

  test('initialize displays source text in the sourceEl', async () => {
    const controller = new TooltipController(windowApi);
    await controller.initialize('hello', dom.sourceEl, dom.phoneticEl, dom.translationEl, dom.ttsBtn);
    expect(dom.sourceEl.textContent).toBe('hello');
  });

  test('initialize shows source IPA based on detected English language', async () => {
    const { PhoneticEngine } = await import('../src/services/phonetics');
    const controller = new TooltipController(windowApi);
    await controller.initialize('hello', dom.sourceEl, dom.phoneticEl, dom.translationEl, dom.ttsBtn);
    expect(PhoneticEngine.getEnglishIPA).toHaveBeenCalledWith('hello');
    expect(dom.phoneticEl.textContent).toContain('/helo/');
  });

  test('initialize renders enabled translation targets from settings', async () => {
    const { TranslationEngine } = await import('../src/services/translation');
    const controller = new TooltipController(windowApi);
    await controller.initialize('hello', dom.sourceEl, dom.phoneticEl, dom.translationEl, dom.ttsBtn);

    expect(TranslationEngine.translateWithSettings).toHaveBeenCalledWith(
      'hello',
      'vi',
      expect.objectContaining({ primaryTargetLang: 'vi', secondaryTargetLang: 'zh' })
    );
    expect(dom.translationEl.querySelectorAll('.translation-block')).toHaveLength(2);
    expect(dom.translationEl.textContent).toContain('VIE');
    expect(dom.translationEl.textContent).toContain('CHI');
    expect(dom.translationEl.textContent).toContain('Xin chao');
    expect(dom.translationEl.textContent).toContain('Ni hao');
    expect(dom.translationEl.querySelector('.translation-phonetic')?.textContent).toContain('ni hao');
  });

  test('initialize does not translate when OCR returns no text', async () => {
    const { TranslationEngine } = await import('../src/services/translation');
    const controller = new TooltipController(windowApi);
    await controller.initialize('', dom.sourceEl, dom.phoneticEl, dom.translationEl, dom.ttsBtn);

    expect(dom.sourceEl.textContent).toBe('(No text found)');
    expect(dom.translationEl.textContent).toBe('');
    expect(TranslationEngine.translateWithSettings).not.toHaveBeenCalled();
  });

  test('focus loss does not close the draggable tooltip', () => {
    const controller = new TooltipController(windowApi);
    controller.attachEscapeClose();
    window.dispatchEvent(new Event('blur'));
    expect(windowApi.close).not.toHaveBeenCalled();
  });

  test('Escape closes the draggable tooltip', () => {
    const controller = new TooltipController(windowApi);
    controller.attachEscapeClose();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(windowApi.close).toHaveBeenCalledTimes(1);
  });

  test('tts button click calls speechSynthesis.speak when ttsEnabled', async () => {
    const mockSpeak = vi.fn();
    const MockUtterance = vi.fn().mockImplementation((text: string) => ({ text }));

    Object.defineProperty(window, 'speechSynthesis', {
      value: { speak: mockSpeak },
      writable: true,
      configurable: true,
    });
    (global as any).SpeechSynthesisUtterance = MockUtterance;

    const controller = new TooltipController(windowApi);
    await controller.initialize('hello', dom.sourceEl, dom.phoneticEl, dom.translationEl, dom.ttsBtn);
    dom.ttsBtn.click();
    expect(mockSpeak).toHaveBeenCalledTimes(1);

    delete (global as any).SpeechSynthesisUtterance;
  });

  test('tts button does nothing when speechSynthesis is unavailable', async () => {
    Object.defineProperty(window, 'speechSynthesis', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const controller = new TooltipController(windowApi);
    await controller.initialize('hello', dom.sourceEl, dom.phoneticEl, dom.translationEl, dom.ttsBtn);
    expect(() => dom.ttsBtn.click()).not.toThrow();
  });
});
