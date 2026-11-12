import { setDesktopTransportGeneration } from '../platform/http';
import { getDetectionTarget, getTranslationTargets } from './translation-plan';
import { sameTranslationSettings } from './translation-settings';
import { latencyEvent } from './latency';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { SettingsManager, type Settings } from './settings';
import { TranslationCoordinator } from './translation-coordinator';
import { TranslationEngine } from './translation';
import { PhoneticEngine } from './learning-phonetics';
import { desktopStorage } from '../platform/storage';
import { restoreDesktopHost, stopDesktopHostTimers } from '../platform/host-runtime';
import { getAccountLinkStatus, startAccountLink, unlinkAccount, listSyncItems, retryFailedItems, learningRequest, saveLearningItem, openLearningLibrary } from './learning-account';

let translationRevision = 0;
let hostGeneration = 0;

export async function handleDesktopRequest(message: Record<string, any>): Promise<Record<string, any>> {
  try {
    const generation = hostGeneration;
    const revision = translationRevision;
    const settings = await SettingsManager.getSettings();
    const translation = typeof message.type === 'string' && (message.type.startsWith('TRANSLATE') || message.type === 'LEARNING_SUGGEST_MEANING');
    if (translation && !settings.translationActive) throw new Error('Translation is disabled');
    const response = await dispatchDesktopRequest(message, { ...settings, latencyTraceId: message.traceId });
    if (translation) {
      const current = await SettingsManager.getSettings();
      if (generation !== hostGeneration) throw new Error('Desktop host restarted. Please try again.');
      if (revision !== translationRevision || !sameTranslationSettings(settings, current)) {
        throw new Error('Translation settings changed. Please try again.');
      }
    }
    return response;
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
}

async function dispatchDesktopRequest(message: Record<string, any>, settings: Settings & { latencyTraceId?: string }): Promise<Record<string, any>> {
  try {
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
      case 'TRANSLATE': {
        latencyEvent('host-start', 0, message.traceId);
        return { success: true, data: await TranslationCoordinator.translate(String(message.text), settings) };
      }
      case 'TRANSLATE_OCR_BLOCK': {
        const text = String(message.text);
        const detectionTarget = getDetectionTarget(settings);
        const detection = detectionTarget ? await TranslationEngine.translateWithSettings(text, detectionTarget, settings) : { translation: text, detectedLang: 'auto' };
        const detectedLang = detection.detectedLang || 'auto';
        const target = getTranslationTargets(settings, detectedLang)[0];
        const translation = !target ? text : target.lang === detectionTarget ? detection.translation : (await TranslationEngine.translateWithSettings(text, target.lang, settings)).translation;
        return { success: true, data: { translation, detectedLang } };
      }
      case 'TRANSLATE_INPUT_REPLACEMENT': {
        if (!settings.inputReplacementEnabled) throw new Error('Input Replacement Translation is disabled');
        const text = String(message.text);
        const result = await TranslationCoordinator.translateDirectToPrimary(text, settings);
        const phonetics = result.detectedLang.startsWith('zh') ? PhoneticEngine.getPinyin(text) : result.detectedLang === 'en' ? await PhoneticEngine.getEnglishIPA(text, settings.latencyTraceId) : '';
        return { success: true, data: { detectedLang: result.detectedLang, sourcePhonetics: phonetics, translations: [{ lang: settings.primaryTargetLang, text: result.translation, phonetics: '' }] } };
      }
      case 'TRANSLATE_DIRECT_PRIMARY': return { success: true, data: await TranslationCoordinator.translateDirectToPrimary(String(message.text), settings) };
      case 'TRANSLATE_SELECTION': {
        if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 500 || !['vi','en','zh'].includes(message.targetLang)) throw new Error('Invalid selection translation');
        const result = await TranslationEngine.translateWithSettings(message.text, message.targetLang, settings);
        const phonetics = message.targetLang === 'zh' ? PhoneticEngine.getPinyin(result.translation) : message.targetLang === 'en' ? await PhoneticEngine.getEnglishIPA(result.translation, settings.latencyTraceId) : '';
        return { success: true, translation: result.translation, phonetics };
      }
      case 'LEARNING_SUGGEST_MEANING':
      case 'TRANSLATE_HANZI_MEANING': {
        const text = String(message.meaning ?? message.text ?? '').trim();
        if (!text) throw new Error('Chưa có nội dung để dịch');
        const key = `hanziMeaning:${text}`;
        const previous = message.type === 'TRANSLATE_HANZI_MEANING' ? await desktopStorage.get(key) : {};
        const meaning = previous[key] ?? (await TranslationEngine.translateWithSettings(text, 'vi', settings)).translation.trim();
        if (!meaning || meaning === text) throw new Error('Không tìm được nghĩa gợi ý. Hãy nhập nghĩa trước khi lưu.');
        if (message.type === 'TRANSLATE_HANZI_MEANING') await desktopStorage.set({ [key]: meaning });
        return { success: true, meaning };
      }
      default: throw new Error('Unsupported desktop request');
    }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
}

export async function startDesktopHost(): Promise<() => void> {
  const generation = ++hostGeneration;
  let observedSettings = await SettingsManager.getSettings();
  const stopSettings = await listen<Settings>('settings-changed', event => {
    if (!sameTranslationSettings(observedSettings, event.payload)) translationRevision++;
    observedSettings = event.payload;
  });
  const unlisten = await listen<{ id: string; message: Record<string, any> }>('desktop-request', event => {
    void handleDesktopRequest(event.payload.message).then(response => invoke('desktop_reply', { id: event.payload.id, response }));
  });
  const stopReplacement = await listen<{ id: string; text: string }>('input-translation-request', event => {
    void handleDesktopRequest({ type: 'TRANSLATE_INPUT_REPLACEMENT', text: event.payload.text }).then(response =>
      invoke('complete_input_replacement', { id: event.payload.id, data: response.success ? response.data : null, error: response.success ? null : response.error })
    ).catch(error => console.error('Failed to deliver Input Replacement result:', error));
  });
  setDesktopTransportGeneration(await invoke<string>('desktop_service_ready'));
  restoreDesktopHost();
  return () => { if (hostGeneration === generation) hostGeneration++; unlisten(); stopReplacement(); stopSettings(); stopDesktopHostTimers(); };
}
