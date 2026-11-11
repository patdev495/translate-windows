import * as ort from 'onnxruntime-web';
import { assembleOcrLayoutText } from './ocr-layout';
import { normalizeLatinOcrText } from './ocr-postprocess';

export type OcrProgressStage = 'downloading' | 'loading' | 'recognizing';

export interface OcrProgress {
  stage: OcrProgressStage;
  message: string;
}

export interface OcrTextBlock {
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
}

export interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

type ProgressHandler = (progress: OcrProgress) => void;

type ModelUrls = {
  detection: string;
  recognition: string;
  charactersDictionary: string;
};

type PaddleOcrServiceCtor = new (options?: unknown) => {
  initialize(): Promise<void>;
  recognize(image: HTMLCanvasElement, options?: { flatten?: false; strategy?: 'per-box' | 'per-line' | 'cross-line'; noCache?: boolean }): Promise<{ text: string }>;
  destroy?(): Promise<void>;
};

type OcrBox = { x: number; y: number; width: number; height: number };
type OcrTextResult = { text: string; box: OcrBox };

const MAX_VIET_OCR_SEGMENT_ASPECT_RATIO = 18;
const MIN_VIET_OCR_SEGMENT_WIDTH = 120;
const MIN_VERTICAL_GAP_WIDTH = 3;

const DB_NAME = 'polytranslate-ocr-cache';
const DB_VERSION = 1;
const STORE_NAME = 'model-files';

type OcrTier = 'tiny' | 'small' | 'medium';
type OcrLanguage = 'ch' | 'latin';
type OcrService = InstanceType<PaddleOcrServiceCtor>;

let activeServiceKey: string | null = null;
let activeServicePromise: Promise<OcrService> | null = null;
let activeServiceInstance: OcrService | null = null;
let activeLoadGeneration = 0;
let activeRecognitionCount = 0;
let deferredDestroyServices: OcrService[] = [];
let operationTail: Promise<void> = Promise.resolve();

function serializeOcr<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationTail.then(operation);
  operationTail = result.then(() => {}, () => {});
  return result;
}

export function getOcrWasmPaths(): { wasm: string } {
  return {
    wasm: '/onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm',
  };
}

function configureOcrRuntime(): void {
  ort.env.wasm.wasmPaths = getOcrWasmPaths();
}

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
  tier: OcrTier,
  language: OcrLanguage = 'ch',
  onProgress?: ProgressHandler
): Promise<InstanceType<PaddleOcrServiceCtor>> {
  configureOcrRuntime();

  const ocrModule = await import('ppu-paddle-ocr/web');
  const PaddleOcrService = ocrModule.PaddleOcrService as PaddleOcrServiceCtor;

  let modelPreset: ModelUrls;
  if (language === 'latin') {
    modelPreset = {
      detection: '/models/PP-OCRv5_latin_det.onnx',
      recognition: '/models/PP-OCRv5_latin_rec.onnx',
      charactersDictionary: '/models/ppocrv5_latin_dict.txt',
    };
  } else {
    if (tier === 'tiny') {
      modelPreset = {
        detection: '/models/PP-OCRv6_tiny_det.ort',
        recognition: '/models/PP-OCRv6_tiny_rec.ort',
        charactersDictionary: '/models/ppocrv6_tiny_dict.txt',
      };
    } else if (tier === 'medium') {
      modelPreset = {
        detection: '/models/PP-OCRv6_medium_det.ort',
        recognition: '/models/PP-OCRv6_medium_rec.ort',
        charactersDictionary: '/models/ppocrv6_dict.txt',
      };
    } else {
      modelPreset = {
        detection: '/models/PP-OCRv6_small_det.ort',
        recognition: '/models/PP-OCRv6_small_rec.ort',
        charactersDictionary: '/models/ppocrv6_dict.txt',
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
  try {
    await service.initialize();
  } catch (err) {
    await destroyService(service);
    throw err;
  }
  return service;
}

async function destroyService(service: OcrService): Promise<void> {
  try {
    await service.destroy?.();
  } catch (err) {
    console.warn('Failed to destroy OCR service:', err);
  }
}

function ocrModelKey(tier: OcrTier, language: OcrLanguage): string {
  return `${tier}-${language}`;
}

export function getActiveOcrModelKey(): string | null {
  return activeServiceKey;
}

export function unloadOcrModel(): Promise<void> {
  return serializeOcr(unloadModel);
}

async function unloadModel(): Promise<void> {
  activeLoadGeneration += 1;
  activeServiceKey = null;
  activeServicePromise = null;

  if (activeRecognitionCount > 0) {
    if (activeServiceInstance) {
      deferredDestroyServices.push(activeServiceInstance);
      activeServiceInstance = null;
    }
    return;
  }

  const service = activeServiceInstance;
  activeServiceInstance = null;
  if (service) {
    await destroyService(service);
  }
  const sessions = vietOcrSessions;
  vietOcrSessions = null;
  if (sessions) {
    await Promise.all([sessions.cnn.release(), sessions.encoder.release(), sessions.decoder.release()]);
  }
}

export function preloadOcrModel(
  tier: OcrTier,
  language: OcrLanguage = 'ch',
  onProgress?: ProgressHandler
): Promise<OcrService> {
  return serializeOcr(() => prepareOcrModel(tier, language, onProgress));
}

async function prepareOcrModel(
  tier: OcrTier,
  language: OcrLanguage = 'ch',
  onProgress?: ProgressHandler
): Promise<OcrService> {
  const key = ocrModelKey(tier, language);
  if (activeServiceKey === key && activeServicePromise) {
    return activeServicePromise;
  }

  await unloadModel();

  const generation = activeLoadGeneration;
  activeServiceKey = key;
  activeServicePromise = createService(tier, 'ch', onProgress)
    .then(async (service) => {
      if (language === 'latin') {
        try {
          await getVietOcrSessions(onProgress);
        } catch (err) {
          await destroyService(service);
          throw err;
        }
      }
      if (generation !== activeLoadGeneration || activeServiceKey !== key) {
        await destroyService(service);
        throw new Error('OCR model load was superseded.');
      }
      activeServiceInstance = service;
      return service;
    })
    .catch((err) => {
      if (generation === activeLoadGeneration && activeServiceKey === key) {
        activeServiceKey = null;
        activeServicePromise = null;
        activeServiceInstance = null;
      }
      throw err;
    });

  return activeServicePromise;
}

async function getService(
  tier: OcrTier,
  language: OcrLanguage = 'ch',
  onProgress?: ProgressHandler
): Promise<OcrService> {
  return prepareOcrModel(tier, language, onProgress);
}

async function withRecognition<T>(run: (service: OcrService) => Promise<T>, service: OcrService): Promise<T> {
  activeRecognitionCount += 1;
  try {
    return await run(service);
  } finally {
    activeRecognitionCount -= 1;
    if (activeRecognitionCount === 0 && deferredDestroyServices.length > 0) {
      const servicesToDestroy = deferredDestroyServices;
      deferredDestroyServices = [];
      await Promise.all(servicesToDestroy.map((serviceToDestroy) => destroyService(serviceToDestroy)));
    }
  }
}

// VietOCR support
let vietOcrSessions: {
  cnn: ort.InferenceSession;
  encoder: ort.InferenceSession;
  decoder: ort.InferenceSession;
  vocab: string[];
} | null = null;

async function getVietOcrSessions(onProgress?: ProgressHandler) {
  if (vietOcrSessions) return vietOcrSessions;

  configureOcrRuntime();

  const cnnUrl = '/models/vietocr_cnn.onnx';
  const encoderUrl = '/models/vietocr_encoder.onnx';
  const decoderUrl = '/models/vietocr_decoder.onnx';
  const dictUrl = '/models/vietocr_dict.txt';

  const [cnnBuf, encoderBuf, decoderBuf, dictBuf] = await Promise.all([
    loadModelFile(cnnUrl, 'VietOCR CNN', onProgress),
    loadModelFile(encoderUrl, 'VietOCR Encoder', onProgress),
    loadModelFile(decoderUrl, 'VietOCR Decoder', onProgress),
    loadModelFile(dictUrl, 'VietOCR Dictionary', onProgress),
  ]);

  onProgress?.({ stage: 'loading', message: 'Initializing VietOCR...' });

  const loaded = await Promise.allSettled([
    ort.InferenceSession.create(cnnBuf),
    ort.InferenceSession.create(encoderBuf),
    ort.InferenceSession.create(decoderBuf),
  ]);
  const failure = loaded.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') {
    await Promise.allSettled(loaded.flatMap((result) => result.status === 'fulfilled' ? [result.value.release()] : []));
    throw failure.reason;
  }
  const [cnn, encoder, decoder] = loaded.map((result) => (result as PromiseFulfilledResult<ort.InferenceSession>).value);

  const dictStr = new TextDecoder('utf-8').decode(dictBuf);
  const vocab = dictStr.split(/\r?\n/).filter(line => line.length > 0);

  vietOcrSessions = { cnn, encoder, decoder, vocab };
  return vietOcrSessions;
}

function cropCanvas(source: HTMLCanvasElement, box: { x: number; y: number; width: number; height: number }): HTMLCanvasElement {
  const crop = document.createElement('canvas');
  crop.width = box.width;
  crop.height = box.height;
  const ctx = crop.getContext('2d');
  if (ctx) {
    ctx.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  }
  return crop;
}

function findVerticalWhitespaceSplit(canvas: HTMLCanvasElement): number | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const columnInkCounts: number[] = [];

  for (let x = 0; x < canvas.width; x++) {
    let inkCount = 0;
    for (let y = 0; y < canvas.height; y++) {
      const offset = (y * canvas.width + x) * 4;
      const r = imageData.data[offset];
      const g = imageData.data[offset + 1];
      const b = imageData.data[offset + 2];
      const a = imageData.data[offset + 3];
      if (a > 30 && r + g + b < 650) {
        inkCount++;
      }
    }
    columnInkCounts.push(inkCount);
  }

  const target = canvas.width / 2;
  let bestSplit: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let gapStart: number | null = null;

  for (let x = 0; x <= columnInkCounts.length; x++) {
    const isWhitespace = x < columnInkCounts.length && columnInkCounts[x] <= 1;
    if (isWhitespace && gapStart === null) {
      gapStart = x;
      continue;
    }

    if (!isWhitespace && gapStart !== null) {
      const gapEnd = x - 1;
      const gapWidth = gapEnd - gapStart + 1;
      const split = Math.floor((gapStart + gapEnd) / 2);
      const leftWidth = split;
      const rightWidth = canvas.width - split;

      if (
        gapWidth >= MIN_VERTICAL_GAP_WIDTH &&
        leftWidth >= MIN_VIET_OCR_SEGMENT_WIDTH &&
        rightWidth >= MIN_VIET_OCR_SEGMENT_WIDTH
      ) {
        const distance = Math.abs(split - target);
        if (distance < bestDistance) {
          bestSplit = split;
          bestDistance = distance;
        }
      }

      gapStart = null;
    }
  }

  return bestSplit;
}

function splitWideTextCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement[] {
  if (canvas.width / Math.max(1, canvas.height) <= MAX_VIET_OCR_SEGMENT_ASPECT_RATIO) {
    return [canvas];
  }

  const split = findVerticalWhitespaceSplit(canvas);
  if (!split) {
    return [canvas];
  }

  const left = cropCanvas(canvas, { x: 0, y: 0, width: split, height: canvas.height });
  const right = cropCanvas(canvas, { x: split, y: 0, width: canvas.width - split, height: canvas.height });
  return [...splitWideTextCanvas(left), ...splitWideTextCanvas(right)];
}

function hasRepetitiveSuffix(text: string): boolean {
  const words = text.trim().split(/\s+/);
  if (words.length < 3) return false;
  const n = words.length;

  if (words[n - 1] === words[n - 2] && words[n - 2] === words[n - 3]) {
    return true;
  }

  if (n >= 6) {
    if (words[n - 1] === words[n - 3] && words[n - 2] === words[n - 4] &&
        words[n - 3] === words[n - 5] && words[n - 4] === words[n - 6]) {
      return true;
    }
  }

  return false;
}

async function runVietOcrInference(
  canvas: HTMLCanvasElement,
  sessions: NonNullable<typeof vietOcrSessions>
): Promise<string> {
  const { cnn, encoder, decoder, vocab } = sessions;

  let padColor = '#FFFFFF';
  try {
    const cropCtx = canvas.getContext('2d');
    if (cropCtx) {
      const sampleX = Math.max(0, canvas.width - 2);
      const sampleY = Math.min(canvas.height - 1, 2);
      const pixel = cropCtx.getImageData(sampleX, sampleY, 1, 1).data;
      if (pixel[3] >= 50) {
        padColor = `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
      }
    }
  } catch (e) {
    console.warn('Failed to sample background color, using white:', e);
  }

  let scale = 32 / canvas.height;
  let newWidth = Math.round(canvas.width * scale);

  newWidth = Math.round(newWidth / 20) * 20;
  newWidth = Math.max(40, Math.min(1600, newWidth));

  const resizedCanvas = document.createElement('canvas');
  resizedCanvas.width = newWidth;
  resizedCanvas.height = 32;
  const ctx = resizedCanvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context for crop resize');

  ctx.fillStyle = padColor;
  ctx.fillRect(0, 0, newWidth, 32);

  ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, newWidth, 32);

  const imgData = ctx.getImageData(0, 0, newWidth, 32);
  const pix = imgData.data;

  const floatData = new Float32Array(1 * 3 * 32 * newWidth);
  const rOffset = 0;
  const gOffset = 32 * newWidth;
  const bOffset = 2 * 32 * newWidth;

  for (let i = 0; i < 32 * newWidth; i++) {
    const r = pix[i * 4];
    const g = pix[i * 4 + 1];
    const b = pix[i * 4 + 2];
    floatData[rOffset + i] = r / 255.0;
    floatData[gOffset + i] = g / 255.0;
    floatData[bOffset + i] = b / 255.0;
  }

  const imgTensor = new ort.Tensor('float32', floatData, [1, 3, 32, newWidth]);
  const cnnFeeds = { img: imgTensor };
  const cnnResults = await cnn.run(cnnFeeds);
  const srcTensor = cnnResults.output;

  const encoderFeeds = { src: srcTensor };
  const encoderResults = await encoder.run(encoderFeeds);
  const encoderOutputs = encoderResults.encoder_outputs;
  let hidden = encoderResults.hidden;

  const maxSeqLength = 128;
  const sosToken = 1;
  const eosToken = 2;

  let translatedSentence: number[] = [sosToken];
  let maxLength = 0;

  while (maxLength <= maxSeqLength) {
    const tgtVal = BigInt64Array.from([BigInt(translatedSentence[translatedSentence.length - 1])]);
    const tgtTensor = new ort.Tensor('int64', tgtVal, [1]);

    const decoderFeeds = {
      tgt: tgtTensor,
      hidden: hidden,
      encoder_outputs: encoderOutputs,
    };

    const decoderResults = await decoder.run(decoderFeeds);
    const outputTensor = decoderResults.output;
    hidden = decoderResults.hidden_out;

    const outputData = outputTensor.data as Float32Array;

    let maxIdx = 0;
    let maxVal = outputData[0];
    for (let j = 1; j < outputData.length; j++) {
      if (outputData[j] > maxVal) {
        maxVal = outputData[j];
        maxIdx = j;
      }
    }

    if (maxIdx === eosToken) {
      break;
    }

    translatedSentence.push(maxIdx);
    maxLength++;

    let currentText = '';
    for (let i = 1; i < translatedSentence.length; i++) {
      const idx = translatedSentence[i];
      if (idx === eosToken) break;
      if (idx < 4) continue;
      const char = vocab[idx - 4];
      if (char) currentText += char;
    }
    if (hasRepetitiveSuffix(currentText)) {
      break;
    }
  }

  let decodedText = '';
  for (let i = 1; i < translatedSentence.length; i++) {
    const idx = translatedSentence[i];
    if (idx === eosToken) break;
    if (idx < 4) continue;
    const char = vocab[idx - 4];
    if (char) {
      decodedText += char;
    }
  }

  return decodedText.trim();
}

async function recognizeWithVietOcr(
  canvas: HTMLCanvasElement,
  tier: 'tiny' | 'small' | 'medium',
  onProgress?: ProgressHandler
): Promise<{ fullText: string; blocks: OcrTextBlock[] }> {
  const service = await getService(tier, 'latin', onProgress);
  const sessions = await getVietOcrSessions(onProgress);

  onProgress?.({ stage: 'recognizing', message: 'Detecting text boxes...' });
  const boxes = await (service as any).detector.run(canvas) as OcrBox[];

  if (boxes.length === 0) {
    return { fullText: '', blocks: [] };
  }

  onProgress?.({ stage: 'recognizing', message: 'Reading text with VietOCR...' });

  const results: OcrTextResult[] = [];
  const blocks: OcrTextBlock[] = [];

  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];

    const verticalPadding = Math.max(6, Math.round(box.height * 0.3));
    const horizontalPadding = Math.max(4, Math.round(box.width * 0.01));
    const x = Math.max(0, box.x - horizontalPadding);
    const y = Math.max(0, box.y - verticalPadding);
    const expandedBox = {
      x,
      y,
      width: Math.min(canvas.width - x, box.width + horizontalPadding * 2),
      height: Math.min(canvas.height - y, box.height + verticalPadding * 2)
    };

    const crop = cropCanvas(canvas, expandedBox);
    try {
      const textParts: string[] = [];
      for (const segment of splitWideTextCanvas(crop)) {
        const segmentText = await runVietOcrInference(segment, sessions);
        if (segmentText) {
          textParts.push(segmentText);
        }
      }
      const text = textParts.join(' ');
      results.push({ text, box });
      if (text.trim()) {
        blocks.push({
          text: text.trim(),
          bbox: { x: box.x, y: box.y, width: box.width, height: box.height }
        });
      }
    } catch (err) {
      console.error(`VietOCR failed to recognize box ${i}:`, err);
      results.push({ text: '', box });
    }
  }

  const fullText = assembleOcrLayoutText(results);
  const normalizedText = normalizeLatinOcrText(fullText).trim();

  return { fullText: normalizedText, blocks };
}

export async function recognizeImageRegion(
  canvas: HTMLCanvasElement,
  tier: 'tiny' | 'small' | 'medium' = 'small',
  language: 'ch' | 'latin' = 'ch',
  onProgress?: ProgressHandler
): Promise<string> {
  const result = await recognizeWithBlocks(canvas, tier, language, onProgress);
  return result.fullText;
}

/**
 * Recognizes text in a canvas image and returns both the full combined text
 * string and individual text blocks with bounding box coordinates.
 *
 * Bounding box coordinates are in canvas-space pixels relative to the
 * top-left of the cropped canvas.
 */
export async function recognizeWithBlocks(
  canvas: HTMLCanvasElement,
  tier: 'tiny' | 'small' | 'medium' = 'small',
  language: 'ch' | 'latin' = 'ch',
  onProgress?: ProgressHandler
): Promise<{ fullText: string; blocks: OcrTextBlock[] }> {
  return serializeOcr(() => recognizeBlocks(canvas, tier, language, onProgress));
}

async function recognizeBlocks(
  canvas: HTMLCanvasElement,
  tier: OcrTier,
  language: OcrLanguage,
  onProgress?: ProgressHandler
): Promise<{ fullText: string; blocks: OcrTextBlock[] }> {
  if (language === 'latin') {
    return recognizeWithVietOcr(canvas, tier, onProgress);
  }

  const service = await getService(tier, language, onProgress);
  onProgress?.({ stage: 'recognizing', message: 'Reading text from image...' });

  const result = await withRecognition(
    // The library's sampled image hash collides for similar screen crops.
    // Reuse the model, but always recognize the current image.
    (ocrService) => ocrService.recognize(canvas, { flatten: false, strategy: 'per-line', noCache: true }) as Promise<any>,
    service
  );

  const fullText = (result.text ?? '').trim();

  const rawRegions: unknown[] = result.regions ?? result.blocks ?? result.boxes ?? result.lines?.flat() ?? [];
  const blocks: OcrTextBlock[] = rawRegions.map((r: any) => {
    const text: string = typeof r.text === 'string' ? r.text.trim() : '';
    let x = 0, y = 0, width = 0, height = 0;
    if (Array.isArray(r.box) && r.box.length === 4) {
      const xs = r.box.map((pt: number[]) => pt[0]);
      const ys = r.box.map((pt: number[]) => pt[1]);
      x = Math.min(...xs);
      y = Math.min(...ys);
      width = Math.max(...xs) - x;
      height = Math.max(...ys) - y;
    } else if (r.box && typeof r.box.x === 'number') {
      x = r.box.x; y = r.box.y; width = r.box.width; height = r.box.height;
    } else if (r.bbox && typeof r.bbox.x === 'number') {
      x = r.bbox.x; y = r.bbox.y; width = r.bbox.width; height = r.bbox.height;
    } else if (typeof r.x === 'number') {
      x = r.x; y = r.y; width = r.width; height = r.height;
    }
    return { text, bbox: { x, y, width, height } };
  }).filter(b => b.text.length > 0);

  return { fullText, blocks };
}

export async function recognizeScreenRegion(
  canvas: HTMLCanvasElement,
  region: ScreenRegion,
  tier: 'tiny' | 'small' | 'medium' = 'small',
  language: 'ch' | 'latin' = 'ch',
  onProgress?: ProgressHandler
): Promise<{ fullText: string; blocks: OcrTextBlock[] }> {
  const result = await recognizeWithBlocks(canvas, tier, language, onProgress);
  return {
    fullText: result.fullText,
    blocks: result.blocks.map((block) => ({
      text: block.text,
      bbox: {
        x: block.bbox.x + region.x,
        y: block.bbox.y + region.y,
        width: block.bbox.width,
        height: block.bbox.height,
      },
    })),
  };
}

