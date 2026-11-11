import { TranslationEngine } from './translation';
import { PhoneticEngine } from './learning-phonetics';
import { getDetectionTarget, getTranslationTargets } from './translation-plan';
import type { Settings } from './settings';

export interface TranslationCoordinatorResult {
  detectedLang: string;
  sourcePhonetics: string;
  translations: {
    lang: string;
    text: string;
    phonetics: string;
  }[];
}

export function detectLanguageOffline(text: string): 'en' | 'vi' | 'zh' | null {
  const clean = text.trim();
  if (!clean) return null;

  // 1. Check Vietnamese specific accented characters (highest priority)
  const viPattern = /[áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ]/;
  if (viPattern.test(clean)) {
    return 'vi';
  }

  // 2. Check Chinese characters (CJK Unified Ideographs)
  if (/[\u4e00-\u9fff]/.test(clean)) {
    return 'zh';
  }

  // 3. Check English (strictly standard characters, numbers, common punctuation, spaces)
  if (/^[a-zA-Z0-9\s.,;:?!'’"\-()\[\]{}]+$/.test(clean)) {
    return 'en';
  }

  return null;
}

function splitBySourceLineShape(sourceText: string, translatedText: string): string {
  const sourceLines = sourceText.split(/\r?\n/);
  if (sourceLines.length < 2 || translatedText.includes('\n')) {
    return translatedText;
  }

  const nonEmptySourceLines = sourceLines.map(line => line.trim()).filter(Boolean);
  if (nonEmptySourceLines.length < 2) {
    return translatedText;
  }

  const totalSourceLength = nonEmptySourceLines.reduce((sum, line) => sum + line.length, 0);
  if (totalSourceLength === 0) {
    return translatedText;
  }

  const words = translatedText.trim().split(/\s+/).filter(Boolean);
  if (words.length >= nonEmptySourceLines.length) {
    const totalWordLength = words.reduce((sum, word) => sum + word.length, 0);
    const output: string[] = [];
    let wordIndex = 0;

    for (let i = 0; i < nonEmptySourceLines.length; i++) {
      const remainingLines = nonEmptySourceLines.length - i;
      const remainingWords = words.length - wordIndex;
      const isLastLine = i === nonEmptySourceLines.length - 1;
      const targetLength = (nonEmptySourceLines[i].length / totalSourceLength) * totalWordLength;
      let lineLength = 0;
      const lineWords: string[] = [];

      while (
        wordIndex < words.length &&
        (isLastLine ||
          lineWords.length === 0 ||
          (lineLength < targetLength && remainingWords - lineWords.length > remainingLines - 1))
      ) {
        const word = words[wordIndex++];
        lineWords.push(word);
        lineLength += word.length;
      }

      output.push(lineWords.join(' '));
    }

    return output.join('\n');
  }

  const chars = Array.from(translatedText.trim());
  if (chars.length < nonEmptySourceLines.length) {
    return translatedText;
  }

  const output: string[] = [];
  let charIndex = 0;
  for (let i = 0; i < nonEmptySourceLines.length; i++) {
    const isLastLine = i === nonEmptySourceLines.length - 1;
    if (isLastLine) {
      output.push(chars.slice(charIndex).join(''));
    } else {
      const nextIndex = Math.max(
        charIndex + 1,
        Math.round((nonEmptySourceLines.slice(0, i + 1).reduce((sum, line) => sum + line.length, 0) / totalSourceLength) * chars.length)
      );
      output.push(chars.slice(charIndex, nextIndex).join(''));
      charIndex = nextIndex;
    }
  }

  return output.join('\n');
}

export class TranslationCoordinator {
  /**
   * Translates to the user's configured Primary Target Language without
   * applying the tooltip's source-language fallback rules.
   */
  static async translateDirectToPrimary(text: string, settings: Settings) {
    if (settings.primaryTargetLang === 'none') {
      throw new Error('Primary Target Language is disabled.');
    }
    return TranslationEngine.translateWithSettings(text, settings.primaryTargetLang, settings);
  }

  static async translate(text: string, settings: Settings): Promise<TranslationCoordinatorResult> {
    let detectedLang: string;
    let firstRes = null;
    let targetLangs;

    const offlineLang = detectLanguageOffline(text);
    if (offlineLang) {
      detectedLang = offlineLang;
      targetLangs = getTranslationTargets(settings, detectedLang);
    } else {
      // Fallback: Use the first enabled target to detect the source language.
      const detectionTarget = getDetectionTarget(settings);
      firstRes = detectionTarget
        ? await TranslationEngine.translateWithSettings(text, detectionTarget, settings)
        : null;
      detectedLang = firstRes?.detectedLang ?? 'auto';
      targetLangs = getTranslationTargets(settings, detectedLang);
    }

    const translations = await Promise.all(
      targetLangs.map(async ({ lang }) => {
        const result = firstRes && lang === getDetectionTarget(settings)
          ? firstRes
          : await TranslationEngine.translateWithSettings(text, lang, settings);

        let phonetics = '';
        if (lang === 'en') {
          phonetics = await PhoneticEngine.getEnglishIPA(result.translation);
        } else if (lang === 'zh') {
          phonetics = PhoneticEngine.getPinyin(result.translation);
        }

        return {
          lang,
          text: splitBySourceLineShape(text, result.translation),
          phonetics
        };
      })
    );

    // Generate Phonetics (IPA/Pinyin) for source text
    let sourcePhonetics = '';
    const isSourceChinese = ['zh', 'zh-CN', 'zh-TW', 'zh-cn', 'zh-tw'].includes(detectedLang);
    const isSourceEnglish = detectedLang === 'en';

    if (isSourceEnglish) {
      sourcePhonetics = await PhoneticEngine.getEnglishIPA(text);
    } else if (isSourceChinese) {
      sourcePhonetics = PhoneticEngine.getPinyin(text);
    }

    return {
      detectedLang,
      sourcePhonetics,
      translations
    };
  }
}
