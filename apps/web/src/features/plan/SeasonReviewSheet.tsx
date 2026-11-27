import { useId, useMemo, useState } from 'react';
import type { DayKey, Season, SeasonAnswers } from '@life/shared';
import { SEASON_QUESTIONS, goalAnswers, goalTally, seasonObserved, seasonSkippedNote, sortedGoals, weekKey } from '@life/shared';
import { useGoals } from '../../db/goalData';
import { endSeasonReview } from '../../domain/seasonActions';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { usePatternData } from '../patterns/patternData';
import '../week/week.css';
import './plan.css';

const ddmm = (day: DayKey): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const DRAFT_PREFIX = 'life-rpg-season-draft:';
const EMPTY: SeasonAnswers = { progress: '', obstacle: '', next: '' };

/** The answers typed on this device and not saved yet ("Agora não" keeps them). */
function readSeasonDraft(id: string): SeasonAnswers {
  try {
    const p: unknown = JSON.parse(localStorage.getItem(DRAFT_PREFIX + id) ?? 'null');
    if (!p || typeof p !== 'object') return EMPTY;
    const text = (v: unknown) => (typeof v === 'string' ? v : '');
    const o = p as Partial<Record<keyof SeasonAnswers, unknown>>;
    return { progress: text(o.progress), obstacle: text(o.obstacle), next: text(o.next) };
  } catch {
    return EMPTY;
  }
}

function writeSeasonDraft(id: string, answers: SeasonAnswers | undefined): void {
  try {
    if (answers && (answers.progress || answers.obstacle || answers.next)) localStorage.setItem(DRAFT_PREFIX + id, JSON.stringify(answers));
    else localStorage.removeItem(DRAFT_PREFIX + id);
  } catch { /* private mode / quota: the draft just stays in memory */ }
}

export interface SeasonReviewSheetProps {
  /** The season under review (the sheet is open while set). */
  season?: Season;
  today: DayKey;
  onClose(): void;
  /** Called once the season was ended (the card goes away). */
  onEnded(): void;
}

/** "Rever temporada": the season's observed numbers, three optional questions, "Encerrar temporada". */
export function SeasonReviewSheet({ season, today, onClose, onEnded }: SeasonReviewSheetProps) {
  return (
    <Sheet open={season !== undefined} onClose={onClose} title="Rever temporada">
      {season && <SeasonReviewForm key={season.id} season={season} today={today} onClose={onClose} onEnded={onEnded} />}
    </Sheet>
  );
}

function SeasonReviewForm({ season, today, onClose, onEnded }: Required<SeasonReviewSheetProps>) {
  const data = usePatternData(true);
  const goals = useGoals();
  const observed = useMemo(() => (data ? seasonObserved(data, season) : undefined), [data, season]);
  const tallies = useMemo(() => (data && goals ? sortedGoals(goals).flatMap((g) => {
    // Only answers about weeks of the season: an answer given on the start day about the week before it is out.
    const firstWeek = weekKey(season.startDay);
    const t = goalTally(goalAnswers(data.weeks, g.id, { from: season.startDay, to: today }, data.dayStartHour)
      .filter((a) => a.week >= firstWeek));
    return t ? [`${g.title}: ${t}`] : [];
  }) : []), [data, goals, season.startDay, today]);
  const [answers, setAnswers] = useState<SeasonAnswers>(() => readSeasonDraft(season.id));
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const id = useId();
  const skipped = observed ? seasonSkippedNote(observed) : undefined;

  const change = (key: keyof SeasonAnswers, value: string) => setAnswers((a) => {
    const next = { ...a, [key]: value };
    writeSeasonDraft(season.id, next);
    return next;
  });
  const end = () => {
    setBusy(true);
    setConflict(false);
    safeRun(endSeasonReview(season.id, answers).then((result) => {
      if (result === 'conflict') {
        setConflict(true);   // nothing written; his text stays here
        return;
      }
      writeSeasonDraft(season.id, undefined);
      const toast = useToast.getState();
      if (result === 'ended') {
        toast.show('Temporada encerrada. Quando quiser, comece outra.');
        onEnded();
      } else if (result === 'kept') {
        toast.show('A temporada já estava encerrada. Sua revisão foi guardada.');
        onEnded();
      } else if (result === 'already') {
        toast.show('A temporada já estava encerrada.');
        onEnded();
      }
      onClose();
    }).finally(() => setBusy(false)));
  };

  return (
    <div className="season-review stack">
      <p className="muted">{`${season.title} · desde ${ddmm(season.startDay)}. Tudo opcional.`}</p>
      <section className="week-card__section" aria-labelledby={`${id}-observed`}>
        <h3 id={`${id}-observed`} className="week-card__subtitle">Observado</h3>
        <p className="week-card__note">Semanas da temporada até ontem, sem as atípicas. Números, sem julgamento.</p>
        {!observed ? (
          <p className="muted" aria-busy="true">Carregando…</p>
        ) : observed.lines.length === 0 ? (
          <p className="muted">Nada registrado nas semanas da temporada.</p>
        ) : (
          <dl className="week-stats">
            {observed.lines.map((r) => (
              <div key={r.label} className="week-stat">
                <dt className="week-stat__label">{r.label}</dt>
                <dd className="week-stat__value">{r.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {skipped && <p className="week-card__note">{skipped}</p>}
      </section>
      <section className="week-card__section" aria-labelledby={`${id}-reading`}>
        <h3 id={`${id}-reading`} className="week-card__subtitle">Sua leitura</h3>
        {tallies.length > 0 && (
          <>
            <p className="week-card__note">Suas respostas ao &quot;Avançou?&quot; nas semanas da temporada</p>
            <ul className="season-review__goals">{tallies.map((t) => <li key={t}>{t}</li>)}</ul>
          </>
        )}
        {SEASON_QUESTIONS.map((q) => (
          <label key={q.key} className="field" htmlFor={`${id}-${q.key}`}>
            <span className="field__label">{q.label}</span>
            <textarea id={`${id}-${q.key}`} rows={3} value={answers[q.key]} onChange={(e) => change(q.key, e.target.value)} />
          </label>
        ))}
      </section>
      <p className="week-card__note" aria-live="polite">
        {conflict ? 'Esta temporada já foi encerrada com uma revisão em outro aparelho. O que você escreveu continua aqui: copie o que quiser guardar.' : ''}
      </p>
      <div className="cluster">
        <Button variant="primary" disabled={busy} onClick={end}>Encerrar temporada</Button>
        <Button variant="ghost" onClick={onClose}>Agora não</Button>
      </div>
    </div>
  );
}
