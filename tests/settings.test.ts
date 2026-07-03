import { describe, test, expect, beforeEach, vi } from 'vitest';
import { SettingsManager } from '../src/services/settings';

let mockStorage: Record<string, string> = {};

global.localStorage = {
  getItem: vi.fn((key: string) => mockStorage[key] || null),
  setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
  clear: vi.fn(() => { mockStorage = {}; }),
  length: 0,
  key: vi.fn((index: number) => null),
} as any;

describe('SettingsManager', () => {
  beforeEach(() => {
    mockStorage = {};
  });

  test('should return default settings when storage is empty', async () => {
    const settings = await SettingsManager.getSettings();
    expect(settings).toEqual({
      primaryTargetLang: 'vi',
      secondaryTargetLang: 'zh',
      reverseTargetLang: 'en',
      autoTranslate: true,
      ocrShortcut: 'ctrl-3',
      ocrModelTier: 'medium',
      ocrLanguage: 'ch',
      ttsEnabled: true,
      provider: 'google',
      deeplApiKey: '',
      tooltipFontSize: '16',
      ocrPinImage: false,
      ocrCopyToClipboard: true,
      startWithWindows: false,
    });
  });

  test('should update settings and retrieve updated values', async () => {
    const updated = await SettingsManager.updateSettings({
      primaryTargetLang: 'en',
      autoTranslate: false,
      ocrShortcut: 'alt-o',
      startWithWindows: true,
    });
    expect(updated.primaryTargetLang).toBe('en');
    expect(updated.autoTranslate).toBe(false);
    expect(updated.ocrShortcut).toBe('alt-o');

    const retrieved = await SettingsManager.getSettings();
    expect(retrieved.primaryTargetLang).toBe('en');
    expect(retrieved.secondaryTargetLang).toBe('zh');
    expect(retrieved.reverseTargetLang).toBe('en');
    expect(retrieved.autoTranslate).toBe(false);
    expect(retrieved.ocrShortcut).toBe('alt-o');
    expect(retrieved.startWithWindows).toBe(true);
    expect(retrieved.provider).toBe('google');
    expect(retrieved.deeplApiKey).toBe('');
  });

  test('should allow disabling individual translation targets', async () => {
    const updated = await SettingsManager.updateSettings({
      primaryTargetLang: 'none',
      secondaryTargetLang: 'none',
      reverseTargetLang: 'none',
    });

    expect(updated.primaryTargetLang).toBe('none');
    expect(updated.secondaryTargetLang).toBe('none');
    expect(updated.reverseTargetLang).toBe('none');
  });
});
