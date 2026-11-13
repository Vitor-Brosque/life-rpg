import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAiFeature } from '../../ai/aiStatus';
import { db } from '../../db/db';
import { useJourneys, useSettings, useToday } from '../../db/hooks';
import { deleteDeck, restoreDeck, setDeckArchived } from '../../domain/studyActions';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { plural } from '../../ui/format';
import { Panel } from '../../ui/Panel';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { DeckSheet } from './DeckSheet';
import { SuggestCardsSheet } from './SuggestCardsSheet';
import { TYPE_LABEL, matchesQuery, noteStatus, noteTitle } from './noteDraft';
import './study.css';

/** "/estudo/baralho/:id": the deck's notes (search, open to edit), new card, review, archive. */
export function DeckScreen({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const today = useToday();
  const settings = useSettings();
  const journeys = useJourneys();
  const deck = useLiveQuery(async () => (await db.decks.get(id)) ?? null, [id]);
  const notes = useLiveQuery(async () => (await db.notes.where('deckId').equals(id).toArray())
    .filter((n) => !n.deleted).sort((a, b) => b.createdAt - a.createdAt), [id]);
  const cards = useLiveQuery(async () => (await db.cards.where('deckId').equals(id).toArray()).filter((c) => !c.deleted), [id]);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(false);
  const cardsAi = useAiFeature('cards');
  const [suggest, setSuggest] = useState(false);

  if (deck === undefined || notes === undefined || cards === undefined || !today || !settings) {
    return <section className="screen deck" aria-busy="true" aria-label="Baralho" />;
  }
  if (deck === null || deck.deleted) {
    return (
      <section className="screen stack">
        <h1>Baralho não encontrado</h1>
        <Link href="/estudo">Voltar ao Estudo</Link>
      </section>
    );
  }
  const shown = notes.filter((n) => matchesQuery(n, q));
  const journey = journeys.find((j) => j.id === deck.journeyId)?.title;
  const reviewable = !deck.archived && cards.some((c) => !c.suspended);
  const remove = (): void => safeRun(deleteDeck(id).then((done) => {
    if (!done) return;
    navigate('/estudo');
    useToast.getState().show('Baralho apagado.', { label: 'Desfazer', run: () => safeRun(restoreDeck(id)) });
  }));

  return (
    <section className="screen deck stack" aria-labelledby="deck-title">
      <Link className="deck__back" href="/estudo">← Estudo</Link>
      <h1 id="deck-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>{deck.name}</h1>
      <p className="muted">
        {journey ? `${journey} · ` : ''}{plural(notes.length, 'nota', 'notas')}{deck.archived ? ' · arquivado' : ''}
      </p>
      <div className="study__actions">
        {!deck.archived && <Button variant="primary" icon="plus" onClick={() => navigate(`/estudo/nota/nova?baralho=${id}`)}>Novo card</Button>}
        {reviewable && <Button icon="book" onClick={() => navigate(`/estudo/revisar?baralho=${id}`)}>Revisar este baralho</Button>}
        {!deck.archived && cardsAi && <Button variant="ghost" onClick={() => setSuggest(true)}>Sugerir cards</Button>}
        <Button variant="ghost" onClick={() => setEdit(true)}>Editar baralho</Button>
        <Button variant="ghost" onClick={() => safeRun(setDeckArchived(id, !deck.archived))}>{deck.archived ? 'Desarquivar' : 'Arquivar'}</Button>
        {notes.length === 0 && <Button variant="danger" onClick={remove}>Apagar baralho</Button>}
      </div>

      <Panel variant="stone" className="study-section">
        <div className="field">
          <label className="field__label" htmlFor="deck-search">Buscar</label>
          <input id="deck-search" type="search" value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
        </div>
        {shown.length === 0 ? (
          <p className="muted">{notes.length === 0 ? 'Nenhum card neste baralho ainda.' : 'Nada encontrado.'}</p>
        ) : (
          <ul className="study-list">
            {shown.map((n) => {
              const status = noteStatus(n, cards.filter((c) => c.noteId === n.id), today, settings.dayStartHour);
              return (
                <li key={n.id}>
                  <Link className="study-list__item deck-note" href={`/estudo/nota/${n.id}`}>
                    <span className="deck-note__title">{noteTitle(n.front)}</span>
                    <span className="deck-note__meta">{TYPE_LABEL[n.type]}{status ? ` · ${status}` : ''}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <DeckSheet open={edit} onClose={() => setEdit(false)} deck={deck} />
      {!deck.archived && cardsAi && <SuggestCardsSheet open={suggest} onClose={() => setSuggest(false)} deckId={id} />}
    </section>
  );
}
