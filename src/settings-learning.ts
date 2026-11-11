import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { desktopRuntime } from './platform/runtime';
import { onDesktopValuesChanged } from './platform/storage';
import { exportHanziLearningBackup, importHanziLearningBackup, inspectHanziLearningImport, parseHanziLearningBackup, type HanziLearningBackup } from './services/hanzi-learning';

export function initializeLearningSettings(): void {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const accountStatus = element('learning-account-status');
  if (!accountStatus) return;
  let pending: HanziLearningBackup | null = null;
  const status = element('hanzi-backup-status');
  const choice = element('hanzi-import-choice');
  const send = (type: string) => desktopRuntime.runtime.sendMessage({ type });
  async function refreshSync(type = 'LEARNING_SYNC_STATUS') {
    const response = await send(type);
    const list = element('learning-sync-list'); list.replaceChildren();
    if (!response.success) { list.textContent=response.error || 'Không tải được trạng thái đồng bộ.'; return; }
    const entries = (response.result || []).slice().reverse().slice(0,20);
    if (!entries.length) { list.textContent='Chưa có mục học tập chờ đồng bộ.'; return; }
    for (const entry of entries) {
      const row = document.createElement('li'); row.dataset.state=entry.state;
      row.textContent = `${entry.choice === 'both' ? `${entry.item.word_text} / ${entry.item.sentence_text}` : entry.item.text || ''} — ${entry.state === 'pending' ? 'Chờ đồng bộ' : entry.state === 'completed' ? 'Đã đồng bộ' : 'Thất bại'}`;
      if (entry.error) row.title=entry.error;
      list.append(row);
    }
  }
  function renderAccount(value: {state: string;username?: string;message?: string;webUrl?: string}) {
    accountStatus.textContent=value.state === 'linked' ? `Đã liên kết: ${value.username || 'tài khoản web'}` : value.message || (value.state === 'pending' ? 'Đang chờ xác nhận trên website.' : 'Chưa liên kết tài khoản web.');
    element('learning-account-link').hidden=value.state === 'linked';
    element('learning-account-unlink').hidden=value.state !== 'linked';
    if (value.webUrl) { const link=element<HTMLAnchorElement>('learning-account-web-url'); link.href=value.webUrl; link.textContent=value.webUrl; }
  }
  async function refresh(type = 'GET_ACCOUNT_LINK_STATUS') {
    const response = await send(type);
    if (!response.success) { accountStatus.textContent=response.error || 'Không kết nối được host nền.'; return; }
    renderAccount(response.status);
    await refreshSync();
  }
  for (const [id,type] of [['learning-account-link','START_ACCOUNT_LINK'],['learning-account-unlink','UNLINK_ACCOUNT']]) {
    element<HTMLButtonElement>(id).addEventListener('click',async event => {
      const button=event.currentTarget as HTMLButtonElement; button.disabled=true;
      try { await refresh(type); } catch (error) { accountStatus.textContent=String(error); } finally { button.disabled=false; }
    });
  }
  element('learning-sync-retry').addEventListener('click',()=> { void refreshSync('LEARNING_SYNC_RETRY'); });
  element<HTMLAnchorElement>('learning-account-web-url').addEventListener('click',event=> {
    event.preventDefault(); void openUrl((event.currentTarget as HTMLAnchorElement).href);
  });
  element('hanzi-export-backup').addEventListener('click',async()=> {
    try {
      const json=JSON.stringify(await exportHanziLearningBackup(),null,2);
      if ('__TAURI_INTERNALS__' in window) { const saved=await invoke<boolean>('save_hanzi_backup',{json}); status.textContent=saved ? 'Hanzi backup exported' : 'Đã hủy xuất file'; }
      else { const url=URL.createObjectURL(new Blob([json],{type:'application/json'})); const link=document.createElement('a'); link.href=url; link.download='hanzi-learning-backup.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); status.textContent='Hanzi backup exported'; }
    } catch (error) { status.textContent=String(error); }
  });
  const input=element<HTMLInputElement>('hanzi-backup-file');
  element('hanzi-import-backup').addEventListener('click',()=>input.click());
  input.addEventListener('change',async()=> {
    const file=input.files?.[0]; if (!file) return;
    pending=null; choice.hidden=true;
    try {
      const backup=parseHanziLearningBackup(await file.text());
      const summary=await inspectHanziLearningImport(backup);
      if (!summary.conflicts) { status.textContent=`Hanzi backup imported (${await importHanziLearningBackup(backup,'keep-current')} items)`; }
      else { pending=backup; element('hanzi-import-summary').textContent=`${summary.additions} mục mới, ${summary.conflicts} dữ liệu trùng. Chọn cách giữ dữ liệu.`; choice.hidden=false; }
    } catch { status.textContent='Invalid or unsupported Hanzi backup file'; }
    finally { input.value=''; }
  });
  for (const [id,policy] of [['hanzi-import-keep-current','keep-current'],['hanzi-import-use-file','use-file']] as const) {
    element(id).addEventListener('click',async()=> {
      if (!pending) return;
      try { status.textContent=`Hanzi backup imported (${await importHanziLearningBackup(pending,policy)} items)`; pending=null; choice.hidden=true; }
      catch (error) { status.textContent=String(error); }
    });
  }
  const unsubscribe = onDesktopValuesChanged(changes=> { if (changes.learningAccountStatus?.newValue) renderAccount(changes.learningAccountStatus.newValue); });
  const onFocus = () => { void refresh(); };
  const onVisible = () => { if (document.visibilityState === 'visible') onFocus(); };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisible);
  const interval=setInterval(()=> { void refresh(); },15_000);
  window.addEventListener('beforeunload',()=> {
    clearInterval(interval); unsubscribe();
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisible);
  },{once:true});
  void refresh();
}
