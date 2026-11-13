import { useState } from 'react';
import { Link } from 'wouter';
import type { ID, Journey, PracticeSession } from '@life/shared';
import type { DayKey } from '@life/shared';
import { hintCount, ratingsLine } from '@life/shared';
import { useJourneys, useNow, useToday } from '../../db/hooks';
import { Button } from '../../ui/Button';
import { Panel } from '../../ui/Panel';
import { NewPracticeSheet } from './NewPracticeSheet';
import { doneMeta, openMeta, usePracticeSessions } from './practiceData';
import './practice.css';

const SHOWN = 3;

/** "Pistas: 2" / "Pistas: nenhuma" (P7): observed data, no score, no colour. */
export const hintsLabel = (s: PracticeSession): string => {
  const n = hintCount(s);
  return n === 0 ? 'Pistas: nenhuma' : `Pistas: ${n}`;
};

/** One session in a list: title, then the meta line (and the next action, or the three ratings). */
export function PracticeRow({ session, journeys, now, from, today }: {
  session: PracticeSession; journeys: readonly Journey[]; now: number; from: string; today?: DayKey;
}) {
  const open = session.status === 'open';
  return (
    <li>
      <Link className="study-list__item practice-row" href={`/pratica/${session.id}?voltar=${encodeURIComponent(from)}`}>
        <span className="practice-row__title">{session.title}</span>{' '}
        <span className="practice-row__meta">{open ? openMeta(session, journeys, now, today) : doneMeta(session, journeys)}</span>{' '}
        {open && session.nextAction && <span className="practice-row__next">Próxima ação: {session.nextAction}</span>}
        {!open && <span className="practice-row__meta">{ratingsLine(session.ratings)}</span>}{' '}
        {!open && <span className="practice-row__meta">{hintsLabel(session)}</span>}
      </Link>
    </li>
  );
}

/** "Prática técnica" on the Estudo tab (spec §5.5): Nova sessão, up to 3 open sessions, Ver todas. */
export function PracticePanel() {
  const sessions = usePracticeSessions();
  const journeys = useJourneys();
  const now = useNow();
  const today = useToday();
  const [creating, setCreating] = useState(false);
  if (sessions === undefined) return null;
  const open = sessions.filter((s) => s.status === 'open').slice(0, SHOWN);
  return (
    <Panel variant="stone" className="study-section">
      <div className="study__head">
        <h2 className="study__subtitle">Prática técnica</h2>
        <div className="study__actions">
          <Button size="sm" icon="plus" onClick={() => setCreating(true)}>Nova sessão</Button>
        </div>
      </div>
      {sessions.length === 0 ? (
        <p className="muted">Pratique no seu método: problema, passos, código, testes e reconstruir sem consultar.</p>
      ) : (
        <>
          {open.length > 0 && (
            <ul className="study-list">
              {open.map((s) => <PracticeRow key={s.id} session={s} journeys={journeys} now={now} from="/estudo" {...(today ? { today } : {})} />)}
            </ul>
          )}
          <Link className="practice-panel__all" href="/estudo/praticas">Ver todas</Link>
        </>
      )}
      <NewPracticeSheet open={creating} onClose={() => setCreating(false)} from="/estudo" />
    </Panel>
  );
}

/** Journey detail (spec §5.7): its practice sessions, in the filtered list. */
export function JourneyPracticeLink({ journeyId }: { journeyId: ID }) {
  const sessions = usePracticeSessions();
  if (sessions === undefined) return null;
  const mine = sessions.filter((s) => s.journeyId === journeyId);
  const open = mine.filter((s) => s.status === 'open').length;
  const done = mine.length - open;
  const counts = mine.length === 0 ? 'nenhuma ainda' : `${open} em aberto · ${done} ${done === 1 ? 'encerrada' : 'encerradas'}`;
  return (
    <p className="journey-practice">
      <Link href={`/estudo/praticas?jornada=${encodeURIComponent(journeyId)}`}>Sessões de prática</Link>
      <span className="muted"> · {counts}</span>
    </p>
  );
}
