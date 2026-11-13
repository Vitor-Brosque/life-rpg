import { useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { useJourneys, useNow, useToday } from '../../db/hooks';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { FOCUS_PAGE, focusWhenGone } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import { NewPracticeSheet } from './NewPracticeSheet';
import { PracticeHistory } from './PracticeHistory';
import { PracticeRow } from './PracticePanel';
import { usePracticeSessions } from './practiceData';
import './practice.css';

/** "/estudo/praticas" (spec §5.5): open and closed sessions, the observed history, an optional journey filter. */
export function PracticeListScreen() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const journeyId = new URLSearchParams(search).get('jornada') ?? undefined;
  const sessions = usePracticeSessions();
  const journeys = useJourneys();
  const now = useNow();
  const today = useToday();
  const [creating, setCreating] = useState(false);
  if (sessions === undefined) return <section className="screen" aria-busy="true" aria-label="Prática técnica" />;

  const shown = journeyId ? sessions.filter((s) => s.journeyId === journeyId) : sessions;
  const open = shown.filter((s) => s.status === 'open');
  const done = shown.filter((s) => s.status === 'done').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  const journey = journeys.find((j) => j.id === journeyId);
  const from = `/estudo/praticas${search ? `?${search}` : ''}`;

  return (
    <section className="screen stack" aria-labelledby="practice-list-title">
      <Link href="/estudo" className="deck__back">← Estudo</Link>
      <div className="study__head">
        <h1 id="practice-list-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Prática técnica</h1>
        <Button icon="plus" onClick={() => setCreating(true)}>Nova sessão</Button>
      </div>
      {journeyId && (
        <div className="cluster">
          <Chip selected removeLabel="Remover filtro de jornada"
            onRemove={() => { focusWhenGone(document.activeElement); navigate('/estudo/praticas'); }}>
            {`Jornada: ${journey?.title ?? '…'}`}
          </Chip>
        </div>
      )}
      {shown.length === 0 ? (
        <Panel variant="stone">
          <p>Nenhuma sessão ainda. Uma sessão segue o método: problema, passos, código, testes e reconstruir sem consultar.</p>
        </Panel>
      ) : (
        <>
          {open.length > 0 && (
            <Panel variant="stone" className="study-section">
              <h2 className="study__subtitle">{`Em aberto (${open.length})`}</h2>
              <ul className="study-list">{open.map((s) => <PracticeRow key={s.id} session={s} journeys={journeys} now={now} from={from} {...(today ? { today } : {})} />)}</ul>
            </Panel>
          )}
          {done.length > 0 && (
            <Panel variant="stone" className="study-section">
              <h2 className="study__subtitle">{`Encerradas (${done.length})`}</h2>
              <ul className="study-list">{done.map((s) => <PracticeRow key={s.id} session={s} journeys={journeys} now={now} from={from} {...(today ? { today } : {})} />)}</ul>
            </Panel>
          )}
          <PracticeHistory sessions={shown} />
        </>
      )}
      <NewPracticeSheet open={creating} onClose={() => setCreating(false)} from={from} {...(journeyId ? { journeyId } : {})} />
    </section>
  );
}
