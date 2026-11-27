import { useId, useState, type ChangeEvent } from 'react';
import { Link } from 'wouter';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ID, Journey, StudyFile } from '@life/shared';
import { pagesText } from '@life/shared';
import { db } from '../../db/db';
import {
  STUDY_FILE_MESSAGES, StudyFileError, deleteStudyFile, removeLocalCopy, restoreStudyFile, setStudyFileSubject,
} from '../../domain/studyFileActions';
import { fetchMediaNow, type FetchNowOutcome } from '../../sync/media';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { FAILURE_TOAST, safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { addPdf } from './addPdf';
import './pdf.css';

// PDFs da aula (spec 2026-11-26 §4.1): the rows of the subject's "PDFs" panel and of Estudo → Materiais, and
// "Adicionar PDF". Opening a list writes nothing.

export const PDF_TEXT = {
  here: 'Neste aparelho',
  download: 'Baixar para ler sem internet',
  remove: 'Tirar deste aparelho',
  reading: 'Lendo o PDF…',
  noSubject: 'Sem disciplina',
} as const;

export const DOWNLOAD_RESULT: Record<Exclude<FetchNowOutcome, 'stored'>, string> = {
  offline: 'Sem conexão com o PC. Abra com o PC ligado para baixar.',
  'no-sync': 'Este aparelho não está sincronizado com o PC. Conecte em Ajustes para baixar.',
  missing: 'O PC ainda não tem este PDF. Abra o app no aparelho onde ele foi adicionado, com o PC ligado.',
  failed: 'Não foi possível baixar o PDF. Tente de novo.',
};

/** "p. 34 de 120" when she has read some of it (lastPage from the PDF's progress record). */
export const progressText = (f: Pick<StudyFile, 'pages'>, lastPage: number | undefined): string | undefined =>
  lastPage !== undefined ? `p. ${Math.min(lastPage, f.pages)} de ${f.pages}` : undefined;

/** Which of these PDFs have their bytes on this device, and where she stopped in each one (by id). */
export function useLocalPdfs(files: readonly StudyFile[] | undefined): { local: Set<string>; lastPage: Map<string, number> } | undefined {
  const hashes = (files ?? []).map((f) => f.fileHash);
  const ids = (files ?? []).map((f) => f.id);
  return useLiveQuery(async () => {
    const [got, progress] = await Promise.all([db.mediaInfo.bulkGet(hashes), db.studyFileProgress.bulkGet(ids)]);
    const lastPage = new Map<string, number>();
    for (const p of progress) if (p && !p.deleted && p.lastPage !== undefined) lastPage.set(p.id, p.lastPage);
    return { local: new Set(got.filter((m) => m !== undefined).map((m) => m!.hash)), lastPage };
  }, [hashes.join(','), ids.join(',')]);
}

export interface StudyFileListProps {
  files: readonly StudyFile[];
  /** Where the reader's back link goes: the subject page (default) or Materiais. */
  from?: 'materiais';
  /** Materiais: a picker to move each PDF to a subject or to "Sem disciplina". */
  subjects?: readonly Journey[];
  /** The heading focused when a row disappears ("Apagar"). */
  headingId: string;
}

export function StudyFileList({ files, from, subjects, headingId }: StudyFileListProps) {
  const state = useLocalPdfs(files);
  if (state === undefined) return null;
  return (
    <ul className="pdflist">
      {files.map((f) => (
        <StudyFileRow key={f.id} file={f} local={state.local.has(f.fileHash)} lastPage={state.lastPage.get(f.id)} from={from}
          subjects={subjects} headingId={headingId} />
      ))}
    </ul>
  );
}

function StudyFileRow({ file, local, lastPage, from, subjects, headingId }: { file: StudyFile; local: boolean; lastPage: number | undefined } & Omit<StudyFileListProps, 'files'>) {
  const [downloading, setDownloading] = useState(false);
  const selectId = useId();
  const toast = useToast.getState();
  const progress = progressText(file, lastPage);
  const href = `/estudo/pdf/${file.id}${from === 'materiais' ? '?voltar=materiais' : ''}`;

  const download = () => {
    if (downloading) return;
    setDownloading(true);
    void fetchMediaNow(file.fileHash, file.bytes).then((r) => {
      setDownloading(false);
      toast.show(r === 'stored' ? 'PDF guardado neste aparelho.' : DOWNLOAD_RESULT[r]);
    });
  };
  // The PC is asked first (it must hold the file), which can take a moment.
  const [removing, setRemoving] = useState(false);
  const removeHere = () => {
    if (removing) return;
    setRemoving(true);
    removeLocalCopy(file).then(
      () => toast.show('PDF tirado deste aparelho. Ele continua no PC.'),
      (e: unknown) => {
        if (e instanceof StudyFileError) toast.show(e.message);
        else { console.error('pdf remove failed', e); toast.show(FAILURE_TOAST); }
      },
    ).finally(() => setRemoving(false));
  };
  const remove = (button: Element) => {
    safeRun(async () => {
      const gone = await deleteStudyFile(file.id);
      if (!gone) return;
      focusWhenGone(button, () => document.getElementById(headingId));
      toast.show('PDF apagado.', { label: 'Desfazer', run: () => safeRun(restoreStudyFile(file.id)) });
    });
  };
  const move = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    safeRun(setStudyFileSubject(file.id, value === '' ? undefined : value));
  };

  return (
    <li className="pdfrow">
      <div className="pdfrow__main">
        <strong className="pdfrow__title">{file.title}</strong>
        <span className="pdfrow__meta">
          {[pagesText(file.pages), progress, file.hasText ? undefined : 'sem texto (imagem escaneada)'].filter(Boolean).join(' · ')}
        </span>
        {local && <span className="pdfrow__here">{PDF_TEXT.here}</span>}
      </div>
      <div className="pdfrow__actions">
        <Link className="btn btn--primary btn--sm" href={href} aria-label={`Abrir ${file.title}`}>Abrir</Link>
        {local
          ? (
            <Button size="sm" variant="ghost" disabled={removing} aria-label={`${PDF_TEXT.remove}: ${file.title}`} onClick={removeHere}>
              {removing ? 'Conferindo com o PC…' : PDF_TEXT.remove}
            </Button>
          )
          : (
            <Button size="sm" variant="ghost" disabled={downloading} aria-label={`${PDF_TEXT.download}: ${file.title}`} onClick={download}>
              {downloading ? 'Baixando…' : PDF_TEXT.download}
            </Button>
          )}
        <Button size="sm" variant="ghost" aria-label={`Apagar ${file.title}`} onClick={(e) => remove(e.currentTarget)}>Apagar</Button>
      </div>
      {subjects && (
        <label className="field pdfrow__subject" htmlFor={selectId}>
          <span className="field__label">Disciplina</span>
          <select id={selectId} value={file.journeyId ?? ''} onChange={move} aria-label={`Disciplina de ${file.title}`}>
            <option value="">{PDF_TEXT.noSubject}</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>
      )}
    </li>
  );
}

/**
 * "Adicionar PDF": a file picker; while PDF.js counts the pages and extracts the text it shows "Lendo o PDF…". A file
 * that is not a PDF, passes 50 MB or has a password gets the reason. With `subjects`, the person picks the subject.
 */
export function AddPdf({ journeyId, subjects }: { journeyId?: ID; subjects?: readonly Journey[] }) {
  const inputId = useId();
  const pickId = useId();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [target, setTarget] = useState<string>('');
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // the same file may be picked again after an error
    if (!file) return;
    setError(undefined);
    setBusy(PDF_TEXT.reading);
    try {
      const subject = journeyId ?? (target === '' ? undefined : target);
      const created = await addPdf(file, subject, (done, total) => setBusy(`${PDF_TEXT.reading} ${done} de ${total}`));
      useToast.getState().show(`PDF adicionado: ${created.title}.`);
    } catch (err) {
      if (err instanceof StudyFileError) setError(err.message);
      else { console.error('pdf add failed', err); setError(STUDY_FILE_MESSAGES.unreadable); }
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <div className="pdfadd stack">
      <div className="pdfadd__row">
        {subjects && (
          <label className="field pdfadd__subject" htmlFor={pickId}>
            <span className="field__label">Disciplina do PDF</span>
            <select id={pickId} value={target} disabled={busy !== undefined} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{PDF_TEXT.noSubject}</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
        )}
        <input id={inputId} type="file" accept="application/pdf,.pdf" className="visually-hidden" disabled={busy !== undefined}
          onChange={(e) => { void onFile(e); }} />
        <label htmlFor={inputId} className={`btn btn--secondary btn--md${busy ? ' is-busy' : ''}`}>
          {busy ? PDF_TEXT.reading : 'Adicionar PDF'}
        </label>
      </div>
      <p className="pdfadd__status muted" role="status">{busy ?? ''}</p>
      {error && <p role="alert" className="faculty-form__error">{error}</p>}
    </div>
  );
}
