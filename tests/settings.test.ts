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
    });
  });

  test('should update settings and retrieve updated values', async () => {
    const updated = await SettingsManager.updateSettings({
      primaryTargetLang: 'en',
      hotkey: 'ctrl',
      ocrShortcut: 'alt-o',
    });
    expect(updated.primaryTargetLang).toBe('en');
    expect(updated.hotkey).toBe('ctrl');
    expect(updated.ocrShortcut).toBe('alt-o');

    const retrieved = await SettingsManager.getSettings();
    expect(retrieved.primaryTargetLang).toBe('en');
    expect(retrieved.secondaryTargetLang).toBe('zh');
    expect(retrieved.reverseTargetLang).toBe('en');
    expect(retrieved.hotkey).toBe('ctrl');
    expect(retrieved.ocrShortcut).toBe('alt-o');
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
