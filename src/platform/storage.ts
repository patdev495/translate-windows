import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type Values = Record<string, any>;
export type Changes = Record<string, { oldValue?: any; newValue?: any }>;
const listeners = new Set<(changes: Changes, area: string) => void>();
let subscribed = false;
const isNative = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const desktopStorage = {
  async get(keys: string | string[] | null, callback?: (values: Values) => void): Promise<Values> {
    let values: Values;
    if (isNative()) values = await invoke<Values>('get_desktop_values', { keys });
    else {
      const all = JSON.parse(localStorage.getItem('desktop-values') || '{}') as Values;
      values = keys === null ? all : Object.fromEntries((typeof keys === 'string' ? [keys] : keys).filter(key => key in all).map(key => [key, all[key]]));
    }
    callback?.(values);
    return values;
  },
  async set(values: Values): Promise<void> {
    if (isNative()) { await invoke('set_desktop_values', { values }); return; }
    const previous = JSON.parse(localStorage.getItem('desktop-values') || '{}') as Values;
    localStorage.setItem('desktop-values', JSON.stringify({ ...previous, ...values }));
    const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { oldValue: previous[key], newValue }]));
    listeners.forEach(listener => listener(changes, 'local'));
  },
};

export function onDesktopValuesChanged(listener: (changes: Changes, area: string) => void): () => void {
  listeners.add(listener);
  if (!subscribed && isNative()) {
    subscribed = true;
    void listen<Changes>('desktop-values-changed', event => listeners.forEach(fn => fn(event.payload, 'local'))).catch(() => { subscribed = false; });
  }
  return () => { listeners.delete(listener); };
}
