/** Desktop ports used by the UI imported from the extension. No browser extension is required. */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { desktopStorage, onDesktopValuesChanged, type Values } from './storage';
import { SettingsManager } from '../services/settings';

const native = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const storage = {
  async get(keys: string | string[] | null, callback?: (values: Values) => void): Promise<Values> {
    const values = await desktopStorage.get(keys);
    if (keys === null || keys === 'settings' || Array.isArray(keys) && keys.includes('settings')) {
      const settings = await SettingsManager.getSettings();
      values.settings = { ...settings, autoTranslate: settings.autoSelectionTranslate };
    }
    callback?.(values);
    return values;
  },
  async set(values: Values): Promise<void> {
    const { settings, ...other } = values;
    if (settings) {
      const current = await SettingsManager.getSettings();
      await SettingsManager.updateSettings({ ...settings, autoTranslate: current.autoTranslate, autoSelectionTranslate: settings.autoTranslate });
    }
    if (Object.keys(other).length) await desktopStorage.set(other);
  },
};

export const desktopRuntime = {
  storage: { local: storage, onChanged: { addListener: (fn: Parameters<typeof onDesktopValuesChanged>[0]) => {
    onDesktopValuesChanged(fn);
    if (native()) void listen('settings-changed',event => fn({ settings: { newValue: event.payload } },'local'));
  } } },
  runtime: {
    getURL: (path: string) => new URL(`/${path.replace(/^\//, '')}`, window.location.href).href,
    sendMessage(message: Record<string, any>, callback?: (response: any) => void): Promise<any> {
      const response = native() ? invoke('desktop_request', { message }) : Promise.resolve({ success: false, error: 'Desktop host is unavailable in browser preview.' });
      const safe = response.then(value => value ?? { success: false, error: 'Desktop host did not return a response.' }).catch(error => ({ success: false, error: String(error) }));
      if (callback) void safe.then(callback);
      return safe;
    },
    onMessage: { addListener: (fn: (message: any) => void) => {
      if (native()) void listen('desktop-message', event => fn(event.payload));
    } },
  },
};
