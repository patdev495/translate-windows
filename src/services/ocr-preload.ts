import { listen } from '@tauri-apps/api/event';
import { preloadOcrModel, unloadOcrModel } from './ocr';
import { SettingsManager, type Settings } from './settings';

let currentSettings: Settings | null = null;
let lifecycleBound = false;
let transitionId = 0;

function shouldPreload(prev: Settings | null, next: Settings): boolean {
  if (!next.autoTranslate) return false;
  if (!prev) return true;
  return (
    !prev.autoTranslate ||
    prev.ocrModelTier !== next.ocrModelTier ||
    prev.ocrLanguage !== next.ocrLanguage
  );
}

function shouldUnload(prev: Settings | null, next: Settings): boolean {
  return Boolean(prev?.autoTranslate && !next.autoTranslate);
}

export async function syncOcrModelForSettings(next: Settings): Promise<void> {
  const prev = currentSettings;
  currentSettings = next;
  const id = transitionId + 1;
  transitionId = id;

  if (shouldUnload(prev, next)) {
    await unloadOcrModel();
    return;
  }

  if (shouldPreload(prev, next)) {
    try {
      await preloadOcrModel(next.ocrModelTier, next.ocrLanguage);
      if (id !== transitionId || !currentSettings.autoTranslate) {
        await unloadOcrModel();
      }
    } catch (err) {
      if (id === transitionId && currentSettings.autoTranslate) {
        console.error('Failed to preload OCR model:', err);
      }
    }
  }
}

export async function initializeOcrModelLifecycle(): Promise<void> {
  if (lifecycleBound) return;
  lifecycleBound = true;

  const settings = await SettingsManager.getSettings();
  await syncOcrModelForSettings(settings);

  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
  void listen<Settings>('settings-changed', (event) => {
    void syncOcrModelForSettings(event.payload);
  });
}
