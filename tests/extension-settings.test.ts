// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { mockIPC, mockWindows, clearMocks } from '@tauri-apps/api/mocks';
import { SettingsManager } from '../src/services/settings';

afterEach(() => { window.dispatchEvent(new Event('beforeunload')); clearMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

test('the Provider tab lets the user change the tooltip shortcut without changing replacement or OCR', async () => {
  document.body.innerHTML = readFileSync('settings.html', 'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
  localStorage.clear();
  mockWindows('settings');
  let saved = { ...SettingsManager.DEFAULT_SETTINGS };
  mockIPC((cmd, args) => {
    if (cmd === 'get_app_settings') return saved;
    if (cmd === 'get_desktop_values') return {};
    if (cmd === 'get_autostart_enabled') return false;
    if (cmd === 'update_app_settings') { saved = { ...saved, ...(args as any).patch }; return saved; }
  }, { shouldMockEvents: true });
  await import('../src/settings-window');
  window.dispatchEvent(new Event('DOMContentLoaded'));
  const provider = document.querySelector<HTMLButtonElement>('#tab-provider');
  expect(provider, 'Settings should expose the same Provider tab as the extension').not.toBeNull();
  provider!.click();
  const shortcut = document.querySelector<HTMLInputElement>('#translation-shortcut')!;
  await vi.waitFor(() => expect(shortcut.value).toBe('Alt+Q'));
  shortcut.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', altKey: true, bubbles: true }));
  await vi.waitFor(() => expect(saved.translationShortcut).toBe('Alt+KeyR'));
  expect([saved.inputReplacementShortcut, saved.ocrShortcut]).toEqual(['Alt+KeyW', 'ctrl-3']);
});

test('a shortcut rejected by Windows shows an error and keeps the previous working shortcut', async () => {
  document.body.innerHTML = readFileSync('settings.html', 'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
  localStorage.clear();
  mockWindows('settings');
  const saved = { ...SettingsManager.DEFAULT_SETTINGS };
  mockIPC(cmd => {
    if (cmd === 'get_app_settings') return saved;
    if (cmd === 'get_desktop_values') return {};
    if (cmd === 'get_autostart_enabled') return false;
    if (cmd === 'update_app_settings') throw new Error('Phím đã được ứng dụng khác sử dụng');
  }, { shouldMockEvents: true });
  await import('../src/settings-window');
  window.dispatchEvent(new Event('DOMContentLoaded'));
  const shortcut = document.querySelector<HTMLInputElement>('#translation-shortcut')!;
  await vi.waitFor(() => expect(shortcut.value).toBe('Alt+Q'));
  shortcut.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', altKey: true, bubbles: true }));
  await vi.waitFor(() => expect(document.getElementById('shortcut-error')?.textContent).toContain('Phím đã được ứng dụng khác sử dụng'));
  expect(shortcut.value).toBe('Alt+Q');
  expect((await SettingsManager.getSettings()).translationShortcut).toBe('Alt+KeyQ');
});

test('a standalone Ctrl is saved on release and holding Ctrl for a chord never saves a temporary Ctrl shortcut', async () => {
  document.body.innerHTML = readFileSync('settings.html', 'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
  mockWindows('settings');
  let saved = { ...SettingsManager.DEFAULT_SETTINGS };
  const writes: string[] = [];
  mockIPC((command, args) => {
    if (command === 'get_app_settings') return saved;
    if (command === 'get_desktop_values') return {};
    if (command === 'get_autostart_enabled') return false;
    if (command === 'update_app_settings') {
      saved = { ...saved, ...(args as any).patch }; writes.push(saved.translationShortcut); return saved;
    }
  }, { shouldMockEvents: true });
  await import('../src/settings-window');
  window.dispatchEvent(new Event('DOMContentLoaded'));
  const input = document.querySelector<HTMLInputElement>('#translation-shortcut')!;
  await vi.waitFor(() => expect(input.value).toBe('Alt+Q'));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, bubbles: true }));
  expect(writes).toEqual([]);
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', bubbles: true }));
  await vi.waitFor(() => expect(saved.translationShortcut).toBe('Ctrl'));
  expect(input.value).toBe('Ctrl');
  writes.length = 0;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', ctrlKey: true, bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'r', code: 'KeyR', ctrlKey: true, bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', bubbles: true }));
  await vi.waitFor(() => expect(saved.translationShortcut).toBe('Ctrl+KeyR'));
  expect(writes).toEqual(['Ctrl+KeyR']);
});
