import type { TargetLanguage } from './translation-plan';
import { invoke } from '@tauri-apps/api/core';

export interface Settings {
  primaryTargetLang: TargetLanguage;
  secondaryTargetLang: TargetLanguage;
  reverseTargetLang: TargetLanguage;
  autoTranslate: boolean;
  ocrShortcut: 'disabled' | 'ctrl-3' | 'alt-space' | 'ctrl-space' | 'alt-o' | 'ctrl-shift-o';
  ocrModelTier: 'tiny' | 'small' | 'medium';
  ocrLanguage: 'ch' | 'latin';
  ttsEnabled: boolean;
  provider: 'google' | 'deepl';
  deeplApiKey: string;
  tooltipFontSize: '12' | '14' | '16' | '18' | '20' | '24' | '28' | '32' | '36' | '40';
  ocrPinImage: boolean;
  ocrCopyToClipboard: boolean;
  startWithWindows: boolean;
}

export class SettingsManager {
  private static readonly STORAGE_KEY = 'settings';
  private static readonly NATIVE_MIGRATION_KEY = 'settings:native-migrated';

  static readonly DEFAULT_SETTINGS: Settings = {
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
  };

  static async getSettings(): Promise<Settings> {
    if (this.isTauriRuntime()) {
      try {
        const nativeSettings = { ...this.DEFAULT_SETTINGS, ...await invoke<Settings>('get_app_settings') };
        return await this.migrateLocalStorageSettings(nativeSettings);
      } catch (err) {
        console.error('Failed to load native settings:', err);
      }
    }

    const raw = localStorage.getItem(this.STORAGE_KEY);
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
    if (this.isTauriRuntime()) {
      try {
        return { ...this.DEFAULT_SETTINGS, ...await invoke<Settings>('update_app_settings', { patch: settings }) };
      } catch (err) {
        console.error('Failed to update native settings:', err);
      }
    }

    const current = await this.getSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(updated));
    return updated;
  }

  private static isTauriRuntime(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }

  private static async migrateLocalStorageSettings(nativeSettings: Settings): Promise<Settings> {
    if (localStorage.getItem(this.NATIVE_MIGRATION_KEY)) {
      return nativeSettings;
    }

    const raw = localStorage.getItem(this.STORAGE_KEY);
    if (!raw || !this.matchesDefaults(nativeSettings)) {
      localStorage.setItem(this.NATIVE_MIGRATION_KEY, '1');
      return nativeSettings;
    }

    try {
      const migrated = { ...this.DEFAULT_SETTINGS, ...JSON.parse(raw) };
      localStorage.setItem(this.NATIVE_MIGRATION_KEY, '1');
      return { ...this.DEFAULT_SETTINGS, ...await invoke<Settings>('update_app_settings', { patch: migrated }) };
    } catch (err) {
      console.error('Failed to migrate local settings to native settings:', err);
      return nativeSettings;
    }
  }

  private static matchesDefaults(settings: Settings): boolean {
    return JSON.stringify(settings) === JSON.stringify(this.DEFAULT_SETTINGS);
  }
}
