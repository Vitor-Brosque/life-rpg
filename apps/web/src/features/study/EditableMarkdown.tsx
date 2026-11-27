import { useId, useRef, useState, type FormEvent } from 'react';
import { NotebookValidationError } from '../../domain/notebookActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { FAILURE_TOAST } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { Rich } from './Rich';

/** A text longer than this (characters or lines) shows cut, with "Ver tudo". */
const LONG_CHARS = 600;
const LONG_LINES = 12;

export interface EditableMarkdownProps {
  title: string;
  /** The heading level of the title (the Markdown's own headings go below it). */
  level: 2 | 3;
  text: string;
  max: number;
  emptyText: string;
  /** A line under the title. */
  note?: string;
  /** The toast after saving. */
  savedText: string;
  onSave: (text: string) => Promise<unknown>;
  headingId?: string;
}

/**
 * A Markdown text the person reads and edits by hand (a notebook section, the study profile): rendered by `Rich` in
 * document mode (never HTML), cut when long with "Ver tudo", and "Editar" opens a text box with Salvar and Cancelar.
 */
export function EditableMarkdown({ title, level, text, max, emptyText, note, savedText, onSave, headingId }: EditableMarkdownProps) {
  const autoId = useId();
  const id = headingId ?? `md-${autoId}`;
  const textId = `${id}-text`;
  const heading = () => document.getElementById(id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const Heading = level === 2 ? 'h2' : 'h3';
  const empty = text.trim() === '';
  const long = text.length > LONG_CHARS || text.split('\n').length > LONG_LINES;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (draft.trim().length > max) { setError(`O texto pode ter até ${max.toLocaleString('pt-BR')} caracteres.`); return; }
    setBusy(true);
    try {
      await onSave(draft);
      focusWhenGone(formRef.current, heading);
      setEditing(false);
      useToast.getState().show(savedText);
    } catch (err) {
      if (err instanceof NotebookValidationError) setError(err.message);
      else { console.error('text save failed', err); useToast.getState().show(FAILURE_TOAST); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="notebook__section stack" aria-labelledby={id}>
      <Heading id={id} className={level === 2 ? 'study__subtitle' : 'notebook__title'} tabIndex={-1}>{title}</Heading>
      {note && <p className="muted notebook__note">{note}</p>}
      {editing ? (
        <form ref={formRef} className="stack" noValidate onSubmit={(e) => { void save(e); }}>
          <label className="field">
            <span className="field__label">{`Texto de ${title}`}</span>
            <textarea className="notebook__input" rows={10} value={draft} autoFocus spellCheck
              onChange={(e) => { setDraft(e.target.value); setError(undefined); }} />
          </label>
          <p className={draft.trim().length > max ? 'faculty-form__error' : 'muted notebook__count'}>{`${draft.trim().length.toLocaleString('pt-BR')} de ${max.toLocaleString('pt-BR')} caracteres`}</p>
          {error && <p role="alert" className="faculty-form__error">{error}</p>}
          <div className="faculty-actions">
            <Button type="submit" variant="primary" disabled={busy}>Salvar</Button>
            <Button variant="ghost" onClick={(e) => { focusWhenGone(e.currentTarget, heading); setEditing(false); setError(undefined); }}>Cancelar</Button>
          </div>
        </form>
      ) : (
        <>
          {empty ? <p className="muted">{emptyText}</p> : (
            <div id={textId} className={long && !expanded ? 'notebook__text notebook__text--cut' : 'notebook__text'}>
              <Rich text={text} doc headingLevel={level + 1} />
            </div>
          )}
          <div className="faculty-actions">
            {!empty && long && (
              <Button size="sm" aria-expanded={expanded} aria-controls={textId} aria-label={`${expanded ? 'Ver menos' : 'Ver tudo'}: ${title}`}
                onClick={() => setExpanded((x) => !x)}>{expanded ? 'Ver menos' : 'Ver tudo'}</Button>
            )}
            <Button size="sm" aria-label={`Editar ${title}`} onClick={() => { setDraft(text); setError(undefined); setEditing(true); }}>Editar</Button>
          </div>
        </>
      )}
    </section>
  );
}
