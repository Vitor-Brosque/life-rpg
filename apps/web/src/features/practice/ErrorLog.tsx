import { useId, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useLiveQuery } from 'dexie-react-hooks';
import type { PracticeError, PracticeSession } from '@life/shared';
import { db } from '../../db/db';
import { errorToCardDraft, removePracticeError, restorePracticeError, updatePractice } from '../../domain/practiceActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { ErrorSheet } from './ErrorSheet';

/** "Registro de erros" (spec §5.3): on every step, below the navigation. */
export function ErrorLog({ session }: { session: PracticeSession }) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [sheet, setSheet] = useState<{ entry?: PracticeError } | null>(null);
  const decks = useLiveQuery(async () => (await db.decks.orderBy('order').toArray()).filter((d) => !d.deleted && !d.archived)) ?? [];
  const noteIds = session.errors.flatMap((e) => (e.noteId ? [e.noteId] : []));
  const noteKey = noteIds.join(',');
  const liveNotes = useLiveQuery(
    async () => (await db.notes.bulkGet(noteIds)).filter((n) => n && !n.deleted).map((n) => n!.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noteKey],
  ) ?? [];
  const count = session.errors.length;
  const deckValue = session.deckId && decks.some((d) => d.id === session.deckId) ? session.deckId : '';

  // Where focus goes when the control it was on disappears: a row's first control, else the heading.
  const rowControl = (id?: string) => (): HTMLElement | null =>
    (id ? document.querySelector<HTMLElement>(`[data-error-id="${id}"] a, [data-error-id="${id}"] button`) : null)
    ?? headingRef.current;

  const remove = (e: PracticeError, index: number): void => {
    const neighbour = session.errors[index + 1] ?? session.errors[index - 1];
    focusWhenGone(document.activeElement, rowControl(neighbour?.id));
    safeRun(removePracticeError(session.id, e.id).then((removed) => {
      if (!removed) return;
      useToast.getState().show('Erro apagado.', {
        label: 'Desfazer',
        run: () => {
          focusWhenGone(document.activeElement, rowControl(removed.entry.id));
          safeRun(restorePracticeError(session.id, removed.entry, removed.index));
        },
      });
    }));
  };
  const toCard = (e: PracticeError): void => {
    focusWhenGone(document.activeElement, rowControl(e.id));
    safeRun(errorToCardDraft(session.id, e.id).then(() => useToast.getState().show('Rascunho de card salvo')));
  };

  return (
    <section className="practice-errors" aria-labelledby={titleId}>
      <div className="practice-errors__head">
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="practice-errors__title">
          {count ? `Registro de erros (${count})` : 'Registro de erros'}
        </h2>
        <Button size="sm" icon="plus" onClick={() => setSheet({})}>Registrar erro</Button>
      </div>
      {count === 0 ? (
        <p className="practice__hint">
          Errar faz parte de programar. Anote o que deu errado, por quê e a ideia correta: é daí que sai o aprendizado.
        </p>
      ) : (
        <>
          <label className="field practice-errors__deck">
            <span className="field__label">Rascunhos de card vão para</span>
            <select value={deckValue} onChange={(e) => safeRun(updatePractice(session.id, { deckId: e.target.value || undefined }))}>
              <option value="">Caixa de entrada</option>
              {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <ul className="practice-entries">
            {session.errors.map((e, i) => (
              <li key={e.id} className="practice-entry" data-error-id={e.id}>
                <p className="practice-entry__text practice-entry__what">{e.what}</p>
                {e.why && <p className="practice-entry__text">Por quê: {e.why}</p>}
                {e.fix && <p className="practice-entry__text">Ideia correta: {e.fix}</p>}
                <div className="cluster">
                  {e.noteId && liveNotes.includes(e.noteId) ? (
                    <Link href={`/estudo/nota/${e.noteId}`} aria-label={`Rascunho de card · abrir: ${e.what}`}>Rascunho de card · abrir</Link>
                  ) : (
                    <Button size="sm" aria-label={`Virar card: ${e.what}`} onClick={() => toCard(e)}>Virar card</Button>
                  )}
                  <Button size="sm" variant="ghost" aria-label={`Editar erro: ${e.what}`} onClick={() => setSheet({ entry: e })}>Editar</Button>
                  <Button size="sm" variant="ghost" aria-label={`Apagar erro: ${e.what}`} onClick={() => remove(e, i)}>Apagar</Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <ErrorSheet open={sheet !== null} sessionId={session.id} entry={sheet?.entry} onClose={() => setSheet(null)} />
    </section>
  );
}
