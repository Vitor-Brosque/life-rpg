import { useId, useState } from 'react';
import type { DayKey, WeekStats } from '@life/shared';
import { saveWeekReview, setObjectives } from '../../domain/actions';
import { Button } from '../../ui/Button';
import { Panel } from '../../ui/Panel';
import { safeRun } from '../../ui/safeRun';
import { observedRows, useWeekCardData } from './weekData';
import { WeekObjectives, type NewObjective } from './WeekObjectives';
import './week.css';

const QUESTIONS = [
  { key: 'worked', label: 'O que funcionou?' },
  { key: 'obstacle', label: 'Qual foi o maior obstáculo?' },
  { key: 'adjustment', label: 'Que ajuste você quer testar?' },
] as const;
type Answers = Record<(typeof QUESTIONS)[number]['key'], string>;

/** Step 1: last week as observed numbers, then the user's own reading (hypotheses). */
function ReviewStep({ stats, onSave, onLater }: {
  stats: WeekStats; onSave(a: Answers): Promise<void>; onLater(): void;
}) {
  const [answers, setAnswers] = useState<Answers>({ worked: '', obstacle: '', adjustment: '' });
  const [saving, setSaving] = useState(false);
  const observedId = useId();
  const readingId = useId();
  const fieldId = useId();

  const save = () => {
    setSaving(true);
    safeRun(onSave(answers).finally(() => setSaving(false)));
  };

  return (
    <>
      <section className="week-card__section" aria-labelledby={observedId}>
        <h3 id={observedId} className="week-card__subtitle">Observado</h3>
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
            <textarea
              id={`${fieldId}-${q.key}`}
              rows={2}
              value={answers[q.key]}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
            />
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
  /** "Fazer depois": hidden for this app session. */
  onLater(): void;
  /** Objectives saved: the cycle is done for the week. */
  onDone(): void;
}

/**
 * "Nova semana" (§8, Monday morning): 1) last week, observed — numbers apart from the user's
 * reading, whose adjustment becomes the week's experiment; 2) 1–3 objectives per main block.
 */
export function WeekCard({ today, weekId, onLater, onDone }: WeekCardProps) {
  const data = useWeekCardData(today, weekId);
  const [step, setStep] = useState<'review' | 'objectives'>();
  const headingId = useId();
  // Nothing to look back on and no block to aim at: nothing to ask.
  if (!data || (!data.stats && data.groups.length === 0)) return null;

  const current = step ?? (data.stats && !data.review ? 'review' : 'objectives');
  const steps = data.stats ? 2 : 1;

  const saveReview = async (a: Answers) => {
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
    <Panel variant="stone" role="region" aria-labelledby={headingId} className="week-card px-border--gold">
      <div className="week-card__head">
        <h2 id={headingId} className="week-card__title">Nova semana</h2>
        {steps > 1 && (
          <span className="week-card__step">{`Passo ${current === 'review' ? 1 : 2} de 2`}</span>
        )}
      </div>
      {current === 'review' && data.stats ? (
        <ReviewStep stats={data.stats} onSave={saveReview} onLater={onLater} />
      ) : (
        <WeekObjectives groups={data.groups} carry={data.carry} onDone={saveObjectives}
          onLater={data.review ? undefined : onLater} />
      )}
    </Panel>
  );
}
