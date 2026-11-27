import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { BibItem, BibKind } from '@life/shared';
import {
  BIB_KINDS, BIB_KIND_LABEL, NOTEBOOK_LIMITS, NOTEBOOK_SECTIONS, NOTEBOOK_SECTION_TITLE, bibKey, notebookId, openableBibUrl,
} from '@life/shared';
import { db } from '../../db/db';
import { NotebookValidationError, addBook, removeBook, restoreBook, setNotebookSection } from '../../domain/notebookActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import { FAILURE_TOAST, safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { EditableMarkdown } from '../study/EditableMarkdown';

export const NOTEBOOK_EMPTY = 'Vazio. Peça ao chat da matéria para preencher.';
const BIB_HEADING_ID = 'subject-bibliography';
const bibHeading = () => document.getElementById(BIB_HEADING_ID);

/**
 * "Caderno" (spec 2026-11-26 §5.1): the four sections in Markdown, each editable by hand, and the bibliography. The
 * chats fill them through proposals; this panel never sends anything to an assistant.
 */
export function NotebookPanel({ journeyId }: { journeyId: string }) {
  const nb = useLiveQuery(async () => {
    const r = await db.subjectNotebooks.get(notebookId(journeyId));
    return r && !r.deleted ? r : null;
  }, [journeyId]);
  if (nb === undefined) return <Panel variant="stone" className="study-section" aria-busy="true" aria-label="Caderno" />;
  return (
    <Panel variant="stone" className="study-section stack">
      <h2 id="subject-notebook" className="study__subtitle" tabIndex={-1}>Caderno</h2>
      {NOTEBOOK_SECTIONS.map((s) => (
        <EditableMarkdown key={s} title={NOTEBOOK_SECTION_TITLE[s]} level={3} text={nb?.[s] ?? ''} max={NOTEBOOK_LIMITS[s]}
          emptyText={NOTEBOOK_EMPTY} savedText="Caderno salvo." onSave={(text) => setNotebookSection(journeyId, s, text)} />
      ))}
      <Bibliography journeyId={journeyId} books={nb?.bibliography ?? []} />
    </Panel>
  );
}

function Bibliography({ journeyId, books }: { journeyId: string; books: readonly BibItem[] }) {
  const [adding, setAdding] = useState(false);
  const remove = (title: string, button: Element) => {
    safeRun(async () => {
      const removed = await removeBook(journeyId, title);
      if (!removed) return;
      focusWhenGone(button, bibHeading);
      useToast.getState().show('Livro apagado.', { label: 'Desfazer', run: () => safeRun(async () => {
        // A proposal may have filled the list again meanwhile: never more than 40 books.
        if (await restoreBook(journeyId, removed.book, removed.index) === 'full') {
          useToast.getState().show(`A bibliografia já tem ${NOTEBOOK_LIMITS.bibliography} livros.`);
        }
      }) });
    });
  };
  return (
    <section className="notebook__section stack" aria-labelledby={BIB_HEADING_ID}>
      <h3 id={BIB_HEADING_ID} className="notebook__title" tabIndex={-1}>Bibliografia</h3>
      {books.length === 0 ? <p className="muted">Nenhum livro ainda.</p> : (
        <ul className="sdetail__list">
          {books.map((b) => {
            const url = openableBibUrl(b);
            return (
              <li key={bibKey(b.title)} className="sdetail__row">
                <span className="sdetail__row-text">
                  <strong>{b.title}</strong>
                  {[b.authors, BIB_KIND_LABEL[b.kind]].filter(Boolean).map((x) => ` · ${x}`).join('')}
                  {b.note && <span className="notebook__book-note">{b.note}</span>}
                </span>
                {url && (
                  <a className="btn btn--secondary btn--sm" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${b.title}`}>Abrir</a>
                )}
                <Button size="sm" variant="ghost" aria-label={`Apagar ${b.title}`} onClick={(e) => remove(b.title, e.currentTarget)}>Apagar</Button>
              </li>
            );
          })}
        </ul>
      )}
      {adding
        ? <BookForm journeyId={journeyId} onDone={() => setAdding(false)} />
        : <div><Button onClick={() => setAdding(true)}>Adicionar livro</Button></div>}
    </section>
  );
}

function BookForm({ journeyId, onDone }: { journeyId: string; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [kind, setKind] = useState<BibKind>('basica');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await addBook(journeyId, { title, authors, kind, url });
      focusWhenGone(form, bibHeading);
      useToast.getState().show('Livro adicionado.');
      onDone();
    } catch (err) {
      if (err instanceof NotebookValidationError) setError(err.message);
      else { console.error('book add failed', err); useToast.getState().show(FAILURE_TOAST); }
    }
  };
  const clear = () => setError(undefined);
  return (
    <form className="stack notebook__book-form" noValidate onSubmit={(e) => { void submit(e); }}>
      <label className="field">
        <span className="field__label">Título</span>
        <input type="text" value={title} autoComplete="off" autoFocus maxLength={NOTEBOOK_LIMITS.bibTitle}
          onChange={(e) => { setTitle(e.target.value); clear(); }} />
      </label>
      <label className="field">
        <span className="field__label">Autores</span>
        <input type="text" value={authors} autoComplete="off" maxLength={NOTEBOOK_LIMITS.bibAuthors}
          onChange={(e) => { setAuthors(e.target.value); clear(); }} />
      </label>
      <fieldset className="faculty-form__kinds">
        <legend className="field__label">Tipo</legend>
        {BIB_KINDS.map((k) => (
          <label key={k} className="faculty-form__kind">
            <input type="radio" name="book-kind" value={k} checked={kind === k} onChange={() => { setKind(k); clear(); }} />
            <span>{BIB_KIND_LABEL[k]}</span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span className="field__label">Link (opcional)</span>
        <input type="url" inputMode="url" value={url} autoComplete="off" spellCheck={false} placeholder="https://"
          onChange={(e) => { setUrl(e.target.value); clear(); }} />
      </label>
      {error && <p role="alert" className="faculty-form__error">{error}</p>}
      <div className="faculty-actions">
        <Button type="submit" variant="primary">Salvar livro</Button>
        <Button variant="ghost" onClick={(e) => { focusWhenGone(e.currentTarget, bibHeading); onDone(); }}>Cancelar</Button>
      </div>
    </form>
  );
}
