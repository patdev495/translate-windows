import type { TranslationResult } from './translation';
import { desktopRuntime } from '../platform/runtime';
import { latencySpan, latencyTraceId } from './latency';
import type { TranslationCoordinatorResult } from './translation-coordinator';

/** Translation work and English IPA belong to the persistent main host. */
export async function requestTranslation(text: string): Promise<TranslationCoordinatorResult> {
  const response = await latencySpan('host-rpc', () => desktopRuntime.runtime.sendMessage({
    type: 'TRANSLATE', text, traceId: latencyTraceId(),
  }));
  if (!response?.success || !response.data) throw new Error(response?.error || 'Desktop host did not return a translation.');
  return response.data;
}

export async function requestOcrBlockTranslation(text: string): Promise<TranslationResult> {
  const response = await desktopRuntime.runtime.sendMessage({ type: 'TRANSLATE_OCR_BLOCK', text, traceId: latencyTraceId() });
  if (!response?.success || !response.data) throw new Error(response?.error || 'Desktop host did not return a translation.');
  return response.data;
}
