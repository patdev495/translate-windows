// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { mockIPC, mockWindows, clearMocks } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { SettingsManager } from '../src/services/settings';
afterEach(()=> { window.dispatchEvent(new Event('beforeunload')); clearMocks(); document.body.innerHTML=''; });

test('an Account Link status event updates Settings directly without polling away the new status',async()=> {
  document.body.innerHTML=readFileSync('settings.html','utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
  mockWindows('settings');
  let statusReads=0;
  mockIPC((command,args)=> {
    if(command==='get_app_settings') return SettingsManager.DEFAULT_SETTINGS;
    if(command==='get_desktop_values') return {};
    if(command==='get_autostart_enabled') return false;
    if(command==='desktop_request') {
      if((args as any).message.type==='GET_ACCOUNT_LINK_STATUS') { statusReads++; return {success:true,status:{state:'unlinked'}}; }
      return {success:true,result:[]};
    }
  },{shouldMockEvents:true});
  await import('../src/settings-window'); window.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(()=>expect(document.getElementById('learning-account-status')?.textContent).toBe('Chưa liên kết tài khoản web.'));
  await emit('desktop-values-changed',{learningAccountStatus:{newValue:{state:'linked',username:'learner'}}});
  await vi.waitFor(()=>expect(document.getElementById('learning-account-status')?.textContent).toBe('Đã liên kết: learner'));
  expect(statusReads).toBe(1);
});

test('returning from website approval refreshes Settings immediately even if its prior status event was missed', async () => {
  document.body.innerHTML = readFileSync('settings.html', 'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
  mockWindows('settings');
  let linked = false;
  mockIPC((command, args) => {
    if (command === 'get_app_settings') return SettingsManager.DEFAULT_SETTINGS;
    if (command === 'get_desktop_values') return {};
    if (command === 'get_autostart_enabled') return false;
    if (command === 'desktop_request') {
      if ((args as any).message.type === 'GET_ACCOUNT_LINK_STATUS') return { success: true, status: linked ? { state: 'linked', username: 'learner' } : { state: 'pending' } };
      return { success: true, result: [] };
    }
  }, { shouldMockEvents: true });
  await import('../src/settings-window'); window.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() => expect(document.getElementById('learning-account-status')?.textContent).toBe('Đang chờ xác nhận trên website.'));
  linked = true;
  window.dispatchEvent(new Event('focus'));
  await vi.waitFor(() => expect(document.getElementById('learning-account-status')?.textContent).toBe('Đã liên kết: learner'));
});
