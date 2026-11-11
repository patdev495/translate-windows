import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { SettingsManager } from './settings';
import { TranslationCoordinator } from './translation-coordinator';
import { TranslationEngine } from './translation';
import { PhoneticEngine } from './learning-phonetics';
import { desktopStorage } from '../platform/storage';
import { restoreDesktopHost, stopDesktopHostTimers } from '../platform/host-runtime';
import { getAccountLinkStatus, startAccountLink, unlinkAccount, listSyncItems, retryFailedItems, learningRequest, saveLearningItem, openLearningLibrary } from './learning-account';

export async function handleDesktopRequest(message: Record<string, any>): Promise<Record<string, any>> {
  try {
    if (typeof message.type === 'string' && (message.type.startsWith('TRANSLATE') || message.type === 'LEARNING_SUGGEST_MEANING')) {
      if (!(await SettingsManager.getSettings()).translationActive) throw new Error('Translation is disabled');
    }
    switch (message.type) {
      case 'GET_ACCOUNT_LINK_STATUS': return { success: true, status: await getAccountLinkStatus() };
      case 'START_ACCOUNT_LINK': return { success: true, status: await startAccountLink() };
      case 'UNLINK_ACCOUNT': return { success: true, status: await unlinkAccount() };
      case 'LEARNING_SYNC_STATUS': return { success: true, result: await listSyncItems() };
      case 'LEARNING_SYNC_RETRY': await retryFailedItems(); return { success: true, result: await listSyncItems() };
      case 'LEARNING_FOLDERS': return { success: true, result: await learningRequest('/folders') };
      case 'LEARNING_FIND_SENTENCE': return { success: true, item: await learningRequest(`/items/existing?${new URLSearchParams({ folder_id: message.folder_id, text: message.text })}`) };
      case 'LEARNING_SAVE': { const result = await saveLearningItem(message.choice, message.item); return { success: true, state: result.state, result }; }
      case 'LEARNING_OPEN_LIBRARY': await openLearningLibrary(); return { success: true };
      case 'OPEN_EXTENSION_SETTINGS': await invoke('open_settings_window'); return { success: true };
      case 'SETTINGS_UPDATED': return { success: true };
      case 'TRANSLATE': return { success: true, data: await TranslationCoordinator.translate(String(message.text), await SettingsManager.getSettings()) };
      case 'TRANSLATE_DIRECT_PRIMARY': return { success: true, data: await TranslationCoordinator.translateDirectToPrimary(String(message.text), await SettingsManager.getSettings()) };
      case 'TRANSLATE_SELECTION': {
        if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 500 || !['vi','en','zh'].includes(message.targetLang)) throw new Error('Invalid selection translation');
        const result = await TranslationEngine.translateWithSettings(message.text, message.targetLang, await SettingsManager.getSettings());
        const phonetics = message.targetLang === 'zh' ? PhoneticEngine.getPinyin(result.translation) : message.targetLang === 'en' ? await PhoneticEngine.getEnglishIPA(result.translation) : '';
        return { success: true, translation: result.translation, phonetics };
      }
      case 'LEARNING_SUGGEST_MEANING':
      case 'TRANSLATE_HANZI_MEANING': {
        const text = String(message.meaning ?? message.text ?? '').trim();
        if (!text) throw new Error('Chưa có nội dung để dịch');
        const key = `hanziMeaning:${text}`;
        const previous = message.type === 'TRANSLATE_HANZI_MEANING' ? await desktopStorage.get(key) : {};
        const meaning = previous[key] ?? (await TranslationEngine.translateWithSettings(text, 'vi', await SettingsManager.getSettings())).translation.trim();
        if (!meaning || meaning === text) throw new Error('Không tìm được nghĩa gợi ý. Hãy nhập nghĩa trước khi lưu.');
        if (message.type === 'TRANSLATE_HANZI_MEANING') await desktopStorage.set({ [key]: meaning });
        return { success: true, meaning };
      }
      default: throw new Error('Unsupported desktop request');
    }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
}

export async function startDesktopHost(): Promise<() => void> {
  const unlisten = await listen<{ id: string; message: Record<string, any> }>('desktop-request', event => {
    void handleDesktopRequest(event.payload.message).then(response => invoke('desktop_reply', { id: event.payload.id, response }));
  });
  const stopReplacement = await listen<{ id: string; text: string }>('input-translation-request', event => {
    void (async () => {
      try {
        const settings = await SettingsManager.getSettings();
        if (!settings.translationActive || !settings.inputReplacementEnabled) throw new Error('Input Replacement Translation is disabled');
        const result = await TranslationCoordinator.translateDirectToPrimary(event.payload.text, settings);
        const phonetics = result.detectedLang.startsWith('zh') ? PhoneticEngine.getPinyin(event.payload.text) : result.detectedLang === 'en' ? await PhoneticEngine.getEnglishIPA(event.payload.text) : '';
        const data = { detectedLang: result.detectedLang, sourcePhonetics: phonetics, translations: [{ lang: settings.primaryTargetLang, text: result.translation, phonetics: '' }] };
        await invoke('complete_input_replacement', { id: event.payload.id, data, error: null });
      } catch (error) { await invoke('complete_input_replacement', { id: event.payload.id, data: null, error: error instanceof Error ? error.message : String(error) }); }
    })();
  });
  await invoke('desktop_service_ready');
  restoreDesktopHost();
  return () => { unlisten(); stopReplacement(); stopDesktopHostTimers(); };
}
