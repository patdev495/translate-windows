import type { OcrProgress, OcrTextBlock } from './ocr';

export type { OcrProgress, OcrTextBlock } from './ocr';
export type OcrTier = 'tiny' | 'small' | 'medium';
export type OcrLanguage = 'ch' | 'latin';
export type OcrResult = { fullText: string; blocks: OcrTextBlock[] };
export type OcrProgressEvent = { requestId: string; progress: OcrProgress };
export type OcrJob = { jobId: string; generation: string; dataUrl: string; tier: OcrTier; language: OcrLanguage; allowDisabled?: boolean };
