// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, test, vi } from 'vitest';
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(async () => {}) }));

afterEach(async () => {
  (await import('../src/platform/host-runtime')).stopDesktopHostTimers();
  vi.unstubAllGlobals(); vi.resetModules();
});

test('reading pending Account Link status immediately receives a website approval without waiting for a background timer', async () => {
  localStorage.clear();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname;
    if (path === '/api/link/start') return Response.json({ request_id: 'approval-1', poll_secret: 'synthetic', approve_url: 'https://example.test/?link=approval-1', expires_at: Math.floor(Date.now() / 1000) + 300 });
    if (path === '/api/link/poll') return Response.json({ state: 'linked', token: 'synthetic-token', account: { id: 'learner-1', username: 'learner' } });
    if (path === '/api/extension/me') return Response.json({ id: 'learner-1', username: 'learner' });
    throw new Error(`Unexpected request: ${path}`);
  });
  const service = await import('../src/services/learning-account');
  expect(await service.startAccountLink()).toMatchObject({ state: 'pending' });
  expect(await service.getAccountLinkStatus()).toMatchObject({ state: 'linked', username: 'learner' });
  await service.syncPendingItems();
});

test('simultaneous status refreshes consume the one-use approval only once', async () => {
  localStorage.clear(); vi.stubGlobal('indexedDB', new IDBFactory());
  let polls = 0;
  let release!: () => void;
  const network = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname;
    if (path === '/api/link/start') return Response.json({ request_id: 'one-use', poll_secret: 'synthetic', approve_url: 'https://example.test/?link=one-use', expires_at: Math.floor(Date.now() / 1000) + 300 });
    if (path === '/api/link/poll') {
      const index = ++polls;
      await network;
      return index === 1 ? Response.json({ state: 'linked', token: 'synthetic-token', account: { id: 'learner-1', username: 'learner' } }) : Response.json({ detail: 'Link request expired or used' }, { status: 410 });
    }
    if (path === '/api/extension/me') return Response.json({ id: 'learner-1', username: 'learner' });
    throw new Error(`Unexpected request: ${path}`);
  });
  const service = await import('../src/services/learning-account');
  await service.startAccountLink();
  const reads = Promise.all([service.getAccountLinkStatus(), service.getAccountLinkStatus()]);
  await vi.waitFor(() => expect(polls).toBeGreaterThan(0));
  release();
  const statuses = await reads;
  expect(polls).toBe(1);
  expect(statuses.map(value => value.state)).toEqual(['linked', 'linked']);
  expect(await service.getAccountLinkStatus()).toMatchObject({ state: 'linked', username: 'learner' });
  await service.syncPendingItems();
});
