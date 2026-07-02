import * as ort from 'onnxruntime-web';

export type OcrProgressStage = 'downloading' | 'loading' | 'recognizing';

export interface OcrProgress {
  stage: OcrProgressStage;
  message: string;
}

type ProgressHandler = (progress: OcrProgress) => void;

type ModelUrls = {
  detection: string;
  recognition: string;
  charactersDictionary: string;
};

type PaddleOcrServiceCtor = new (options?: unknown) => {
  initialize(): Promise<void>;
  recognize(image: HTMLCanvasElement, options?: { flatten?: false; strategy?: 'per-box' | 'per-line' | 'cross-line' }): Promise<{ text: string }>;
};

const DB_NAME = 'polytranslate-ocr-cache';
const DB_VERSION = 1;
const STORE_NAME = 'model-files';

const services = new Map<string, Promise<InstanceType<PaddleOcrServiceCtor>>>();

function openModelDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open OCR model cache.'));
  });
}

async function getCachedModelFile(key: string): Promise<ArrayBuffer | null> {
  const db = await openModelDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error ?? new Error(`Could not read cached OCR model file: ${key}`));
    tx.oncomplete = () => db.close();
  });
}

async function setCachedModelFile(key: string, value: ArrayBuffer): Promise<void> {
  const db = await openModelDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const request = tx.objectStore(STORE_NAME).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`Could not cache OCR model file: ${key}`));
    tx.oncomplete = () => db.close();
  });
}

async function loadModelFile(url: string, label: string, onProgress?: ProgressHandler): Promise<ArrayBuffer> {
  const cached = await getCachedModelFile(url);
  if (cached) return cached;

  onProgress?.({ stage: 'downloading', message: `Downloading OCR ${label}...` });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download OCR ${label}: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  await setCachedModelFile(url, buffer);
  return buffer;
}

async function loadCachedModel(urls: ModelUrls, onProgress?: ProgressHandler): Promise<ModelUrls | Record<keyof ModelUrls, ArrayBuffer>> {
  const [detection, recognition, charactersDictionary] = await Promise.all([
    loadModelFile(urls.detection, 'detector', onProgress),
    loadModelFile(urls.recognition, 'recognizer', onProgress),
    loadModelFile(urls.charactersDictionary, 'dictionary', onProgress),
  ]);

  return { detection, recognition, charactersDictionary };
}

async function createService(
  tier: 'tiny' | 'small' | 'medium',
  language: 'ch' | 'latin' = 'ch',
  onProgress?: ProgressHandler
): Promise<InstanceType<PaddleOcrServiceCtor>> {
  ort.env.wasm.wasmPaths = chrome.runtime.getURL('onnxruntime-web/');

  const ocrModule = await import('ppu-paddle-ocr/web');
  const PaddleOcrService = ocrModule.PaddleOcrService as PaddleOcrServiceCtor;

  let modelPreset: ModelUrls;
  if (language === 'latin') {
    modelPreset = {
      detection: chrome.runtime.getURL('models/PP-OCRv5_latin_det.onnx'),
      recognition: chrome.runtime.getURL('models/PP-OCRv5_latin_rec.onnx'),
      charactersDictionary: chrome.runtime.getURL('models/ppocrv5_latin_dict.txt'),
    };
  } else {
    if (tier === 'tiny') {
      modelPreset = {
        detection: chrome.runtime.getURL('models/PP-OCRv6_tiny_det.ort'),
        recognition: chrome.runtime.getURL('models/PP-OCRv6_tiny_rec.ort'),
        charactersDictionary: chrome.runtime.getURL('models/ppocrv6_tiny_dict.txt'),
      };
    } else if (tier === 'medium') {
      modelPreset = {
        detection: chrome.runtime.getURL('models/PP-OCRv6_medium_det.ort'),
        recognition: chrome.runtime.getURL('models/PP-OCRv6_medium_rec.ort'),
        charactersDictionary: chrome.runtime.getURL('models/ppocrv6_dict.txt'),
      };
    } else {
      modelPreset = {
        detection: chrome.runtime.getURL('models/PP-OCRv6_small_det.ort'),
        recognition: chrome.runtime.getURL('models/PP-OCRv6_small_rec.ort'),
        charactersDictionary: chrome.runtime.getURL('models/ppocrv6_dict.txt'),
      };
    }
  }

  const model = await loadCachedModel(modelPreset, onProgress);
  onProgress?.({ stage: 'loading', message: 'Loading OCR model...' });

  const service = new PaddleOcrService({
    model,
    recognition: { strategy: 'per-line' },
    debugging: { verbose: false, debug: false },
  });
  await service.initialize();
  return service;
}

async function getService(
  tier: 'tiny' | 'small' | 'medium',
  language: 'ch' | 'latin' = 'ch',
  onProgress?: ProgressHandler
): Promise<InstanceType<PaddleOcrServiceCtor>> {
  const key = `${tier}-${language}`;
  let servicePromise = services.get(key);
  if (!servicePromise) {
    servicePromise = createService(tier, language, onProgress).catch((err) => {
      services.delete(key);
      throw err;
    });
    services.set(key, servicePromise);
  }
  return servicePromise;
}

export async function recognizeImageRegion(
  canvas: HTMLCanvasElement,
  tier: 'tiny' | 'small' | 'medium' = 'small',
  language: 'ch' | 'latin' = 'ch',
  onProgress?: ProgressHandler
): Promise<string> {
  const service = await getService(tier, language, onProgress);
  onProgress?.({ stage: 'recognizing', message: 'Reading text from image...' });
  const result = await service.recognize(canvas, { flatten: false, strategy: 'per-line' });
  return result.text.trim();
}
