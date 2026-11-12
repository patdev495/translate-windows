import { latencySpan } from './latency';
import { desktopFetch } from '../platform/http';

export interface TranslationResult {
  translation: string;
  detectedLang: string;
}

export interface TranslationSettings {
  provider: 'google' | 'deepl' | 'deepl-free';
  deeplApiKey: string;
  latencyTraceId?: string;
}

export class TranslationEngine {
  // Original translation method preserved for tests & compatibility
  static async translate(
    text: string,
    primaryTarget: string,
    secondaryTarget: string
  ): Promise<TranslationResult> {
    const runTranslation = async (target: string) => {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch translation: ${response.statusText}`);
      }
      const data = await response.json();
      
      let translation = '';
      if (data && data[0]) {
        translation = data[0]
          .map((x: any) => x[0])
          .filter((x: any) => typeof x === 'string')
          .join('');
      }
      
      const detectedLang = data && data[2] ? data[2] : 'auto';
      return { translation, detectedLang };
    };

    const result = await runTranslation(primaryTarget);
    if (result.detectedLang === primaryTarget) {
      return await runTranslation(secondaryTarget);
    }
    return result;
  }

  // Unified translation method using settings provider
  static async translateWithSettings(text: string, targetLang: string, settings: TranslationSettings): Promise<TranslationResult> {
    return latencySpan('provider', () => this.translateProvider(text, targetLang, settings), settings.latencyTraceId);
  }

  private static async translateProvider(
    text: string,
    targetLang: string,
    settings: TranslationSettings
  ): Promise<TranslationResult> {
    if (settings.provider === 'deepl') {
      return this.translateDeepL(text, targetLang, settings.deeplApiKey);
    }
    if (settings.provider === 'deepl-free') {
      const language = targetLang.toLowerCase().split('-')[0];
      const response = await desktopFetch('https://oneshot-free.www.deepl.com/v1/translate', {
        method:'POST',headers:{Authorization:'None','Content-Type':'application/json'},
        body:JSON.stringify({text:[text],target_lang:language === 'zh' ? 'zh-Hans' : language === 'en' ? 'en-US' : language}),
      });
      if (!response.ok) throw new Error(`DeepL Web translation failed: ${response.status}`);
      const item = (await response.json())?.translations?.[0];
      if (typeof item?.text !== 'string' || !item.text.trim()) throw new Error('DeepL Web returned no translation');
      return {translation:item.text,detectedLang:typeof item.detected_source_language === 'string' ? item.detected_source_language.toLowerCase() : 'auto'};
    }
    return this.translateGoogle(text, targetLang);
  }

  static async translateGoogle(text: string, targetLang: string): Promise<TranslationResult> {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Google Translate failed: ${response.statusText}`);
    }
    const data = await response.json();
    
    let translation = '';
    if (data && data[0]) {
      translation = data[0]
        .map((x: any) => x[0])
        .filter((x: any) => typeof x === 'string')
        .join('');
    }
    
    const detectedLang = data && data[2] ? data[2] : 'auto';
    return { translation, detectedLang };
  }

  static async translateDeepL(text: string, targetLang: string, apiKey: string): Promise<TranslationResult> {
    if (!apiKey) {
      throw new Error('DeepL API Key is missing. Please configure it in settings.');
    }

    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const item = await invoke<{ text: string; detected_source_language: string }>('translate_deepl', {
          text,
          targetLang,
          apiKey,
        });
        return {
          translation: item.text,
          detectedLang: item.detected_source_language.toLowerCase(),
        };
      } catch (error: any) {
        throw new Error(error.message || String(error));
      }
    }

    const isFreeKey = apiKey.endsWith(':fx');
    const baseUrl = isFreeKey
      ? 'https://api-free.deepl.com/v2/translate'
      : 'https://api.deepl.com/v2/translate';

    const mapLang = (lang: string) => {
      const l = lang.toLowerCase().split('-')[0];
      if (l === 'en') return 'EN-US';
      if (l === 'zh') return 'ZH';
      return l.toUpperCase();
    };

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: [text],
        target_lang: mapLang(targetLang),
      }),
    });

    if (response.status === 403) {
      throw new Error('DeepL API Key is invalid or expired.');
    }

    if (!response.ok) {
      throw new Error(`DeepL translation failed. Status: ${response.status}`);
    }

    const data = await response.json();
    if (data && data.translations && data.translations[0]) {
      const item = data.translations[0];
      return {
        translation: item.text,
        detectedLang: item.detected_source_language.toLowerCase(),
      };
    }

    throw new Error('DeepL translation returned empty result.');
  }
}
