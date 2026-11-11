import { desktopRuntime as chrome } from '../platform/runtime';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openDesktopPdf, loadDesktopPdfLibrary } from '../services/pdf-document';
import {
  createTranslationContext,
  loadSettings,
  initTranslationListeners,
  performTranslation,
  translateSelectedPageText,
  matchesOcrShortcut,
} from '../content/translation-init';
import { recognizeImageRegion } from '../services/pdf-ocr';
import { addPinnedSnippet } from '../content/pinned-panel';

import { OcrSelectionOverlay } from '../content/ocr-selection-overlay';

// pdfjs-dist is loaded at runtime via chrome.runtime.getURL() to avoid
// bundling the entire library (~3MB) into the viewer chunk.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsLib: any;
let TextLayer: any;

// ─── PDF.js Worker ─────────────────────────────────────────────────────────

async function loadPdfjsLib() {
  pdfjsLib = await loadDesktopPdfLibrary();
  TextLayer = pdfjsLib.TextLayer;
}

// ─── DOM refs ──────────────────────────────────────────────────────────────

const $loading       = document.getElementById('loading-overlay')!;
const $loadingText   = document.getElementById('loading-text')!;
const $errorOverlay  = document.getElementById('error-overlay')!;
const $errorMsg      = document.getElementById('error-message')!;
const $btnFileAccess = document.getElementById('btn-enable-file-access') as HTMLButtonElement;
const $pwdOverlay    = document.getElementById('password-overlay')!;
const $pwdInput      = document.getElementById('password-input') as HTMLInputElement;
const $pwdError      = document.getElementById('password-error')!;
const $btnPwdSubmit  = document.getElementById('btn-password-submit')!;
const $btnPwdCancel  = document.getElementById('btn-password-cancel')!;
const $pagesContainer = document.getElementById('pages-container')!;
const $pdfTitle      = document.getElementById('pdf-title')!;
const $pageInput     = document.getElementById('page-input') as HTMLInputElement;
const $pageTotal     = document.getElementById('page-total')!;
const $zoomLevel     = document.getElementById('zoom-level')!;
const $btnPrev       = document.getElementById('btn-prev')!;
const $btnNext       = document.getElementById('btn-next')!;
const $btnOcrRegion  = document.getElementById('btn-ocr-region') as HTMLButtonElement;
const $btnZoomIn     = document.getElementById('btn-zoom-in')!;
const $btnZoomOut    = document.getElementById('btn-zoom-out')!;
const $btnZoomFit    = document.getElementById('btn-zoom-fit')!;
const $viewerContainer = document.getElementById('viewer-container')!;

// ─── State ─────────────────────────────────────────────────────────────────

let pdfDoc: any = null;
let numPages = 0;
let scale = 1.0;
let currentPage = 1;
const translationCtx = createTranslationContext();
let ocrSelectionMode = false;
let ocrBusy = false;
let ocrSelectionOverlay: OcrSelectionOverlay | null = null;

// Per-page render state: tracks running render tasks and rendered canvases
const pageRendered = new Map<number, boolean>();
const pageRenderTask = new Map<number, any>();

// ─── URL Parsing ───────────────────────────────────────────────────────────

function getPdfUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('file');
}

// ─── Show / hide helpers ───────────────────────────────────────────────────

function showLoading(msg = 'Loading PDF…') {
  $loadingText.textContent = msg;
  $loading.removeAttribute('hidden');
  $errorOverlay.setAttribute('hidden', '');
}

function hideLoading() {
  $loading.setAttribute('hidden', '');
}

function showError(msg: string, isFileAccess = false) {
  hideLoading();
  $errorMsg.textContent = msg;
  if (isFileAccess) {
    $btnFileAccess.removeAttribute('hidden');
  } else {
    $btnFileAccess.setAttribute('hidden', '');
  }
  $errorOverlay.removeAttribute('hidden');
}

// ─── Password dialog ───────────────────────────────────────────────────────

function promptPassword(wrongPassword: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    $pwdInput.value = '';
    $pwdError.hidden = !wrongPassword;
    $pwdOverlay.removeAttribute('hidden');
    $pwdInput.focus();

    const onSubmit = () => {
      const pw = $pwdInput.value;
      $pwdOverlay.setAttribute('hidden', '');
      cleanup();
      resolve(pw);
    };

    const onCancel = () => {
      $pwdOverlay.setAttribute('hidden', '');
      cleanup();
      resolve(null);
    };

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') onSubmit();
      if (e.key === 'Escape') onCancel();
    };

    function cleanup() {
      $btnPwdSubmit.removeEventListener('click', onSubmit);
      $btnPwdCancel.removeEventListener('click', onCancel);
      $pwdInput.removeEventListener('keydown', onKeydown);
    }

    $btnPwdSubmit.addEventListener('click', onSubmit);
    $btnPwdCancel.addEventListener('click', onCancel);
    $pwdInput.addEventListener('keydown', onKeydown);
  });
}

// ─── Load PDF ──────────────────────────────────────────────────────────────

let documentVersion = 0;
let fileName = "PDF";
async function loadPdf(url: string | Uint8Array): Promise<void> {
  const version=++documentVersion;
  const previous=pdfDoc; pdfDoc=null;
  for (const task of pageRenderTask.values()) task.cancel();
  pageRenderTask.clear();
  if (previous) await previous.destroy();
  showLoading('Loading PDF…');

  try {
    const opened = await openDesktopPdf(url,promptPassword);
    if (version !== documentVersion) { await opened.destroy(); return; }
    pdfDoc = opened;
    numPages = pdfDoc.numPages;

    // Update title
    const meta = await pdfDoc.getMetadata().catch(() => null);
    const title = (meta?.info as any)?.Title || fileName;
    document.title = `${title} — PolyTranslate`;
    $pdfTitle.textContent = title;
    $pageTotal.textContent = `/ ${numPages}`;
    $pageInput.max = String(numPages);

    hideLoading();
    buildPagePlaceholders();
    observePages();
    scrollToPage(1);
  } catch (err: any) {
    const msg = err?.message || String(err);

    // Local file access denied
    if (typeof url === 'string' && url.startsWith('file://') && msg.includes('Access')) {
      showError(
        'Chrome blocked access to local files. Enable "Allow access to file URLs" in the extension settings.',
        true
      );
      return;
    }

    showError(`Could not load PDF: ${msg}`);
  }
}

// ─── Page layout ───────────────────────────────────────────────────────────

function buildPagePlaceholders() {
  $pagesContainer.innerHTML = '';
  pageRendered.clear();

  for (let i = 1; i <= numPages; i++) {
    const wrapper = document.createElement('div');
    wrapper.className = 'page-wrapper';
    wrapper.id = `page-${i}`;
    // Placeholder height — will be updated on first render
    wrapper.style.width = '600px';
    wrapper.style.height = '800px';
    $pagesContainer.appendChild(wrapper);
  }
}

// ─── Lazy render via IntersectionObserver ──────────────────────────────────

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const pageNum = parseInt((entry.target as HTMLElement).id.replace('page-', ''), 10);
      if (entry.isIntersecting) {
        renderPage(pageNum);
      }
    }
  },
  { root: $viewerContainer, rootMargin: '200px 0px', threshold: 0 }
);

function observePages() {
  for (let i = 1; i <= numPages; i++) {
    const el = document.getElementById(`page-${i}`);
    if (el) observer.observe(el);
  }
}

// ─── Render a single page ──────────────────────────────────────────────────

async function renderPage(pageNum: number) {
  if (!pdfDoc) return;
  if (pageRendered.get(pageNum)) return;
  pageRendered.set(pageNum, true);

  const wrapper = document.getElementById(`page-${pageNum}`);
  if (!wrapper) return;

  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  // Resize placeholder
  wrapper.style.width = `${viewport.width}px`;
  wrapper.style.height = `${viewport.height}px`;
  wrapper.innerHTML = '';

  // Canvas
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  wrapper.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;
  const renderTask = page.render({ canvasContext: ctx, canvas, viewport });
  pageRenderTask.set(pageNum, renderTask);

  await renderTask.promise.catch(() => {/* cancelled */});

  // Text layer for selection
  const textContent = await page.getTextContent();
  const textLayerDiv = document.createElement('div');
  textLayerDiv.className = 'textLayer';
  wrapper.appendChild(textLayerDiv);

  const textLayer = new TextLayer({
    textContentSource: textContent,
    container: textLayerDiv,
    viewport,
  });
  await textLayer.render();
}

// ─── Re-render all pages on zoom ───────────────────────────────────────────

async function rerenderAll() {
  if (!pdfDoc) return;
  pageRendered.clear();
  pageRenderTask.forEach((t) => t.cancel());
  pageRenderTask.clear();

  for (let i = 1; i <= numPages; i++) {
    const wrapper = document.getElementById(`page-${i}`);
    if (wrapper) wrapper.innerHTML = '';
  }

  // Re-observe to trigger visible pages
  observer.disconnect();
  observePages();
}

// ─── Navigation helpers ────────────────────────────────────────────────────

function scrollToPage(pageNum: number) {
  const el = document.getElementById(`page-${pageNum}`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateCurrentPageFromScroll() {
  for (let i = 1; i <= numPages; i++) {
    const el = document.getElementById(`page-${i}`);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.top >= 0 || rect.bottom > 0) {
      currentPage = i;
      $pageInput.value = String(i);
      break;
    }
  }
}

// ─── Toolbar controls ──────────────────────────────────────────────────────

function setOcrSelectionMode(enabled: boolean) {
  ocrSelectionMode = enabled;
  translationCtx.tooltip.setPointerPassthrough(enabled);
  document.body.classList.toggle('ocr-selection-mode', enabled);
  $btnOcrRegion.classList.toggle('active', enabled);
  $btnOcrRegion.setAttribute('aria-pressed', String(enabled));
  $btnOcrRegion.title = enabled
    ? 'OCR region selection is active'
    : 'Select image region for OCR translation (Ctrl+Space)';

  if (enabled) {
    if (!ocrSelectionOverlay) {
      ocrSelectionOverlay = new OcrSelectionOverlay($viewerContainer, {
        isPdfMode: true,
        onSelectionComplete: async (rect, extra) => {
          if (!extra || !extra.canvas || !extra.wrapper) return;
          await translateOcrRegion(extra.wrapper, extra.canvas, new DOMRect(rect.left, rect.top, rect.width, rect.height));
        },
        onCancel: () => {
          setOcrSelectionMode(false);
        }
      });
    }
    ocrSelectionOverlay.start();
  } else {
    if (ocrSelectionOverlay) {
      ocrSelectionOverlay.stop();
    }
  }
}

function cropPageCanvas(pageCanvas: HTMLCanvasElement, wrapper: HTMLElement, rect: DOMRect): HTMLCanvasElement {
  const canvasRect = pageCanvas.getBoundingClientRect();
  const scaleX = pageCanvas.width / canvasRect.width;
  const scaleY = pageCanvas.height / canvasRect.height;
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = Math.max(1, Math.round(rect.width * scaleX));
  cropCanvas.height = Math.max(1, Math.round(rect.height * scaleY));

  const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true })!;
  const wrapperRect = wrapper.getBoundingClientRect();
  const sx = Math.round((wrapperRect.left + rect.left - canvasRect.left) * scaleX);
  const sy = Math.round((wrapperRect.top + rect.top - canvasRect.top) * scaleY);
  cropCtx.drawImage(pageCanvas, sx, sy, cropCanvas.width, cropCanvas.height, 0, 0, cropCanvas.width, cropCanvas.height);
  return cropCanvas;
}

async function translateOcrRegion(wrapper: HTMLElement, pageCanvas: HTMLCanvasElement, rect: DOMRect) {
  if (ocrBusy || rect.width < 8 || rect.height < 8) return;
  ocrBusy = true;

  ocrSelectionOverlay?.showProgress('Preparing OCR...', { left: rect.left, top: rect.top });

  try {
    const cropCanvas = cropPageCanvas(pageCanvas, wrapper, rect);
    const croppedDataUrl = (translationCtx.settings?.ocrPinImage || translationCtx.settings?.ocrCopyToClipboard)
      ? cropCanvas.toDataURL('image/png')
      : null;

    const tier = translationCtx.settings?.ocrModelTier ?? 'small';
    const lang = translationCtx.settings?.ocrLanguage ?? 'ch';
    const text = await recognizeImageRegion(cropCanvas, tier, lang, (state) => {
      ocrSelectionOverlay?.updateProgressText(state.message);
    });

    if (!text) {
      ocrSelectionOverlay?.updateProgressText('No text found in this region.');
      await new Promise((r) => setTimeout(r, 1800));
      ocrSelectionOverlay?.removeProgress();
      return;
    }

    const wrapperRect = wrapper.getBoundingClientRect();
    const x = wrapperRect.left + window.scrollX + rect.left + rect.width / 2;
    const y = wrapperRect.top + window.scrollY + rect.top;
    ocrSelectionOverlay?.removeProgress();
    performTranslation(translationCtx, text, x, y, rect.width);

    if (translationCtx.settings?.ocrPinImage && croppedDataUrl) {
      addPinnedSnippet(croppedDataUrl, rect.left, rect.top, rect.width, rect.height);
    }

    if (translationCtx.settings?.ocrCopyToClipboard && croppedDataUrl) {
      copyImageToClipboard(croppedDataUrl).catch((err) => {
        console.error('Failed to copy image to clipboard in PDF viewer:', err);
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OCR failed.';
    ocrSelectionOverlay?.updateProgressText(message);
    await new Promise((r) => setTimeout(r, 3000));
    ocrSelectionOverlay?.removeProgress();
  } finally {
    ocrBusy = false;
    setOcrSelectionMode(false);
  }
}

$btnPrev.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    $pageInput.value = String(currentPage);
    scrollToPage(currentPage);
  }
});

$btnNext.addEventListener('click', () => {
  if (currentPage < numPages) {
    currentPage++;
    $pageInput.value = String(currentPage);
    scrollToPage(currentPage);
  }
});

$pageInput.addEventListener('change', () => {
  const n = parseInt($pageInput.value, 10);
  if (n >= 1 && n <= numPages) {
    currentPage = n;
    scrollToPage(currentPage);
  }
});

$btnZoomIn.addEventListener('click', () => {
  scale = Math.min(scale + 0.2, 3.0);
  $zoomLevel.textContent = `${Math.round(scale * 100)}%`;
  rerenderAll();
});

$btnZoomOut.addEventListener('click', () => {
  scale = Math.max(scale - 0.2, 0.4);
  $zoomLevel.textContent = `${Math.round(scale * 100)}%`;
  rerenderAll();
});

$btnZoomFit.addEventListener('click', async () => {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const containerWidth = $viewerContainer.clientWidth - 48;
  scale = containerWidth / vp.width;
  $zoomLevel.textContent = `${Math.round(scale * 100)}%`;
  rerenderAll();
});

$btnOcrRegion.addEventListener('click', () => {
  if (ocrBusy) return;
  if (!translationCtx.active || !translationCtx.settings) return;
  setOcrSelectionMode(!ocrSelectionMode);
});

document.addEventListener('keydown', (event) => {
  if (!translationCtx.active || !translationCtx.settings) return;
  if (matchesOcrShortcut(translationCtx, event)) {
    event.preventDefault();
    if (!ocrBusy) setOcrSelectionMode(!ocrSelectionMode);
    return;
  }
});

$viewerContainer.addEventListener('scroll', updateCurrentPageFromScroll);

// ─── File access button ────────────────────────────────────────────────────

$btnFileAccess.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_EXTENSION_SETTINGS' });
});

// ─── Translation init ──────────────────────────────────────────────────────

loadSettings(translationCtx);


chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SETTINGS_UPDATED') {
    loadSettings(translationCtx);
  }
});

// Listen for storage changes to sync settings dynamically
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && (changes.settings || changes.active)) {
    loadSettings(translationCtx);
  }
});

initTranslationListeners(translationCtx, document);

// Open local files through the native picker; bytes never leave the device for PDF decoding.
async function openLocalPdf() {
  const selected = await invoke<{ name:string;data:string } | null>('pick_pdf_file');
  if (!selected) return;
  fileName=selected.name;
  await loadPdf(Uint8Array.from(atob(selected.data),character=>character.charCodeAt(0)));
}
document.getElementById('open-pdf-file')!.addEventListener('click',()=> { void openLocalPdf().catch(error=>showError(String(error))); });
void listen<{ action:string }>('desktop-shortcut',event=> {
  if (!translationCtx.active) return;
  if (event.payload.action==='tooltip') translateSelectedPageText(translationCtx);
  if (event.payload.action==='ocr' && !ocrBusy) setOcrSelectionMode(!ocrSelectionMode);
});
(async()=> {
  await loadPdfjsLib();
  await loadSettings(translationCtx);
  const url=getPdfUrl();
  if (url && /^https?:/.test(url)) { fileName=decodeURIComponent(url.split('/').pop()||'PDF'); await loadPdf(url); }
  else { hideLoading(); $pdfTitle.textContent='Mở PDF để bắt đầu'; await openLocalPdf(); }
})().catch(error=>showError(String(error)));
window.addEventListener('beforeunload',()=> { observer.disconnect(); if (pdfDoc) void pdfDoc.destroy(); });

async function copyImageToClipboard(dataUrl: string): Promise<void> {
  await invoke('copy_image_to_clipboard',{ dataUrl });
}
