import { invoke } from '@tauri-apps/api/core';

/** Native transport for the configured learning server; preserves HTTP vs offline errors. */
export async function desktopFetch(url: string, options: RequestInit = {}): Promise<Response> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return fetch(url, options);
  if (options.signal?.aborted) throw options.signal.reason;
  let response: { status: number; body: string };
  try {
    response = await invoke('desktop_http', { url, method: options.method ?? 'GET', headers: Object.fromEntries(new Headers(options.headers).entries()), body: typeof options.body === 'string' ? options.body : null });
  } catch (error) { throw new TypeError(String(error)); }
  return new Response(response.status === 204 ? null : response.body, { status: response.status });
}
