import { useState } from 'react';
import type { Commitment, DayKey, Mission } from '@life/shared';
import { addDays, describeRecurrence, nextOccurrence } from '@life/shared';
import { useCommitments, useMissions } from '../../db/hooks';
import { WEEKDAY_ABBR, formatDay } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { CommitmentSheet } from '../plan/CommitmentSheet';
import { useMissionSheet } from '../mission/MissionSheet';

const EMPTY_TEXT =
  'Nada se repete ainda. Na captura, escreva por exemplo “lavar roupa toda seg”, ou use Repetir na ficha da missão.';

/** First day on or after `today` the mission comes up: its own date, or the next occurrence of the rule. */
function nextDay(m: Mission, today: DayKey): DayKey {
  if (m.date !== undefined && m.date >= today) return m.date;
  return nextOccurrence(m.recurrence!, undefined, addDays(today, -1));
}

const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, 'pt-BR');

function daysText(weekdays: number[]): string {
  if (weekdays.length === 7) return 'todo dia';
  return [...new Set(weekdays)].sort((a, b) => a - b).map((d) => WEEKDAY_ABBR[d]).join(', ');
}

/** Planejar → Rotina → "Recorrentes": what repeats (recurring missions and weekly commitments) in one place. */
export function RecurringSection({ today }: { today: DayKey }) {
  const missions = useMissions();
  const commitments = useCommitments();
  const [commitment, setCommitment] = useState<Commitment>();

  const recurring = missions
    .filter((m) => m.recurrence !== undefined && m.status !== 'done' && m.status !== 'dropped')
    .sort(byTitle);
  const weekly = commitments
    .filter((c) => (c.weekdays?.length ?? 0) > 0 && (c.untilDate === undefined || c.untilDate >= today))
    .sort(byTitle);

  return (
    <section className="recurring stack" aria-labelledby="recurring-title">
      <h3 id="recurring-title" className="recurring__title">Recorrentes</h3>
      {recurring.length === 0 && weekly.length === 0 && <p className="day-box__empty">{EMPTY_TEXT}</p>}

      {recurring.length > 0 && (
        <div className="recurring__group">
          <h4 className="recurring__subtitle">Missões que repetem</h4>
          <ul className="today__list" aria-label="Missões que repetem">
            {recurring.map((m) => {
              const rule = `Repete ${describeRecurrence(m.recurrence!)}`;
              const next = nextDay(m, today);
              const when = `próxima: ${formatDay(next, today)}`;
              return (
                <li key={m.id} className="row-card row-card--plain">
                  <button type="button" className="row-card__main recurring__item" aria-label={`${m.title}, ${rule}, ${when}`}
                    onClick={() => safeRun(() => useMissionSheet.getState().open(m.id))}>
                    <span className="row-card__body">
                      <span className="row-card__title">{m.title}</span>
                      <span className="row-card__sub">{rule} · {when}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {weekly.length > 0 && (
        <div className="recurring__group">
          <h4 className="recurring__subtitle">Compromissos semanais</h4>
          <ul className="today__list" aria-label="Compromissos semanais">
            {weekly.map((c) => {
              const detail = `${daysText(c.weekdays!)} · ${c.start}–${c.end}`;
              return (
                <li key={c.id} className="row-card row-card--plain">
                  <button type="button" className="row-card__main recurring__item" aria-label={`${c.title}, ${detail}`}
                    onClick={() => setCommitment(c)}>
                    <span className="row-card__body">
                      <span className="row-card__title">{c.title}</span>
                      <span className="row-card__sub">{detail}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <CommitmentSheet open={commitment !== undefined} commitment={commitment} defaultDate={today}
        onClose={() => setCommitment(undefined)} />
    </section>
  );
}
