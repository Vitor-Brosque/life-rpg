// The PDF.js module on demand (a separate chunk): the reader and "Adicionar PDF" wait for it; nothing else loads it.
export type PdfEngine = typeof import('./pdfEngine');

let loading: Promise<PdfEngine> | undefined;

export function loadPdfEngine(): Promise<PdfEngine> {
  loading ??= import('./pdfEngine').catch((e: unknown) => {
    loading = undefined; // a failed chunk load (offline before the precache) may be tried again
    throw e;
  });
  return loading;
}
