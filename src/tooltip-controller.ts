import type { WindowAPI } from './overlay-controller';
import { TranslationEngine } from './services/translation';
import { PhoneticEngine } from './services/phonetics';
import { SettingsManager } from './services/settings';
import { getDetectionTarget, getTranslationTargets } from './services/translation-plan';

interface TooltipTranslation {
  lang: string;
  text: string;
  phonetics: string;
}

interface TooltipTranslationPlan {
  detectedLang: string;
  translations: TooltipTranslation[];
}

/**
 * TooltipController manages the translation tooltip sub-window.
 *
 * It renders source text, phonetics (pinyin/IPA), translated text,
 * and wires up copy/TTS controls.
 */
export class TooltipController {
  private windowApi: WindowAPI;

  constructor(windowApi: WindowAPI) {
    this.windowApi = windowApi;
  }

  /**
   * Populate the tooltip DOM elements with text, phonetics, and translation.
   */
  async initialize(
    sourceText: string,
    sourceEl: HTMLElement,
    phoneticEl: HTMLElement,
    translationEl: HTMLElement,
    ttsBtn: HTMLButtonElement
  ): Promise<void> {
    const settings = await SettingsManager.getSettings();
    const copySourceBtn = document.getElementById('copy-source-btn') as HTMLButtonElement | null;
    const copyTranslationBtn = document.getElementById('copy-translation-btn') as HTMLButtonElement | null;
    const translationLangEl = document.getElementById('translation-lang') as HTMLElement | null;

    const normalizedSource = sourceText.trim();
    if (!normalizedSource) {
      sourceEl.textContent = '(No text found)';
      phoneticEl.textContent = '';
      translationEl.textContent = '';
      return;
    }

    sourceEl.textContent = normalizedSource;

    let translatedText = '';
    let sourceLang = 'auto';
    try {
      const { detectedLang, translations } = await this.translateForTargets(normalizedSource, settings);
      sourceLang = detectedLang;
      phoneticEl.textContent = this.getPhonetics(normalizedSource, detectedLang);
      translatedText = translations.map((item) => item.text).join('\n');
      this.renderTranslations(translationEl, translations, Boolean(settings.ttsEnabled));
      translationLangEl?.remove();
    } catch (err) {
      translationEl.textContent = '(translation failed)';
      if (translationLangEl) {
        translationLangEl.textContent = '';
      }
      console.error('Tooltip translation error:', err);
    }

    copySourceBtn?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(normalizedSource);
    });
    copyTranslationBtn?.addEventListener('click', () => {
      if (translatedText) {
        void navigator.clipboard?.writeText(translatedText);
      }
    });

    if (settings.ttsEnabled) {
      ttsBtn.addEventListener('click', () => {
        this.speakText(normalizedSource, sourceLang);
      });
    }
  }

  private async translateForTargets(
    sourceText: string,
    settings: Awaited<ReturnType<typeof SettingsManager.getSettings>>
  ): Promise<TooltipTranslationPlan> {
    const detectionTarget = getDetectionTarget(settings);
    const detectionResult = detectionTarget
      ? await TranslationEngine.translateWithSettings(sourceText, detectionTarget, settings)
      : { translation: sourceText, detectedLang: 'auto' };
    const detectedLang = detectionResult.detectedLang || 'auto';
    const targets = getTranslationTargets(settings, detectedLang);

    const translations: TooltipTranslation[] = [];
    for (const target of targets) {
      if (target.lang === detectionTarget) {
        translations.push({
          lang: target.lang,
          text: detectionResult.translation,
          phonetics: this.getPhonetics(detectionResult.translation, target.lang),
        });
        continue;
      }

      const result = await TranslationEngine.translateWithSettings(sourceText, target.lang, settings);
      translations.push({
        lang: target.lang,
        text: result.translation,
        phonetics: this.getPhonetics(result.translation, target.lang),
      });
    }

    return { detectedLang, translations };
  }

  private renderTranslations(container: HTMLElement, translations: TooltipTranslation[], ttsEnabled: boolean): void {
    container.textContent = '';
    if (translations.length === 0) {
      container.textContent = '(no translation target enabled)';
      return;
    }

    for (const item of translations) {
      const block = document.createElement('article');
      block.className = 'translation-block';

      const header = document.createElement('div');
      header.className = 'translation-block-header';

      const lang = document.createElement('span');
      lang.className = 'lang-pill';
      lang.textContent = this.langLabel(item.lang);

      const copy = document.createElement('button');
      copy.className = 'icon-btn compact translation-copy-btn';
      copy.type = 'button';
      copy.title = 'Copy translation';
      copy.setAttribute('aria-label', `Copy ${this.langLabel(item.lang)} translation`);
      copy.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 8.75A2.75 2.75 0 0 1 10.75 6h6.5A2.75 2.75 0 0 1 20 8.75v8.5A2.75 2.75 0 0 1 17.25 20h-6.5A2.75 2.75 0 0 1 8 17.25v-8.5Z"/>
          <path d="M5 15.25h-.25A2.75 2.75 0 0 1 2 12.5V5.75A2.75 2.75 0 0 1 4.75 3h7.5A2.75 2.75 0 0 1 15 5.75V6"/>
        </svg>
      `;
      copy.addEventListener('click', () => {
        void navigator.clipboard?.writeText(item.text);
      });

      const speak = document.createElement('button');
      speak.className = 'icon-btn compact translation-tts-btn';
      speak.type = 'button';
      speak.title = 'Read translation';
      speak.setAttribute('aria-label', `Read ${this.langLabel(item.lang)} translation`);
      speak.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 5 6 9H3v6h3l5 4V5Z"/>
          <path d="M15.5 8.5a5 5 0 0 1 0 7"/>
          <path d="M18.5 5.5a9 9 0 0 1 0 13"/>
        </svg>
      `;
      speak.hidden = !ttsEnabled;
      speak.addEventListener('click', () => {
        this.speakText(item.text, item.lang);
      });

      const text = document.createElement('div');
      text.className = 'translation-text';
      text.textContent = item.text;

      const actions = document.createElement('div');
      actions.className = 'translation-actions';
      actions.append(speak, copy);

      header.append(lang, actions);
      block.append(header, text);
      if (item.phonetics) {
        const phonetics = document.createElement('div');
        phonetics.className = 'translation-phonetic';
        phonetics.textContent = item.phonetics;
        block.append(phonetics);
      }
      container.append(block);
    }
  }

  private getPhonetics(text: string, lang: string): string {
    const norm = lang.toLowerCase();
    if (norm === 'en') {
      return PhoneticEngine.getEnglishIPA(text);
    }
    if (norm === 'zh' || norm === 'zh-cn' || norm === 'zh-tw') {
      return PhoneticEngine.getPinyin(text);
    }
    return '';
  }

  private speakText(text: string, lang: string): void {
    if (
      typeof window.speechSynthesis === 'undefined' ||
      !window.speechSynthesis ||
      typeof SpeechSynthesisUtterance === 'undefined'
    ) {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.speechLang(lang);
    window.speechSynthesis.speak(utterance);
  }

  private speechLang(lang: string): string {
    const norm = lang.toLowerCase().split('-')[0];
    if (norm === 'vi') return 'vi-VN';
    if (norm === 'zh') return 'zh-CN';
    if (norm === 'en') return 'en-US';
    return lang;
  }

  private langLabel(lang: string): string {
    const norm = lang.toLowerCase().split('-')[0];
    if (norm === 'vi') return 'VIE';
    if (norm === 'en') return 'ENG';
    if (norm === 'zh') return 'CHI';
    return norm.toUpperCase();
  }

  attachEscapeClose(): void {
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.windowApi.close();
      }
    });
  }
}
