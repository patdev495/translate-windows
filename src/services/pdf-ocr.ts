import { requestOcr } from './ocr-client';
import type { OcrTier, OcrLanguage, OcrProgress } from './ocr-contract';
export async function recognizeImageRegion(canvas: HTMLCanvasElement, tier: OcrTier, language: OcrLanguage, progress?: (value: OcrProgress) => void): Promise<string> {
  return (await requestOcr(canvas.toDataURL('image/png'),tier,language,progress)).fullText;
}
