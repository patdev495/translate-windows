import { listen } from '@tauri-apps/api/event';
import { preloadOcrModel, unloadOcrModel } from './ocr';
import { SettingsManager, type Settings } from './settings';

let currentSettings: Settings | null = null;
let lifecycleBound = false;
let transitionId = 0;
let unlistenSettings: (() => void) | null = null;
let appliedSettings: Settings | null = null;
let transitionTail: Promise<void> = Promise.resolve();

function shouldPreload(prev: Settings | null, next: Settings): boolean {
  if (!next.autoTranslate || !next.translationActive) return false;
  if (!prev) return true;
  return (
    !prev.autoTranslate || !prev.translationActive ||
    prev.ocrModelTier !== next.ocrModelTier ||
    prev.ocrLanguage !== next.ocrLanguage
  );
}

export function syncOcrModelForSettings(next: Settings): Promise<void> {
  currentSettings = next;
  const id = ++transitionId;
  transitionTail = transitionTail.then(async () => {
    if (id !== transitionId) return;
    if (!next.autoTranslate || !next.translationActive) {
      await unloadOcrModel();
    } else if (shouldPreload(appliedSettings, next)) {
      await preloadOcrModel(next.ocrModelTier, next.ocrLanguage);
    }
    appliedSettings = next;
  }).catch((error) => console.error('Failed to update OCR model:', error));
  return transitionTail;
}

export async function initializeOcrModelLifecycle(): Promise<void> {
  if (lifecycleBound) return;
  lifecycleBound = true;

  const initialTransition = transitionId;
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    unlistenSettings = await listen<Settings>('settings-changed', (event) => {
      void syncOcrModelForSettings(event.payload);
    });
  }
  const settings = await SettingsManager.getSettings();
  if (transitionId === initialTransition) await syncOcrModelForSettings(settings);
  else await transitionTail;
}

export function getOcrModelSettings(): Settings | null { return currentSettings; }

export async function disposeOcrModelLifecycle(): Promise<void> {
  unlistenSettings?.();
  unlistenSettings = null;
  lifecycleBound = false;
  transitionId += 1;
  currentSettings = null;
  await transitionTail;
  appliedSettings = null;
  await unloadOcrModel();
}
