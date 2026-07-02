import type { TargetLanguage } from './translation-plan';

export interface Settings {
  primaryTargetLang: TargetLanguage;
  secondaryTargetLang: TargetLanguage;
  reverseTargetLang: TargetLanguage;
  hotkey: 'none' | 'ctrl' | 'alt' | 'shift';
  ocrShortcut: 'disabled' | 'ctrl-space' | 'alt-o' | 'ctrl-shift-o';
  ocrModelTier: 'tiny' | 'small' | 'medium';
  ocrLanguage: 'ch' | 'latin';
  ttsEnabled: boolean;
  provider: 'google' | 'deepl';
  deeplApiKey: string;
  tooltipFontSize: '12' | '14' | '16' | '18' | '20' | '24' | '28' | '32' | '36' | '40';
  ocrPinImage: boolean;
  ocrCopyToClipboard: boolean;
}

export class SettingsManager {
  static readonly DEFAULT_SETTINGS: Settings = {
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

  static async getSettings(): Promise<Settings> {
    const raw = localStorage.getItem('settings');
    if (raw) {
      try {
        return { ...this.DEFAULT_SETTINGS, ...JSON.parse(raw) };
      } catch {
        return this.DEFAULT_SETTINGS;
      }
    }
    return this.DEFAULT_SETTINGS;
  }

  static async updateSettings(settings: Partial<Settings>): Promise<Settings> {
    const current = await this.getSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem('settings', JSON.stringify(updated));
    return updated;
  }
}
