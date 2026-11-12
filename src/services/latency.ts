import { invoke } from '@tauri-apps/api/core';

// Enabled only by the native diagnostic bootstrap. Never records request data.
export const latencyTraceId = (): string | undefined => (globalThis as any).__TRANSLATION_TRACE_ID__;

export function latencyEvent(stage: string, durationMs = 0, traceId = latencyTraceId()): void {
  if (!(globalThis as any).__TRANSLATION_DIAGNOSTICS__) return;
  void invoke('latency_event', { stage, durationMs, traceId });
}

export async function latencySpan<T>(stage: string, work: () => Promise<T>, traceId = latencyTraceId()): Promise<T> {
  if (!(globalThis as any).__TRANSLATION_DIAGNOSTICS__) return work();
  const start = performance.now();
  try { return await work(); }
  finally { latencyEvent(stage, performance.now() - start, traceId); }
}
