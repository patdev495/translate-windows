import type { Settings } from './settings';

/** Compare only translation inputs; display changes preserve in-flight work. */
export function sameTranslationSettings(left: Settings, right: Settings): boolean {
  return (['translationActive', 'provider', 'deeplApiKey', 'primaryTargetLang', 'secondaryTargetLang', 'reverseTargetLang'] as const)
    .every(key => left[key] === right[key]);
}
