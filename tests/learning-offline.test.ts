// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, test, vi } from 'vitest';

// External browser launcher is an OS boundary; account/storage/sync modules stay real.
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(async () => {}) }));
const stopHosts: Array<() => void> = [];
afterEach(() => {
  stopHosts.splice(0).forEach(stop => stop());
  vi.unstubAllGlobals();
  vi.resetModules();
});

test('offline learning survives a host restart and syncs only under its original linked account', async () => {
  localStorage.clear();
  vi.stubGlobal('indexedDB', new IDBFactory());
  let account = 'A';
  let offline = true;
  const delivered: Array<{ token: string; text: string; choice: string }> = [];
  vi.stubGlobal('fetch', async (url: string, options: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
    if (path === '/api/link/start') return json({ request_id: `link-${account}`, poll_secret: 'synthetic', approve_url: 'https://example.test/approve', expires_at: Math.floor(Date.now() / 1000) + 600 });
    if (path === '/api/link/poll') return json({ state: 'linked', token: `token-${account}`, account: { id: account, username: `learner-${account}` } });
    if (path === '/api/extension/me') return json({ id: account, username: `learner-${account}` });
    if (path === '/api/extension/revoke') return new Response(null, { status: 204 });
    if (path === '/api/extension/sync') {
      if (offline) throw new TypeError('Synthetic network offline');
      const body = JSON.parse(String(options.body));
      delivered.push({ token: new Headers(options.headers).get('Authorization')!, text: body.item.text ?? body.item.word_text, choice: body.choice });
      return json({ success: true });
    }
    throw new Error(`Unexpected learning request: ${path}`);
  });
  async function host() {
    const service = await import('../src/services/learning-account');
    const runtime = await import('../src/platform/host-runtime');
    stopHosts.push(runtime.stopDesktopHostTimers);
    return service;
  }
  let service = await host();
  await service.startAccountLink();
  await service.pollAccountLink();
  await service.syncPendingItems();
  expect(await service.getAccountLinkStatus()).toMatchObject({ state: 'linked', username: 'learner-A' });
  expect(await service.saveLearningItem('word', { text: '你好', meaning: 'xin chào', folder_id: 'folder-A' })).toMatchObject({ account_id: 'A', state: 'pending' });

  // A new module instance represents a restarted main host, retaining its public storage.
  stopHosts.splice(0).forEach(stop => stop());
  vi.resetModules();
  service = await host();
  expect(await service.listSyncItems()).toMatchObject([{ account_id: 'A', state: 'pending', item: { text: '你好' } }]);
  await service.unlinkAccount();
  account = 'B';
  offline = false;
  await service.startAccountLink();
  await service.pollAccountLink();
  await service.syncPendingItems();
  expect(await service.listSyncItems()).toEqual([]);
  await service.retryFailedItems();
  expect(delivered).toEqual([]);
  expect(await service.saveLearningItem('both', { word_text: '学习', sentence_text: '我学习中文。', folder_id: 'folder-B' })).toMatchObject({ account_id: 'B', state: 'completed' });
  expect(delivered).toEqual([{ token: 'Bearer token-B', text: '学习', choice: 'both' }]);

  await service.unlinkAccount();
  account = 'A';
  await service.startAccountLink();
  await service.pollAccountLink();
  await service.syncPendingItems();
  expect(await service.listSyncItems()).toMatchObject([{ account_id: 'A', state: 'completed', item: { text: '你好' } }]);
  expect(delivered).toEqual([
    { token: 'Bearer token-B', text: '学习', choice: 'both' },
    { token: 'Bearer token-A', text: '你好', choice: 'word' },
  ]);
});
