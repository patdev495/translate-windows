import { openUrl } from '@tauri-apps/plugin-opener';
import { desktopRuntime } from './runtime';

const handlers = new Set<(alarm: { name: string }) => void>();
const starts = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setInterval>>();
export const desktopHostRuntime = {
  ...desktopRuntime,
  runtime: { ...desktopRuntime.runtime, onStartup: { addListener: (fn: () => void) => { starts.add(fn); } } },
  tabs: { create: async ({ url }: { url: string }) => { if (!/^https?:\/\//.test(url)) throw new Error('Invalid external URL'); await openUrl(url); } },
  alarms: {
    create: async (name: string, { periodInMinutes }: { periodInMinutes: number }) => {
      const previous = timers.get(name); if (previous) clearInterval(previous);
      timers.set(name, setInterval(() => handlers.forEach(fn => fn({ name })), periodInMinutes * 60_000));
    },
    clear: async (name: string) => { const timer = timers.get(name); if (timer) clearInterval(timer); return timers.delete(name); },
    onAlarm: { addListener: (fn: (alarm: { name: string }) => void) => { handlers.add(fn); } },
  },
};
export function restoreDesktopHost(): void { starts.forEach(fn => fn()); }
export function stopDesktopHostTimers(): void { timers.forEach(clearInterval); timers.clear(); }
