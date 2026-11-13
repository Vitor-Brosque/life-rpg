import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useLiveQuery } from 'dexie-react-hooks';
import { nextDayStart, stripCloze, studyObserved } from '@life/shared';
import { db } from '../../db/db';
import { useJourneys } from '../../db/hooks';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { plural } from '../../ui/format';
import { Panel } from '../../ui/Panel';
import { SketchesPanel } from '../sketch/SketchesPanel';
import { DeckSheet } from './DeckSheet';
import { ForecastBars } from './ForecastBars';
import { StudyPrefsSheet } from './StudyPrefsSheet';
import { TodayCard } from './TodayCard';
import { useStudyPlan } from './useStudyPlan';
import './study.css';

/** "/estudo": today's review, drafts to complete, decks, the next study days and observed numbers. */
export function StudyScreen() {
  const [, navigate] = useLocation();
  const study = useStudyPlan();
  const journeys = useJourneys();
  const drafts = useLiveQuery(async () => (await db.notes.toArray())
    .filter((n) => !n.deleted && n.draft).sort((a, b) => b.createdAt - a.createdAt));
  const liveCards = useLiveQuery(() => db.cards.filter((c) => !c.deleted).count());
  const [deckSheet, setDeckSheet] = useState(false);
  const [prefs, setPrefs] = useState(false);

  if (!study.loaded || !study.plan || !study.input || !study.data || drafts === undefined || liveCards === undefined) {
    return <section className="screen study" aria-busy="true" aria-label="Estudo" />;
  }
  const { plan, input, data } = study;
  const active = data.decks.filter((d) => !d.archived);
  const archived = data.decks.filter((d) => d.archived);
  const end = nextDayStart(input.today, input.dayStartHour);
  const counts = (deckId: string) => {
    const cs = input.cards.filter((c) => c.deckId === deckId);
    return { due: cs.filter((c) => c.state !== 'new' && c.due < end).length, fresh: cs.filter((c) => c.state === 'new').length };
  };
  const observed = studyObserved(input.reviews, input.today);
  const journeyName = (id?: string) => journeys.find((j) => j.id === id)?.title;
  const newCardHref = `/estudo/nota/nova${active[0] ? `?baralho=${active[0].id}` : ''}`;

  return (
    <section className="screen study stack" aria-labelledby="study-title">
      <h1 id="study-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Estudo</h1>
      <TodayCard plan={plan} mode={input.mode} restDay={study.restDay} hasDecks={active.length > 0}
        hasCards={input.cards.length > 0} hasLiveCards={liveCards > 0} onReview={() => navigate('/estudo/revisar')}
        onCreateDeck={() => setDeckSheet(true)} onNewCard={() => navigate(newCardHref)} />

      {drafts.length > 0 && (
        <Panel variant="stone" className="study-section">
          <h2 className="study__subtitle">Rascunhos para completar ({drafts.length})</h2>
          <ul className="study-list">
            {drafts.map((n) => (
              <li key={n.id}><Link className="study-list__item" href={`/estudo/nota/${n.id}`}>{stripCloze(n.front).trim() || '(sem texto)'}</Link></li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel variant="stone" className="study-section">
        <div className="study__head">
          <h2 className="study__subtitle">Baralhos</h2>
          <div className="study__actions">
            {active.length > 0 && <Button size="sm" icon="plus" onClick={() => navigate(newCardHref)}>Novo card</Button>}
            <Button size="sm" variant="ghost" onClick={() => setDeckSheet(true)}>Novo baralho</Button>
          </div>
        </div>
        {active.length === 0 ? <p className="muted">Nenhum baralho ainda.</p> : (
          <ul className="study-list">
            {active.map((d) => {
              const c = counts(d.id);
              const journey = journeyName(d.journeyId);
              return (
                <li key={d.id}>
                  <Link className="study-list__item study-deck" href={`/estudo/baralho/${d.id}`}>
                    <span className="study-deck__name">{d.name}</span>
                    {journey && <span className="study-deck__journey">{journey}</span>}
                    <span className="study-deck__counts">{c.due} hoje · {plural(c.fresh, 'novo', 'novos')}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {archived.length > 0 && (
          <details className="study-archived">
            <summary>Arquivados ({archived.length})</summary>
            <ul className="study-list">
              {archived.map((d) => <li key={d.id}><Link className="study-list__item" href={`/estudo/baralho/${d.id}`}>{d.name}</Link></li>)}
            </ul>
          </details>
        )}
      </Panel>

      <SketchesPanel />

      {input.cards.length > 0 && (
        <Panel variant="stone" className="study-section">
          <h2 className="study__subtitle">Próximos dias</h2>
          <ForecastBars forecast={plan.forecast} budgetMin={input.settings.budgetMin} />
        </Panel>
      )}

      {(observed.reviewsWeek > 0 || observed.accuracy30 !== undefined) && (
        <Panel variant="stone" className="study-section">
          <h2 className="study__subtitle">Observado</h2>
          <dl className="study-observed">
            {observed.accuracy30 !== undefined && (
              <div><dt>Acerto em cards já aprendidos (30 dias)</dt><dd>{Math.round(observed.accuracy30 * 100)}%</dd></div>
            )}
            <div><dt>Revisões na semana</dt><dd>{observed.reviewsWeek}</dd></div>
            <div><dt>Minutos na semana</dt><dd>{observed.minutesWeek}</dd></div>
          </dl>
        </Panel>
      )}

      <Button variant="ghost" icon="gear" onClick={() => setPrefs(true)}>Preferências de estudo</Button>
      <DeckSheet open={deckSheet} onClose={() => setDeckSheet(false)} />
      <StudyPrefsSheet open={prefs} onClose={() => setPrefs(false)} />
    </section>
  );
}
