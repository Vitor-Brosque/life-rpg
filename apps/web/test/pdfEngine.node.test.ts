// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';

// PDFs da aula (2026-11-26): pdfEngine against the real PDF.js (the legacy build the app ships), in Node; the other
// tests replace the engine with a fake. PDFs are written by hand (ASCII only, so string offsets are byte offsets).

/** A PDF of `objects` (numbered from 1) with a correct cross-reference table. */
function pdf(objects: string[], trailer = ''): Uint8Array {
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailer}>>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** One page with `text` in Helvetica. */
function textPage(text: string): string[] {
  const content = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  return [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
}

/** The same page behind the standard security handler with a user password (unknown here): PDF.js asks for it. */
const withPassword = pdf(
  [...textPage('segredo'), `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <${'ab'.repeat(32)}> /U <${'cd'.repeat(32)}> >>`],
  `/Encrypt 6 0 R /ID [<${'01'.repeat(16)}> <${'01'.repeat(16)}>] `,
);

type Engine = typeof import('../src/features/pdf/pdfEngine');
let engine: Engine;

beforeAll(async () => {
  // Node has no Worker: PDF.js runs its worker code in this thread when it finds it here (its "fake worker").
  const workerModule = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import(/* @vite-ignore */ workerModule);
  engine = await import('../src/features/pdf/pdfEngine');
});

describe('pdfEngine with the real PDF.js legacy build (M7)', () => {
  it('extracts the pages\' text and leaves the caller\'s bytes usable ("Adicionar PDF" stores them afterwards)', async () => {
    const bytes = pdf(textPage('Modelo relacional'));
    const size = bytes.byteLength;
    expect(await engine.extractPdf(bytes)).toEqual({ pages: 1, texts: ['Modelo relacional'] });
    expect(bytes.byteLength).toBe(size);
  });

  it('a PDF with a password is PdfPasswordError (PDF.js PasswordException), when adding and when opening', async () => {
    await expect(engine.extractPdf(withPassword)).rejects.toBeInstanceOf(engine.PdfPasswordError);
    await expect(engine.openPdf(withPassword.slice())).rejects.toBeInstanceOf(engine.PdfPasswordError);
  });

  it('a file PDF.js cannot read is PdfReadError', async () => {
    await expect(engine.extractPdf(new TextEncoder().encode('%PDF-1.4\nnada aqui'))).rejects.toBeInstanceOf(engine.PdfReadError);
  });

  it('the reader opens a PDF and knows its pages and size', async () => {
    const doc = await engine.openPdf(pdf(textPage('Chaves')));
    expect(doc.pages).toBe(1);
    expect(await doc.pageSize(1)).toEqual({ width: 612, height: 792 });
    await doc.destroy();
  });
});
