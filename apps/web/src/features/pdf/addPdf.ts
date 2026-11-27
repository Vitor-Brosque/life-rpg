import type { ID, StudyFile } from '@life/shared';
import { PDF_MAX_BYTES, sniffMediaType, studyFileTitle } from '@life/shared';
import { STUDY_FILE_MESSAGES, StudyFileError, createStudyFile } from '../../domain/studyFileActions';
import { loadPdfEngine } from './loadPdfEngine';

// "Adicionar PDF" (spec 2026-11-26 §2.3, §4.1): the file is checked (signature, 50 MB), PDF.js counts the pages and
// extracts each page's text on this device, then the PDF and its text are kept and queued for the PC.

/** Reads a picked file: its bytes, page count and the text of each page. Problems throw StudyFileError (pt-BR). */
export async function readPdfFile(file: Blob, onPage?: (done: number, total: number) => void): Promise<{ bytes: Uint8Array; pages: number; texts: string[] }> {
  if (file.size === 0) throw new StudyFileError(STUDY_FILE_MESSAGES.empty);
  if (file.size > PDF_MAX_BYTES) throw new StudyFileError(STUDY_FILE_MESSAGES.tooBig);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (sniffMediaType(bytes) !== 'application/pdf') throw new StudyFileError(STUDY_FILE_MESSAGES.notPdf);
  const engine = await loadPdfEngine();
  try {
    const { pages, texts } = await engine.extractPdf(bytes, onPage);
    return { bytes, pages, texts };
  } catch (e) {
    if (e instanceof engine.PdfPasswordError) throw new StudyFileError(STUDY_FILE_MESSAGES.password);
    console.warn('pdf: could not read', e);
    throw new StudyFileError(STUDY_FILE_MESSAGES.unreadable);
  }
}

/** The whole "Adicionar PDF": read, keep, record. The title comes from the file name. */
export async function addPdf(file: File, journeyId?: ID, onPage?: (done: number, total: number) => void): Promise<StudyFile> {
  const read = await readPdfFile(file, onPage);
  return createStudyFile({ ...read, title: studyFileTitle(file.name), ...(journeyId ? { journeyId } : {}) });
}
