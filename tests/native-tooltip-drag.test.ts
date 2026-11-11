// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { SettingsManager } from '../src/services/settings';

afterEach(() => { clearMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

test('dragging native tooltip padding moves the desktop window and keeps the card inside it', async () => {
  mockWindows('tooltip');
  let drags = 0;
  mockIPC(command => {
    if (command === 'get_app_settings') return { ...SettingsManager.DEFAULT_SETTINGS, ttsEnabled: false };
    if (command === 'get_tooltip_data') return { text: '你好', translationData: { detectedLang: 'zh', translations: [{ lang: 'vi', text: 'xin chào', phonetics: '' }] } };
    if (command === 'plugin:window|current_monitor') return null;
    if (command === 'plugin:window|start_dragging') drags++;
  }, { shouldMockEvents: true });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  await import('../src/tooltip');
  window.dispatchEvent(new Event('DOMContentLoaded'));
  const card = await vi.waitFor(() => {
    const element = document.getElementById('translation-extension-root')?.shadowRoot?.querySelector<HTMLElement>('#tooltip');
    expect(element?.style.position).toBe('relative');
    return element!;
  });
  // JSDOM has no OS pointer capture. The real entrypoint and all tooltip handlers remain active.
  card.setPointerCapture = vi.fn();
  const before = { left: card.style.left, top: card.style.top };
  card.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 80, clientY: 20, bubbles: true, cancelable: true }));
  card.dispatchEvent(new MouseEvent('pointermove', { clientX: 180, clientY: 90, bubbles: true }));
  card.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  await vi.waitFor(() => expect(drags).toBe(1));
  expect({ left: card.style.left, top: card.style.top }).toEqual(before);
  card.querySelector('.tt-source-text')!.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }));
  expect(drags).toBe(1);
});
