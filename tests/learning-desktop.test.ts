// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, test, vi } from 'vitest';
import { handleDesktopRequest } from '../src/services/desktop-host';
import { SettingsManager } from '../src/services/settings';

afterEach(() => { vi.unstubAllGlobals(); });

test('saving Chinese learning content without an Account Link asks for linking and never contacts the server', async () => {
  localStorage.clear();
  vi.stubGlobal('indexedDB', new IDBFactory());
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  const response = await handleDesktopRequest({ type: 'LEARNING_SAVE', choice: 'word', item: { text: '你好', meaning: 'xin chào', folder_id: 'f1' } });
  expect(response.success).toBe(false);
  expect(response.error).toContain('liên kết');
  expect(network).not.toHaveBeenCalled();
});

test('the master translation switch prevents new meaning requests from contacting a provider',async()=> {
  localStorage.clear();
  await SettingsManager.updateSettings({translationActive:false});
  const network=vi.fn(); vi.stubGlobal('fetch',network);
  const response=await handleDesktopRequest({type:'LEARNING_SUGGEST_MEANING',text:'你好'});
  expect(response.success).toBe(false);
  expect(response.error).toContain('disabled');
  expect(network).not.toHaveBeenCalled();
});
