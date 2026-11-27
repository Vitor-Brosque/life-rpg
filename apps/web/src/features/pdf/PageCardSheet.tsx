import { useEffect, useId, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { NoteErrors, StudyFile } from '@life/shared';
import { sourceLabel } from '@life/shared';
import { db } from '../../db/db';
import { NoteValidationError } from '../../domain/studyActions';
import { NEW_SUBJECT_DECK, StudyFileError, createPageCard, defaultCardDeck } from '../../domain/studyFileActions';
import { Button } from '../../ui/Button';
import { FAILURE_TOAST } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';

// "Criar card desta página" (spec 2026-11-26 §1.4): Frente empty (the question is hers), Verso with the selected
// excerpt, the subject's deck already chosen and the origin "Título · p. 12". Saving makes a normal card (not a draft).

export interface PageCardRequest { page: number; back: string }

/** The PDF's subject was deleted: no subject deck to offer. */
export const PAGE_CARD_SUBJECT_GONE = 'A disciplina deste PDF foi apagada, então não há baralho dela. Escolha outro baralho, ou mude a disciplina do PDF em Materiais.';

export function PageCardSheet({ file, request, onClose }: { file: StudyFile; request?: PageCardRequest; onClose: () => void }) {
  return (
    <Sheet open={request !== undefined} onClose={onClose} title="Criar card desta página" placement="top">
      {request && <PageCardForm key={`${request.page}:${request.back}`} file={file} request={request} onDone={onClose} />}
    </Sheet>
  );
}

function PageCardForm({ file, request, onDone }: { file: StudyFile; request: PageCardRequest; onDone: () => void }) {
  const frontId = useId();
  const backId = useId();
  const deckSelectId = useId();
  const [front, setFront] = useState('');
  const [back, setBack] = useState(request.back);
  const [deckId, setDeckId] = useState<string>();
  const [errors, setErrors] = useState<NoteErrors & { other?: string }>({});
  const [saving, setSaving] = useState(false);
  const decks = useLiveQuery(async () => (await db.decks.toArray()).filter((d) => !d.deleted && !d.archived).sort((a, b) => a.order - b.order));
  // The subject, null when the PDF has none; 'gone' when it was deleted (or is no longer a subject): no subject deck then.
  const subject = useLiveQuery(async () => {
    if (!file.journeyId) return null;
    const j = await db.journeys.get(file.journeyId);
    return j && !j.deleted && j.subject === true ? j : 'gone' as const;
  }, [file.journeyId]);
  useEffect(() => {
    let alive = true;
    void defaultCardDeck(file).then((d) => { if (alive) setDeckId((cur) => cur ?? d ?? ''); });
    return () => { alive = false; };
  }, [file]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await createPageCard({ fileId: file.id, page: request.page, front, back, ...(deckId ? { deckId } : {}) });
      useToast.getState().show('Card criado. Ele entra na revisão.');
      onDone();
    } catch (err) {
      setSaving(false);
      if (err instanceof NoteValidationError) setErrors(err.errors);
      else if (err instanceof StudyFileError) setErrors({ other: err.message });
      else { console.error('page card failed', err); useToast.getState().show(FAILURE_TOAST); }
    }
  };
  if (decks === undefined || subject === undefined || deckId === undefined) return null;
  const live = subject === 'gone' ? null : subject;
  const newDeck = deckId === NEW_SUBJECT_DECK && live;
  return (
    <form className="stack" noValidate onSubmit={(e) => { void submit(e); }}>
      <p className="pdfcard__origin">{`Origem: ${sourceLabel(file.title, request.page)}`}</p>
      <div className="field">
        <label className="field__label" htmlFor={frontId}>Frente</label>
        <textarea id={frontId} rows={3} value={front} autoFocus placeholder="A sua pergunta sobre este trecho."
          aria-invalid={errors.front ? true : undefined}
          onChange={(e) => { setFront(e.target.value); setErrors({}); }} />
        {errors.front && <p role="alert" className="faculty-form__error">{errors.front}</p>}
      </div>
      <div className="field">
        <label className="field__label" htmlFor={backId}>Verso</label>
        <textarea id={backId} rows={5} value={back} aria-invalid={errors.back ? true : undefined}
          onChange={(e) => { setBack(e.target.value); setErrors({}); }} />
        {errors.back && <p role="alert" className="faculty-form__error">{errors.back}</p>}
      </div>
      <div className="field">
        <label className="field__label" htmlFor={deckSelectId}>Baralho</label>
        <select id={deckSelectId} value={deckId} onChange={(e) => { setDeckId(e.target.value); setErrors({}); }}>
          {live && !decks.some((d) => d.journeyId === live.id) && (
            <option value={NEW_SUBJECT_DECK}>{`${live.title} (baralho novo)`}</option>
          )}
          {deckId === '' && <option value="">Escolha um baralho</option>}
          {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {newDeck && <p className="faculty-form__hint">{`O baralho "${live.title}" é criado ao salvar.`}</p>}
        {subject === 'gone' && <p className="faculty-form__hint">{PAGE_CARD_SUBJECT_GONE}</p>}
        {errors.deck && <p role="alert" className="faculty-form__error">{errors.deck}</p>}
      </div>
      {errors.other && <p role="alert" className="faculty-form__error">{errors.other}</p>}
      <div className="faculty-actions">
        <Button type="submit" variant="primary" disabled={saving}>Salvar card</Button>
        <Button variant="ghost" onClick={onDone}>Cancelar</Button>
      </div>
    </form>
  );
}
