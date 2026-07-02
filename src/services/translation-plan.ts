import type { Settings } from './settings';

export type TargetLanguage = 'none' | 'vi' | 'en' | 'zh';

export interface TranslationTarget {
  lang: Exclude<TargetLanguage, 'none'>;
}

function isEnabledLanguage(lang: string): lang is Exclude<TargetLanguage, 'none'> {
  return lang !== 'none';
}

function normalizeLang(lang: string): string {
  return lang.toLowerCase().split('-')[0];
}

export function getDetectionTarget(settings: Settings): Exclude<TargetLanguage, 'none'> | null {
  return [
    settings.primaryTargetLang,
    settings.secondaryTargetLang,
    settings.reverseTargetLang,
  ].find(isEnabledLanguage) ?? null;
}

export function getTranslationTargets(settings: Settings, detectedLang: string): TranslationTarget[] {
  const detected = normalizeLang(detectedLang);
  let targetLang1 = settings.primaryTargetLang;
  let targetLang2 = settings.secondaryTargetLang;

  if (isEnabledLanguage(settings.primaryTargetLang) && detected === normalizeLang(settings.primaryTargetLang)) {
    targetLang1 = settings.reverseTargetLang;
    targetLang2 = settings.secondaryTargetLang;
  } else if (isEnabledLanguage(settings.secondaryTargetLang) && detected === normalizeLang(settings.secondaryTargetLang)) {
    targetLang1 = settings.primaryTargetLang;
    targetLang2 = settings.reverseTargetLang;
  }

  const seen = new Set<string>();
  return [targetLang1, targetLang2]
    .filter(isEnabledLanguage)
    .filter((lang) => {
      const normalized = normalizeLang(lang);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .map((lang) => ({ lang }));
}
