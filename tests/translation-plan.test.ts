import { describe, expect, test } from 'vitest';
import { getDetectionTarget, getTranslationTargets } from '../src/services/translation-plan';
import type { Settings } from '../src/services/settings';

const baseSettings: Settings = {
  primaryTargetLang: 'vi',
  secondaryTargetLang: 'zh',
  reverseTargetLang: 'en',
  autoTranslate: true,
  ocrShortcut: 'alt-space',
  ocrModelTier: 'medium',
  ocrLanguage: 'ch',
  ttsEnabled: true,
  provider: 'google',
  deeplApiKey: '',
  tooltipFontSize: '16',
  phoneticsVisible: true,
  ocrPinImage: false,
  ocrCopyToClipboard: true,
  startWithWindows: false,
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
