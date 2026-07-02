import { describe, expect, test } from 'vitest';
import { getDetectionTarget, getTranslationTargets } from '../src/services/translation-plan';
import type { Settings } from '../src/services/settings';

const baseSettings: Settings = {
  primaryTargetLang: 'vi',
  secondaryTargetLang: 'zh',
  reverseTargetLang: 'en',
  hotkey: 'none',
  ocrShortcut: 'ctrl-space',
  ocrModelTier: 'medium',
  ocrLanguage: 'ch',
  ttsEnabled: true,
  provider: 'google',
  deeplApiKey: '',
  tooltipFontSize: '16',
  ocrPinImage: false,
  ocrCopyToClipboard: true,
};

describe('translation target planning', () => {
  test('uses the first enabled target for detection', () => {
    expect(getDetectionTarget({ ...baseSettings, primaryTargetLang: 'none' })).toBe('zh');
    expect(getDetectionTarget({
      ...baseSettings,
      primaryTargetLang: 'none',
      secondaryTargetLang: 'none',
      reverseTargetLang: 'none',
    })).toBeNull();
  });

  test('omits disabled language slots from tooltip targets', () => {
    const targets = getTranslationTargets({
      ...baseSettings,
      primaryTargetLang: 'none',
      secondaryTargetLang: 'en',
    }, 'vi');

    expect(targets).toEqual([{ lang: 'en' }]);
  });

  test('removes the matching target when reverse is none', () => {
    const targets = getTranslationTargets({
      ...baseSettings,
      primaryTargetLang: 'vi',
      secondaryTargetLang: 'en',
      reverseTargetLang: 'none',
    }, 'vi');

    expect(targets).toEqual([{ lang: 'en' }]);
  });

  test('deduplicates targets after reverse substitution', () => {
    const targets = getTranslationTargets({
      ...baseSettings,
      primaryTargetLang: 'vi',
      secondaryTargetLang: 'en',
      reverseTargetLang: 'en',
    }, 'vi');

    expect(targets).toEqual([{ lang: 'en' }]);
  });
});
