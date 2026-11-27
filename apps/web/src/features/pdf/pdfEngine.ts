import { GlobalWorkerOptions, TextLayer, getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import jbig2Url from 'pdfjs-dist/wasm/jbig2.wasm?url';
import openjpegUrl from 'pdfjs-dist/wasm/openjpeg.wasm?url';
import { pageTextFromItems } from '@life/shared';
import { appBinaryDataFactory } from './pdfBinaryData';

// PDFs da aula (2026-11-26): every PDF.js call lives here, so the rest of the app (and the tests, which replace this
// module) never touch the library. Loaded only through loadPdfEngine (a dynamic import): the main bundle and the
// flashcard path never pay for PDF.js. The worker file and the two wasm decoders are precached by the service worker
// (vite.config.ts), so the reader opens offline, scans included. The legacy build (same package): the modern one calls
// Map.prototype.getOrInsertComputed and other APIs that Safari has only since iOS 26.2; the legacy one brings
// polyfills and needs iOS/Safari 17.4 (Promise.withResolvers). Security: text from a PDF only reaches the page through
// PDF.js's text layer (text nodes, no HTML); no annotation layer (links inside PDFs are not followed); XFA forms off;
// no scripting (its quickjs engine is never served).

GlobalWorkerOptions.workerSrc = workerUrl;

/** jbig2.wasm decodes CCITT fax and JBIG2 (B/W scans); openjpeg.wasm decodes JPEG 2000. Hashed, precached files. */
const BinaryDataFactory = appBinaryDataFactory({ 'jbig2.wasm': jbig2Url, 'openjpeg.wasm': openjpegUrl });

/** The file is protected by a password (not supported). */
export class PdfPasswordError extends Error {}
/** PDF.js could not read the file. */
export class PdfReadError extends Error {}

/** Canvas pixels per page at most (iOS Safari refuses canvases much above 16 million pixels). */
const MAX_CANVAS_PIXELS = 12_000_000;

export interface RenderTarget {
  canvas: HTMLCanvasElement;
  /** Receives the selectable text of the page (PDF.js text layer). */
  textLayer: HTMLElement;
  /** The page's width on screen, in CSS pixels. */
  cssWidth: number;
}

export interface RenderJob {
  /** Resolves with the page's size on screen once drawn; rejects when cancelled. */
  promise: Promise<{ width: number; height: number }>;
  cancel(): void;
}

export interface PdfDoc {
  readonly pages: number;
  /** The size of page `n` (1-based) at scale 1, in CSS pixels. */
  pageSize(n: number): Promise<{ width: number; height: number }>;
  renderPage(n: number, target: RenderTarget): RenderJob;
  destroy(): Promise<void>;
}

const options = (data: Uint8Array) => ({
  data,
  enableXfa: false,
  disableWorkerRendering: true,
  stopAtErrors: false,
  BinaryDataFactory,
});

/** PDF.js transfers `data`'s buffer to its worker (the caller's view is left empty): pass a copy to keep it usable. */
async function load(data: Uint8Array): Promise<PDFDocumentProxy> {
  try {
    return await getDocument(options(data)).promise;
  } catch (e) {
    if ((e as { name?: string } | null)?.name === 'PasswordException') throw new PdfPasswordError('password');
    throw new PdfReadError(e instanceof Error ? e.message : 'unreadable');
  }
}

/**
 * Counts the pages and extracts the text of each one (in order, one page at a time so a 300-page book stays light).
 * `onPage` reports progress ("Lendo o PDF… 34 de 300").
 */
export async function extractPdf(data: Uint8Array, onPage?: (done: number, total: number) => void): Promise<{ pages: number; texts: string[] }> {
  // A copy: "Adicionar PDF" stores these same bytes afterwards.
  const doc = await load(data.slice());
  try {
    const texts: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      texts.push(pageTextFromItems(content.items as { str?: unknown; hasEOL?: unknown }[]));
      page.cleanup();
      onPage?.(n, doc.numPages);
    }
    return { pages: doc.numPages, texts };
  } catch (e) {
    if (e instanceof PdfPasswordError || e instanceof PdfReadError) throw e;
    throw new PdfReadError(e instanceof Error ? e.message : 'unreadable');
  } finally {
    await doc.loadingTask.destroy();
  }
}

/**
 * Opens a PDF for the reader. Its buffer goes to PDF.js as is (no 50 MB copy on the iPhone): the caller hands over bytes
 * it does not use afterwards (a fresh read from IndexedDB).
 */
export async function openPdf(data: Uint8Array): Promise<PdfDoc> {
  const doc = await load(data);
  return {
    pages: doc.numPages,
    async pageSize(n) {
      const v = (await doc.getPage(n)).getViewport({ scale: 1 });
      return { width: v.width, height: v.height };
    },
    renderPage(n, { canvas, textLayer, cssWidth }) {
      let cancelled = false;
      let cancelTask: (() => void) | undefined;
      const promise = (async () => {
        const page = await doc.getPage(n);
        if (cancelled) throw new Error('cancelled');
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: cssWidth / base.width });
        const ratio = Math.max(0.5, Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height))));
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const task = page.render({ canvas, viewport, ...(ratio !== 1 ? { transform: [ratio, 0, 0, ratio, 0, 0] } : {}) });
        cancelTask = () => task.cancel();
        await task.promise;
        if (cancelled) throw new Error('cancelled');
        // The text layer's sizes come from these variables (pdf_viewer.css sets them on its page element).
        textLayer.replaceChildren();
        textLayer.style.setProperty('--scale-factor', String(viewport.scale));
        textLayer.style.setProperty('--user-unit', String(viewport.userUnit || 1));
        textLayer.style.setProperty('--total-scale-factor', 'calc(var(--scale-factor) * var(--user-unit))');
        textLayer.style.setProperty('--scale-round-x', '1px');
        textLayer.style.setProperty('--scale-round-y', '1px');
        const layer = new TextLayer({ textContentSource: page.streamTextContent(), container: textLayer, viewport });
        cancelTask = () => layer.cancel();
        await layer.render();
        return { width: Math.floor(viewport.width), height: Math.floor(viewport.height) };
      })();
      return {
        promise,
        cancel() {
          cancelled = true;
          try { cancelTask?.(); } catch { /* already finished */ }
        },
      };
    },
    destroy: () => doc.loadingTask.destroy(),
  };
}
