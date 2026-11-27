import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'wouter';
import type { DayKey, GoalProgress, ID, WeekStats } from '@life/shared';
import { GOAL_PROGRESS, GOAL_PROGRESS_LABEL, addDays, dueLine, dueStrategies, goalWeekLine } from '@life/shared';
import { useStrategies } from '../../db/strategyData';
import { saveWeekReview, setObjectives } from '../../domain/actions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { focusWhenGone } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import { safeRun } from '../../ui/safeRun';
import { useCompanion } from '../companion/store';
import { useWatchNotices } from '../patterns/patternData';
import { WatchNotice } from '../patterns/WatchNotice';
import { AtypicalWeekSheet } from '../plan/AtypicalWeekSheet';
import { firstShowOfWeek, readReviewDraft, readReviewGoals, readReviewSuggested, writeReviewDraft, type ReviewDraft } from './weekCycle';
import { observedRows, useWeekCardData, type WeekGoal } from './weekData';
import { WeekAiSummary } from './WeekAiSummary';
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

/** Weeks 5–8 notices, compact, under last week's numbers (spec §5.5). Mounted only while step 1 is on screen. */
function WatchLines({ onUse }: { onUse(text: string): void }) {
  const notices = useWatchNotices();
  if (!notices?.length) return null;
  return <>{notices.map((n) => <WatchNotice key={n.key} notice={n} variant="compact" onUse={onUse} />)}</>;
}

/** "Hora de decidir" of the strategies whose decision day came (Decisão 9): one line and the link, never a demand. */
function DueStrategies({ today }: { today: DayKey }) {
  const list = useStrategies();
  const due = list ? dueStrategies(list, today) : [];
  if (due.length === 0) return null;
  return (
    <p className="week-card__note">
      <span>{dueLine(due.map((s) => s.title))}</span>{' '}
      <Link href="/diario/estrategias">Decidir em Estratégias</Link>
    </p>
  );
}

/** Step 1: last week as observed numbers, then the user's own reading (hypotheses). */
function ReviewStep({ weekId, stats, experiment, goals, onSave, onLater }: {
  weekId: DayKey; stats: WeekStats; experiment?: string; goals: WeekGoal[];
  onSave(a: ReviewDraft, suggested: string[], goals: Record<ID, GoalProgress>): Promise<void>; onLater(e: MouseEvent<HTMLButtonElement>): void;
}) {
  // A draft per week, so "Fazer depois" or leaving the screen loses nothing.
  const [answers, setAnswers] = useState<ReviewDraft>(() => {
    const draft = readReviewDraft(weekId);
    return draft.adjustment || !experiment ? draft : { ...draft, adjustment: experiment };
  });
  // The old experiment that prefills the field came from Padrões; "Usar no ajuste" texts too.
  const [suggested, setSuggested] = useState<string[]>(() => [...new Set([...readReviewSuggested(weekId), ...(experiment ? [experiment] : [])])]);
  // The stored draft carries these lines too; the ref is what the next write sees.
  const suggestedRef = useRef(suggested);
  suggestedRef.current = suggested;
  // "Avançou?" taps: kept with the draft, saved only for the goals he tapped.
  const [picks, setPicks] = useState<Record<ID, GoalProgress>>(() => readReviewGoals(weekId));
  const picksRef = useRef(picks);
  picksRef.current = picks;
  const goalsId = useId();
  const [saving, setSaving] = useState(false);
  const observedId = useId();
  const readingId = useId();
  const fieldId = useId();

  // The typed answers too: every write path saves the latest of all three through refs.
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const change = (key: keyof ReviewDraft, value: string) => setAnswers((a) => {
    const next = { ...a, [key]: value };
    answersRef.current = next;
    writeReviewDraft(weekId, next, suggestedRef.current, picksRef.current);
    return next;
  });
  /** "Usar no ajuste": adds the suggestion under what is already there, never replacing it. */
  const useInAdjustment = (t: string) => {
    const lines = suggestedRef.current.includes(t) ? suggestedRef.current : [...suggestedRef.current, t];
    suggestedRef.current = lines;
    setSuggested(lines);
    setAnswers((a) => {
      const prev = a.adjustment.trim();
      if (prev.includes(t)) return a;
      const next = { ...a, adjustment: prev ? `${prev}\n${t}` : t };
      writeReviewDraft(weekId, next, lines, picksRef.current);
      return next;
    });
    document.getElementById(`${fieldId}-adjustment`)?.focus();
  };
  /** Tapping picks; tapping the picked one again clears it. */
  const pick = (goalId: ID, p: GoalProgress) => {
    const next = { ...picksRef.current };
    if (next[goalId] === p) delete next[goalId];
    else next[goalId] = p;
    picksRef.current = next;
    setPicks(next);
    writeReviewDraft(weekId, answersRef.current, suggestedRef.current, next);
  };
  const save = (e: MouseEvent<HTMLButtonElement>) => {
    toStep(e);
    setSaving(true);
    safeRun(onSave(answers, suggested, picks).then(() => writeReviewDraft(weekId, undefined)).finally(() => setSaving(false)));
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
        <WatchLines onUse={useInAdjustment} />
      </section>

      {goals.length > 0 && (
        <section className="week-card__section" aria-labelledby={goalsId}>
          <h3 id={goalsId} className="week-card__subtitle">Avançou nos seus objetivos?</h3>
          <p className="week-card__note">Na semana passada, do seu jeito. Tudo opcional.</p>
          {goals.map(({ goal, counts }) => (
            <fieldset key={goal.id} className="week-goal">
              <legend className="field__label">{goal.title}</legend>
              <p className="week-card__note">{goalWeekLine(counts)}</p>
              <div className="cluster">
                {GOAL_PROGRESS.map((p) => (
                  <Chip key={p} selected={picks[goal.id] === p} onClick={() => pick(goal.id, p)}>{GOAL_PROGRESS_LABEL[p]}</Chip>
                ))}
              </div>
            </fieldset>
          ))}
        </section>
      )}

      <section className="week-card__section" aria-labelledby={readingId}>
        <h3 id={readingId} className="week-card__subtitle">Sua leitura</h3>
        <p className="week-card__note">Hipóteses, tudo opcional. Cada linha do ajuste vira uma estratégia em teste (Diário → Estratégias).</p>
        {QUESTIONS.map((q) => (
          <label key={q.key} className="field" htmlFor={`${fieldId}-${q.key}`}>
            <span className="field__label week-card__question">{q.label}</span>
            <textarea id={`${fieldId}-${q.key}`} rows={2} value={answers[q.key]} onChange={(e) => change(q.key, e.target.value)} />
          </label>
        ))}
      </section>

      <WeekAiSummary weekId={weekId} statsWeek={addDays(weekId, -7)} facts={observedRows(stats)} reading={answers} />

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
}

/**
 * "Nova semana" (§8, Monday morning): 1) last week, observed — numbers apart from the user's
 * reading, whose adjustment becomes the week's experiment; 2) 1–3 objectives per main block.
 */
export function WeekCard({ today, weekId, collapsed = false, onStart, onLater, onDone }: WeekCardProps) {
  const data = useWeekCardData(today, weekId);
  const [step, setStep] = useState<'review' | 'objectives'>();
  const [atypicalOpen, setAtypicalOpen] = useState(false);
  const headingId = useId();
  // Nothing to look back on and no block to aim at: nothing to ask.
  const empty = !!data && !data.stats && data.groups.length === 0;

  useEffect(() => {
    if (data && !empty && firstShowOfWeek(weekId)) void useCompanion.getState().say('weekStart');
  }, [data, empty, weekId]);

  if (!data) return null;
  if (empty) return null;

  const current = step ?? (data.stats && !data.review ? 'review' : 'objectives');
  const steps = data.stats ? 2 : 1;
  /** Fazer depois / Concluir take the card away: focus goes to the block (or the screen) heading. */
  const later = (e: MouseEvent<HTMLButtonElement>) => {
    focusWhenGone(e.currentTarget);
    onLater();
  };

  const saveReview = async (a: ReviewDraft, suggested: string[], picks: Record<ID, GoalProgress>) => {
    const shown = new Set(data.goals.map((g) => g.goal.id));
    const goals = Object.fromEntries(Object.entries(picks).filter(([id]) => shown.has(id)));
    await saveWeekReview(weekId, {
      worked: a.worked.trim(), obstacle: a.obstacle.trim(), adjustment: a.adjustment.trim(),
      ...(Object.keys(goals).length > 0 ? { goals } : {}),
    }, { suggested });
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
      {data.lastAtypical && !data.atypical && (!data.lastAtypical.returnDay || data.lastAtypical.returnDay <= today) && (
        <p className="week-card__note">
          {`A semana passada foi atípica (${data.lastAtypical.reason}). Bem-vindo de volta: começar pelas versões mínimas vale.`}
        </p>
      )}
      {!collapsed && (
        <Button size="sm" variant="ghost" className="week-card__atypical" onClick={() => setAtypicalOpen(true)}>
          {data.atypical ? `Semana atípica (${data.atypical.reason}): mudar` : 'Esta semana vai ser atípica?'}
        </Button>
      )}
      {!collapsed && <DueStrategies today={today} />}
      <AtypicalWeekSheet open={atypicalOpen} onClose={() => setAtypicalOpen(false)} weekId={weekId} current={data.atypical} />
      {collapsed ? null : current === 'review' && data.stats ? (
        <ReviewStep weekId={weekId} stats={data.stats} experiment={data.experiment} goals={data.goals} onSave={saveReview} onLater={later} />
      ) : (
        <WeekObjectives groups={data.groups} carry={data.carry} onDone={saveObjectives} onLater={later} />
      )}
    </Panel>
  );
}
