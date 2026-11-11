import type { PDFDocumentProxy } from 'pdfjs-dist';

export async function loadDesktopPdfLibrary() {
  const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined') pdf.GlobalWorkerOptions.workerSrc = new URL('/pdf.worker.min.mjs', window.location.href).href;
  return pdf;
}

export type DesktopPdfDocument = PDFDocumentProxy & { destroy(): Promise<void> };
export async function openDesktopPdf(source: string | Uint8Array, prompt?: (wrongPassword: boolean) => Promise<string | null>): Promise<DesktopPdfDocument> {
  const pdf = await loadDesktopPdfLibrary();
  const assets = typeof window !== 'undefined' ? new URL('/pdf-assets/',window.location.href).href : undefined;
  const task = pdf.getDocument({ ...(typeof source === 'string' ? { url: source } : { data: source }),
    cMapUrl: assets && `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: assets && `${assets}standard_fonts/`, wasmUrl: assets && `${assets}wasm/`,
  });
  if (prompt) task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
    void prompt(reason === 2).then(password => { if (password === null) void task.destroy(); else updatePassword(password); });
  };
  return Object.assign(await task.promise, { destroy: () => task.destroy() });
}
