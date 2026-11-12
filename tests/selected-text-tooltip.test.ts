// @vitest-environment jsdom
import { handleDesktopRequest } from '../src/services/desktop-host';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mockIPC, mockWindows, clearMocks } from '@tauri-apps/api/mocks';

const html = readFileSync('tooltip.html', 'utf8');
let commands: string[];
let network: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  mockWindows('tooltip');
  await import('../src/tooltip');
}, 30_000);

beforeEach(() => {
  document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)![1];
  localStorage.clear();
  commands = [];
  network = vi.fn(async (_url: RequestInfo | URL) => ({ ok: true, json: async () => [[['Xin chào', 'hello']], null, 'en'] }));
  vi.stubGlobal('fetch', network);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  mockWindows('tooltip');
});

afterEach(() => { clearMocks(); vi.unstubAllGlobals(); });

async function open(payload: unknown) {
  mockIPC((command,args: any) => {
    commands.push(command);
    if (command === 'desktop_request') return handleDesktopRequest(args.message);
    if (command === 'get_tooltip_data') return payload;
    if (command === 'get_app_settings') return { secondaryTargetLang: 'none', ttsEnabled: false };
    if (command === 'plugin:window|current_monitor') return null;
    return undefined;
  }, { shouldMockEvents: true });
  await import('../src/tooltip');
  window.dispatchEvent(new Event('DOMContentLoaded'));
}

test('a Selected Text acquisition failure shows a brief notice without translating or starting OCR', async () => {
  await open({ text: '', error: 'Không lấy được văn bản' });
  await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toBe('Không lấy được văn bản'), { timeout: 3000 });
  expect(network).not.toHaveBeenCalled();
  expect(commands).not.toContain('request_ocr');
  await vi.waitFor(() => expect(commands).toContain('close_tooltip_window'), { timeout: 3500 });
}, 10_000);

test('Selected Text goes directly into the tooltip translation flow without OCR', async () => {
  await open({ text: 'hello 世界', dataUrl: '' });
  await vi.waitFor(() => expect(document.getElementById('translation-extension-root')?.shadowRoot?.querySelector('.tt-translation-text')?.textContent).toBe('Xin chào'), { timeout: 3000 });
  expect(document.getElementById('translation-extension-root')?.shadowRoot?.querySelector('.tt-source-text')?.textContent).toBe('hello 世界');
  const queries = network.mock.calls.filter(([url]) => String(url).includes('translate.googleapis.com')).map(([url]) => new URL(String(url)).searchParams.get('q'));
  expect(queries.length).toBeGreaterThan(0);
  expect(queries.every((text) => text === 'hello 世界')).toBe(true);
  expect(commands).not.toContain('request_ocr');
});
