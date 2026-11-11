import { desktopHostRuntime as chrome } from '../platform/host-runtime';
import { desktopFetch as fetch } from '../platform/http';
declare const __LEARNING_API_BASE__: string;
declare const __LEARNING_WEB_BASE__: string;
import { pinyin } from 'pinyin-pro';

const API_BASE = (typeof __LEARNING_API_BASE__ === 'string' ? __LEARNING_API_BASE__ : 'https://learning.peebot.shop').replace(/\/$/, '');
const WEB_BASE = (typeof __LEARNING_WEB_BASE__ === 'string' ? __LEARNING_WEB_BASE__ : 'https://learning.peebot.shop').replace(/\/$/, '');
const ALARM_NAME = 'polytranslate-learning-link-poll';
const PUBLIC_STATUS_KEY = 'learningAccountStatus';
const SYNC_ALARM_NAME = 'polytranslate-learning-sync';

interface Account {
  id: string;
  username: string;
}

interface PendingLink {
  state: 'pending';
  requestId: string;
  pollSecret: string;
  approveUrl: string;
  expiresAt: number;
}

interface LinkedAccount {
  state: 'linked';
  token: string;
  account: Account;
}

export interface PendingSyncItem {
  id: string;
  account_id: string;
  choice: 'word' | 'sentence' | 'both';
  item: Record<string, string | boolean>;
  pinyin: string;
  sentence_pinyin?: string;
  state: 'pending' | 'completed' | 'failed';
  error?: string;
}

type PrivateLinkState = PendingLink | LinkedAccount;

export interface PublicLinkStatus {
  state: 'unlinked' | 'pending' | 'linked' | 'error';
  webUrl: string;
  username?: string;
  message?: string;
}

function accountUsername(account: Account): string | undefined {
  return account.username ?? (account as Account & { email?: string }).email;
}

function openLinkDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('polytranslate-learning-account', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('link')) request.result.createObjectStore('link');
      if (!request.result.objectStoreNames.contains('sync')) request.result.createObjectStore('sync', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function syncStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason: unknown) => void) => void): Promise<T> {
  const database = await openLinkDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('sync', mode);
    action(transaction.objectStore('sync'), resolve, reject);
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.oncomplete = () => database.close();
  });
}

async function allSyncItems(): Promise<PendingSyncItem[]> {
  return syncStore('readonly', (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as PendingSyncItem[]);
    request.onerror = () => reject(request.error);
  });
}

async function putSyncItem(item: PendingSyncItem): Promise<void> {
  const database = await openLinkDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('sync', 'readwrite');
    transaction.objectStore('sync').put(item);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

export async function listSyncItems(): Promise<PendingSyncItem[]> {
  const current = await readPrivateState();
  if (current?.state !== 'linked') return [];
  return (await allSyncItems()).filter(item => item.account_id === current.account.id);
}

let syncing: Promise<void> | null = null;

export function syncPendingItems(): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    const current = await readPrivateState();
    if (current?.state !== 'linked') return;
    const pending = (await allSyncItems()).filter(item => item.account_id === current.account.id && item.state === 'pending');
    for (const entry of pending) {
      try {
        await learningRequest('/sync', {
          method: 'POST', body: JSON.stringify({ request_id: entry.id, choice: entry.choice, item: entry.item }),
        }, entry.account_id);
        await putSyncItem({ ...entry, state: 'completed', error: undefined });
      } catch (error) {
        const transient = error instanceof TypeError || error instanceof AccountChangedError || (error instanceof LearningRequestError && error.status >= 500);
        if (!transient) await putSyncItem({ ...entry, state: 'failed', error: error instanceof Error ? error.message : 'Không đồng bộ được.' });
      }
    }
    const stillPending = (await allSyncItems()).some(item => item.account_id === current.account.id && item.state === 'pending');
    if (stillPending) await chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: 1 });
    else await chrome.alarms.clear(SYNC_ALARM_NAME);
  })().finally(() => { syncing = null; });
  return syncing;
}

export async function retryFailedItems(): Promise<void> {
  const current = await readPrivateState();
  if (current?.state !== 'linked') return;
  for (const entry of await allSyncItems()) {
    if (entry.account_id === current.account.id && entry.state === 'failed') {
      await putSyncItem({ ...entry, state: 'pending', error: undefined });
    }
  }
  await syncPendingItems();
}

export async function saveLearningItem(choice: PendingSyncItem['choice'], item: Record<string, string | boolean>): Promise<PendingSyncItem> {
  const current = await readPrivateState();
  if (current?.state !== 'linked') throw new Error('Hãy liên kết tài khoản trong cài đặt desktop.');
  const entry: PendingSyncItem = {
    id: crypto.randomUUID(), account_id: current.account.id, choice, item,
    pinyin: pinyin(String(choice === 'both' ? item.word_text : item.text), { toneType: 'symbol' }),
    ...(choice === 'both' ? { sentence_pinyin: pinyin(String(item.sentence_text), { toneType: 'symbol' }) } : {}),
    state: 'pending',
  };
  await putSyncItem(entry);
  await chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: 1 });
  await syncPendingItems();
  return (await allSyncItems()).find(saved => saved.id === entry.id) ?? entry;
}

async function readPrivateState(): Promise<PrivateLinkState | null> {
  const database = await openLinkDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('link', 'readonly');
    const request = transaction.objectStore('link').get('current');
    request.onsuccess = () => resolve((request.result as PrivateLinkState | undefined) ?? null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

async function writePrivateState(value: PrivateLinkState | null): Promise<void> {
  const database = await openLinkDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('link', 'readwrite');
    const store = transaction.objectStore('link');
    if (value) store.put(value, 'current');
    else store.delete('current');
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

async function publishStatus(status: Omit<PublicLinkStatus, 'webUrl'>): Promise<PublicLinkStatus> {
  const publicStatus = { ...status, webUrl: WEB_BASE };
  await chrome.storage.local.set({ [PUBLIC_STATUS_KEY]: publicStatus });
  return publicStatus;
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  if (!response.ok) throw new Error(response.status === 410 ? 'Yêu cầu liên kết đã hết hạn.' : `Máy chủ trả lỗi ${response.status}.`);
  return response.status === 204 ? undefined as T : await response.json() as T;
}

export async function startAccountLink(): Promise<PublicLinkStatus> {
  const current = await readPrivateState();
  if (current?.state === 'linked') {
    return getAccountLinkStatus();
  }
  let pending: PendingLink;
  if (current?.state === 'pending' && current.expiresAt * 1000 > Date.now()) {
    pending = current;
  } else {
    const started = await api<{
      request_id: string; poll_secret: string; approve_url: string; expires_at: number;
    }>('/api/link/start', { method: 'POST' });
    pending = {
      state: 'pending', requestId: started.request_id, pollSecret: started.poll_secret,
      approveUrl: started.approve_url, expiresAt: started.expires_at,
    };
    await writePrivateState(pending);
  }
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
  await chrome.tabs.create({ url: pending.approveUrl });
  return publishStatus({ state: 'pending', message: 'Đang chờ xác nhận trên web.' });
}

let polling: Promise<void> | null = null;
export function pollAccountLink(): Promise<void> {
  if (!polling) polling = receiveAccountLink().finally(() => { polling = null; });
  return polling;
}

async function receiveAccountLink(): Promise<void> {
  const pending = await readPrivateState();
  if (pending?.state !== 'pending') {
    await chrome.alarms.clear(ALARM_NAME);
    return;
  }
  if (pending.expiresAt * 1000 <= Date.now()) {
    await writePrivateState(null);
    await chrome.alarms.clear(ALARM_NAME);
    await publishStatus({ state: 'error', message: 'Yêu cầu liên kết hết hạn. Hãy thử lại.' });
    return;
  }
  try {
    const result = await api<{
      state: 'pending' | 'linked'; token?: string; account?: Account;
    }>('/api/link/poll', {
      method: 'POST',
      body: JSON.stringify({ request_id: pending.requestId, poll_secret: pending.pollSecret }),
    });
    if (result.state === 'pending') return;
    if (!result.token || !result.account) throw new Error('Phản hồi liên kết không hợp lệ.');
    await writePrivateState({ state: 'linked', token: result.token, account: result.account });
    await chrome.alarms.clear(ALARM_NAME);
    await publishStatus({ state: 'linked', username: result.account.username });
    void syncPendingItems();
  } catch (error) {
    if (error instanceof Error && error.message.includes('hết hạn')) {
      await writePrivateState(null);
      await chrome.alarms.clear(ALARM_NAME);
      await publishStatus({ state: 'error', message: error.message });
    }
  }
}

export async function getAccountLinkStatus(): Promise<PublicLinkStatus> {
  let current = await readPrivateState();
  if (current?.state === 'pending') {
    await pollAccountLink();
    current = await readPrivateState();
  }
  if (current?.state === 'pending') {
    return publishStatus({ state: 'pending', message: 'Đang chờ xác nhận trên web.' });
  }
  if (current?.state === 'linked') {
    try {
      const account = await api<Account>('/api/extension/me', {
        headers: { Authorization: `Bearer ${current.token}` },
      });
      await writePrivateState({ ...current, account });
      return publishStatus({ state: 'linked', username: account.username });
    } catch (error) {
      if (error instanceof Error && error.message.includes('401')) {
        await writePrivateState(null);
        return publishStatus({ state: 'unlinked', message: 'Liên kết đã hết hạn hoặc bị thu hồi.' });
      }
    }
    return publishStatus({ state: 'linked', username: accountUsername(current.account) });
  }
  const stored = await chrome.storage.local.get(PUBLIC_STATUS_KEY);
  const previous = stored[PUBLIC_STATUS_KEY] as PublicLinkStatus | undefined;
  return previous?.state === 'error' ? publishStatus(previous) : publishStatus({ state: 'unlinked' });
}

export async function unlinkAccount(): Promise<PublicLinkStatus> {
  const current = await readPrivateState();
  if (current?.state === 'linked') {
    await api<void>('/api/extension/revoke', {
      method: 'POST', headers: { Authorization: `Bearer ${current.token}` },
    });
  }
  await writePrivateState(null);
  await chrome.alarms.clear(ALARM_NAME);
  return publishStatus({ state: 'unlinked' });
}

class LearningRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

class AccountChangedError extends Error {}

export async function learningRequest<T>(path: string, options: RequestInit = {}, expectedAccountId?: string): Promise<T> {
  const current = await readPrivateState();
  if (current?.state !== 'linked') throw new Error('Hãy liên kết tài khoản trong cài đặt desktop.');
  if (expectedAccountId && current.account.id !== expectedAccountId) throw new AccountChangedError('Tài khoản liên kết đã thay đổi.');
  const response = await fetch(`${API_BASE}/api/extension${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${current.token}`, ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 409) {
      const duplicate = body?.detail?.existing_item;
      throw new LearningRequestError(response.status, duplicate ? `Duplicate Learning Item: ${duplicate.text}` : 'Duplicate Learning Item');
    }
    if (response.status === 401) throw new LearningRequestError(response.status, 'Liên kết hết hạn. Hãy liên kết lại trong cài đặt desktop.');
    throw new LearningRequestError(response.status, typeof body.detail === 'string' ? body.detail : `Máy chủ trả lỗi ${response.status}.`);
  }
  return await response.json() as T;
}

export async function openLearningLibrary(): Promise<void> {
  await chrome.tabs.create({ url: WEB_BASE });
}

chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void pollAccountLink();
  if (alarm.name === SYNC_ALARM_NAME) void syncPendingItems();
});

chrome.runtime.onStartup?.addListener(() => {
  void readPrivateState().then((state) => {
    if (state?.state === 'pending') {
      void chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
    }
    if (state?.state === 'linked') void syncPendingItems();
  });
});
