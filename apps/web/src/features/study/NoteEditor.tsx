import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { useLiveQuery } from 'dexie-react-hooks';
import type { CodeLang, NoteErrors, NoteType } from '@life/shared';
import { wrapCloze } from '@life/shared';
import { db } from '../../db/db';
import {
  NoteValidationError, deleteNote, resetNote, restoreNote, saveNote, setNoteSuspended,
} from '../../domain/studyActions';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import { FAILURE_TOAST, safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { FieldError } from '../routine/BlockFields';
import { CodeEditor } from './CodeEditor';
import { CodeView, Rich } from './Rich';
import { LANG_LABEL, NOTE_TYPES, TYPE_LABEL, emptyForm, formOf, isNoteType, previewFaces, type NoteForm } from './noteDraft';
import './study.css';

const FRONT_LABEL: Record<NoteType, string> = {
  basic: 'Frente', reversible: 'Frente', cloze: 'Texto com lacunas', code: 'Enunciado', topic: 'Tópico a explicar',
};

/** "/estudo/nota/nova" and "/estudo/nota/:id": write a note, see its cards, save (spec §6). */
export function NoteEditor({ id }: { id?: string }) {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const backToSession = params.get('voltar') === 'sessao';
  const decks = useLiveQuery(async () => (await db.decks.orderBy('order').toArray()).filter((d) => !d.deleted && !d.archived));
  const existing = useLiveQuery(async () => (id ? (await db.notes.get(id)) ?? null : null), [id]);
  const cards = useLiveQuery(async () => (id ? (await db.cards.where('noteId').equals(id).toArray()).filter((c) => !c.deleted) : []), [id]);
  const [form, setForm] = useState<NoteForm>(() => {
    const tipo = params.get('tipo');
    return emptyForm(params.get('baralho') ?? '', isNoteType(tipo) ? tipo : 'basic');
  });
  const [errors, setErrors] = useState<NoteErrors>({});
  const [status, setStatus] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const loadedFor = useRef<string | undefined>(undefined);
  const frontRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (id && existing && loadedFor.current !== id) {
      loadedFor.current = id;
      setForm(formOf(existing));
    }
  }, [id, existing]);
  useEffect(() => {
    if (!id && !form.deckId && decks && decks[0]) setForm((f) => ({ ...f, deckId: decks[0]!.id }));
  }, [id, decks, form.deckId]);

  if (decks === undefined || (id && (existing === undefined || cards === undefined))) {
    return <section className="screen note-editor" aria-busy="true" aria-label="Card" />;
  }
  if (id && (!existing || existing.deleted)) {
    return (
      <section className="screen stack">
        <h1>Card não encontrado</h1>
        <Link href="/estudo">Voltar ao Estudo</Link>
      </section>
    );
  }

  const isNew = !id;
  const isDraft = !!existing?.draft;
  const set = <K extends keyof NoteForm>(k: K, v: NoteForm[K]): void => setForm((f) => ({ ...f, [k]: v }));
  const leave = (deckId?: string): void => navigate(backToSession ? (params.get('baralho') ? `/estudo/revisar?baralho=${params.get('baralho')}` : '/estudo/revisar') : deckId ? `/estudo/baralho/${deckId}` : '/estudo');

  const save = async (next: boolean): Promise<void> => {
    try {
      const note = await saveNote({
        id, deckId: form.deckId || undefined, type: form.type, front: form.front, back: form.back,
        extra: form.extra, language: form.language,
      });
      setErrors({});
      if (next) {
        setForm((f) => emptyForm(f.deckId, f.type, f.language));
        setStatus('Salvo. Próximo card.');
        frontRef.current?.focus();
        return;
      }
      leave(note.deckId);
    } catch (e) {
      if (e instanceof NoteValidationError) { setErrors(e.errors); setStatus(''); return; }
      console.error('save note failed', e);
      useToast.getState().show(FAILURE_TOAST);
    }
  };

  const lacuna = (): void => {
    const el = frontRef.current;
    if (!el) return;
    const r = wrapCloze(form.front, el.selectionStart, el.selectionEnd);
    set('front', r.text);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.cursor, r.cursor); });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>): void => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'Enter') { e.preventDefault(); void save(isNew); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'l' && form.type === 'cloze') { e.preventDefault(); lacuna(); }
  };

  const remove = (): void => {
    if (!id) return;
    const deckId = existing?.deckId;
    safeRun(deleteNote(id).then((cardIds) => {
      leave(deckId);
      useToast.getState().show('Card apagado.', { label: 'Desfazer', run: () => safeRun(restoreNote(id, cardIds)) });
    }));
  };
  const allSuspended = !!cards && cards.length > 0 && cards.every((c) => c.suspended);
  const faces = previewFaces(form);

  return (
    <section className="screen note-editor" aria-labelledby="note-title">
      <h1 id="note-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>{isNew ? 'Novo card' : isDraft ? 'Completar rascunho' : 'Editar card'}</h1>
      {isDraft && <p className="muted">Rascunho capturado. Complete a resposta e escolha o baralho para ele entrar na revisão.</p>}
      <div className="note-editor__grid">
        <form className="stack note-editor__form" onSubmit={(e) => { e.preventDefault(); void save(false); }} onKeyDown={onKeyDown}>
          <fieldset className="field">
            <legend className="field__label">Tipo</legend>
            <div className="note-types">
              {NOTE_TYPES.map((t) => (
                <label key={t} className="note-type">
                  <input type="radio" name="note-type" value={t} checked={form.type === t} onChange={() => set('type', t)} />
                  <span>{TYPE_LABEL[t]}</span>
                </label>
              ))}
            </div>
            {!isNew && <p className="block-form__hint">Trocar o tipo recalcula os cards desta nota.</p>}
          </fieldset>

          <div className="field">
            <label className="field__label" htmlFor="note-deck">Baralho</label>
            <select id="note-deck" value={form.deckId} aria-describedby="note-deck-error" onChange={(e) => set('deckId', e.target.value)}>
              <option value="">Escolha um baralho</option>
              {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <FieldError id="note-deck-error" text={errors.deck} />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="note-front">{FRONT_LABEL[form.type]}</label>
            {form.type === 'cloze' && (
              <div className="note-editor__tools">
                <Button size="sm" onPointerDown={(e) => e.preventDefault()} onClick={lacuna} aria-keyshortcuts="Control+Shift+L">Lacuna</Button>
                <span className="block-form__hint">Selecione um trecho e toque em Lacuna (Ctrl+Shift+L). Lacunas com o mesmo número viram um card só.</span>
              </div>
            )}
            <textarea id="note-front" ref={frontRef} rows={form.type === 'cloze' ? 6 : 3} value={form.front}
              aria-describedby="note-front-error" onChange={(e) => set('front', e.target.value)} />
            <FieldError id="note-front-error" text={errors.front} />
          </div>

          {(form.type === 'basic' || form.type === 'reversible') && (
            <div className="field">
              <label className="field__label" htmlFor="note-back">Verso</label>
              <textarea id="note-back" rows={3} value={form.back} aria-describedby="note-back-error" onChange={(e) => set('back', e.target.value)} />
              <FieldError id="note-back-error" text={errors.back} />
            </div>
          )}

          {form.type === 'code' && (
            <>
              <div className="field">
                <label className="field__label" htmlFor="note-lang">Linguagem</label>
                <select id="note-lang" value={form.language} onChange={(e) => set('language', e.target.value as CodeLang)}>
                  {(Object.keys(LANG_LABEL) as CodeLang[]).map((l) => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}
                </select>
              </div>
              <CodeEditor id="note-back" label="Solução" value={form.back} onChange={(v) => set('back', v)} />
              <FieldError id="note-back-error" text={errors.back} />
            </>
          )}

          {form.type === 'topic' && (
            <div className="field">
              <label className="field__label" htmlFor="note-back">Pontos-chave (um por linha)</label>
              <textarea id="note-back" rows={5} value={form.back} aria-describedby="note-back-hint note-back-error"
                onChange={(e) => set('back', e.target.value)} />
              <p id="note-back-hint" className="block-form__hint">O que uma boa explicação precisa conter: conceitos, passos de uma dedução, exemplos. Na revisão, você marca o que conseguiu lembrar.</p>
              <FieldError id="note-back-error" text={errors.back} />
            </div>
          )}

          <div className="field">
            <label className="field__label" htmlFor="note-extra">Por quê? (opcional)</label>
            <textarea id="note-extra" rows={2} value={form.extra} aria-describedby="note-extra-hint" onChange={(e) => set('extra', e.target.value)} />
            <p id="note-extra-hint" className="block-form__hint">Entender o porquê ajuda a lembrar: escreva a explicação ou a intuição por trás.</p>
          </div>

          <p className="note-editor__status" role="status">{status}</p>
          <div className="commit-form__actions">
            {isNew && <Button variant="primary" icon="check" onClick={() => void save(true)} aria-keyshortcuts="Control+Enter">Salvar e próximo</Button>}
            <Button type="submit" variant={isNew ? 'secondary' : 'primary'} icon={isNew ? undefined : 'check'}>Salvar</Button>
            <Button variant="ghost" onClick={() => leave(existing?.deckId ?? (form.deckId || undefined))}>Cancelar</Button>
          </div>

          {!isNew && !isDraft && (
            <div className="note-editor__danger">
              <Button size="sm" onClick={() => id && safeRun(setNoteSuspended(id, !allSuspended))}>{allSuspended ? 'Retomar' : 'Suspender'}</Button>
              <Button size="sm" onClick={() => {
                if (!confirmReset) { setConfirmReset(true); return; }
                setConfirmReset(false);
                if (id) safeRun(resetNote(id).then(() => useToast.getState().show('Progresso reiniciado.')));
              }}>{confirmReset ? 'Confirmar reinício' : 'Reiniciar progresso'}</Button>
              <Button size="sm" variant="danger" onClick={remove}>Apagar</Button>
            </div>
          )}
          {isDraft && <div className="note-editor__danger"><Button size="sm" variant="danger" onClick={remove}>Apagar</Button></div>}
        </form>

        <Panel variant="stone" className="note-preview" role="region" aria-label="Pré-visualização">
          <h2 className="study__subtitle">Pré-visualização</h2>
          {faces.length === 0 ? <p className="muted">A pré-visualização aparece quando houver o que mostrar.</p> : faces.map((f, i) => (
            <article key={i} className="note-preview__card">
              {faces.length > 1 && <p className="note-preview__count">Card {i + 1} de {faces.length}</p>}
              <Rich text={f.front} />
              <hr className="note-preview__divider" />
              {f.code ? <CodeView code={f.code.solution} lang={f.code.lang} />
                : f.points ? <ul className="note-preview__points">{f.points.map((p, j) => <li key={j}><Rich text={p} /></li>)}</ul>
                : <Rich text={f.back} />}
              {f.extra && <Rich text={f.extra} className="note-preview__extra" />}
            </article>
          ))}
        </Panel>
      </div>
    </section>
  );
}
