import { useEffect, useId, useState, type MouseEvent, type ReactNode } from 'react';
import type { DayKey, WeekStats } from '@life/shared';
import { saveWeekReview, setObjectives } from '../../domain/actions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import { safeRun } from '../../ui/safeRun';
import { useCompanion } from '../companion/store';
import { firstShowOfWeek, readReviewDraft, writeReviewDraft, type ReviewDraft } from './weekCycle';
import { observedRows, useWeekCardData } from './weekData';
import { WeekObjectives, type NewObjective } from './WeekObjectives';
import './week.css';

const QUESTIONS = [
  { key: 'worked', label: 'O que funcionou?' },
  { key: 'obstacle', label: 'Qual foi o maior obstáculo?' },
  { key: 'adjustment', label: 'Que ajuste você quer testar?' },
] as const;

/** The heading of the step on screen (focus goes there when the step changes). */
const stepHeading = () => document.querySelector<HTMLElement>('[data-week-step]');
/** When the tapped button goes away, focus moves to the new step's heading. */
const toStep = (e: MouseEvent<HTMLElement>) => focusWhenGone(e.currentTarget, stepHeading);

/** Step 1: last week as observed numbers, then the user's own reading (hypotheses). */
function ReviewStep({ weekId, stats, onSave, onLater }: {
  weekId: DayKey; stats: WeekStats; onSave(a: ReviewDraft): Promise<void>; onLater(e: MouseEvent<HTMLButtonElement>): void;
}) {
  // A draft per week, so "Fazer depois" or leaving the screen loses nothing.
  const [answers, setAnswers] = useState<ReviewDraft>(() => readReviewDraft(weekId));
  const [saving, setSaving] = useState(false);
  const observedId = useId();
  const readingId = useId();
  const fieldId = useId();

  const change = (key: keyof ReviewDraft, value: string) => setAnswers((a) => {
    const next = { ...a, [key]: value };
    writeReviewDraft(weekId, next);
    return next;
  });
  const save = (e: MouseEvent<HTMLButtonElement>) => {
    toStep(e);
    setSaving(true);
    safeRun(onSave(answers).then(() => writeReviewDraft(weekId, undefined)).finally(() => setSaving(false)));
  };

  return (
    <>
      <section className="week-card__section" aria-labelledby={observedId}>
        <h3 id={observedId} className="week-card__subtitle" tabIndex={-1} data-week-step="">Observado</h3>
        <p className="week-card__note">Números da semana passada, sem julgamento.</p>
        <dl className="week-stats">
          {observedRows(stats).map((r) => (
            <div key={r.label} className="week-stat">
              <dt className="week-stat__label">{r.label}</dt>
              <dd className="week-stat__value">{r.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="week-card__section" aria-labelledby={readingId}>
        <h3 id={readingId} className="week-card__subtitle">Sua leitura</h3>
        <p className="week-card__note">Hipóteses, tudo opcional. O ajuste vira o experimento da semana.</p>
        {QUESTIONS.map((q) => (
          <label key={q.key} className="field" htmlFor={`${fieldId}-${q.key}`}>
            <span className="field__label week-card__question">{q.label}</span>
            <textarea id={`${fieldId}-${q.key}`} rows={2} value={answers[q.key]} onChange={(e) => change(q.key, e.target.value)} />
          </label>
        ))}
      </section>

      <div className="week-card__actions">
        <Button variant="primary" disabled={saving} onClick={save}>Salvar e continuar</Button>
        <Button variant="ghost" onClick={onLater}>Fazer depois</Button>
      </div>
    </>
  );
}

export interface WeekCardProps {
  today: DayKey;
  /** Monday of the current week. */
  weekId: DayKey;
  /** One line ("Nova semana · ~2 min") with Começar / Fazer depois, until Começar. */
  collapsed?: boolean;
  onStart?(): void;
  /** "Fazer depois": hidden for this app session. */
  onLater(): void;
  /** Objectives saved: the cycle is done for the week. */
  onDone(): void;
  /** Shown instead when there is nothing to ask (the next morning card in line). */
  fallback?: ReactNode;
}

/**
 * "Nova semana" (§8, Monday morning): 1) last week, observed — numbers apart from the user's
 * reading, whose adjustment becomes the week's experiment; 2) 1–3 objectives per main block.
 */
export function WeekCard({ today, weekId, collapsed = false, onStart, onLater, onDone, fallback = null }: WeekCardProps) {
  const data = useWeekCardData(today, weekId);
  const [step, setStep] = useState<'review' | 'objectives'>();
  const headingId = useId();
  // Nothing to look back on and no block to aim at: nothing to ask.
  const empty = !!data && !data.stats && data.groups.length === 0;

  useEffect(() => {
    if (data && !empty && firstShowOfWeek(weekId)) void useCompanion.getState().say('weekStart');
  }, [data, empty, weekId]);

  if (!data) return null;
  if (empty) return <>{fallback}</>;

  const current = step ?? (data.stats && !data.review ? 'review' : 'objectives');
  const steps = data.stats ? 2 : 1;
  /** Fazer depois / Concluir take the card away: focus goes to the block (or the screen) heading. */
  const later = (e: MouseEvent<HTMLButtonElement>) => {
    focusWhenGone(e.currentTarget);
    onLater();
  };

  const saveReview = async (a: ReviewDraft) => {
    await saveWeekReview(weekId, {
      worked: a.worked.trim(), obstacle: a.obstacle.trim(), adjustment: a.adjustment.trim(),
    });
    if (data.groups.length === 0) onDone();
    else setStep('objectives');
  };
  const saveObjectives = async (list: NewObjective[]) => {
    await setObjectives(weekId, list);
    onDone();
  };

  return (
    <Panel variant="stone" role="region" aria-labelledby={headingId}
      className={`week-card px-border--gold${collapsed ? ' week-card--collapsed' : ''}`}>
      <div className="week-card__head">
        <h2 id={headingId} className="week-card__title">Nova semana</h2>
        {collapsed ? (
          <>
            <span className="week-card__step"><span aria-hidden="true">· </span>~2 min</span>
            <div className="week-card__head-actions">
              <Button size="sm" variant="primary" onClick={(e) => { toStep(e); onStart?.(); }}>Começar</Button>
              <Button size="sm" variant="ghost" onClick={later}>Fazer depois</Button>
            </div>
          </>
        ) : steps > 1 && (
          <span className="week-card__step">{`Passo ${current === 'review' ? 1 : 2} de 2`}</span>
        )}
      </div>
      {collapsed ? null : current === 'review' && data.stats ? (
        <ReviewStep weekId={weekId} stats={data.stats} onSave={saveReview} onLater={later} />
      ) : (
        <WeekObjectives groups={data.groups} carry={data.carry} onDone={saveObjectives} onLater={later} />
      )}
    </Panel>
  );
}
