import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import type { BlockWeek, PlannedExercise, TrainingBlock, TrainingDay, TrainingPlan } from '@life/shared';
import {
  BLOCK_WEEKS_MAX, EXERCISE_NAME_MAX, EXERCISES_MAX, FIVE_DAY_SPLIT, PLAN_ISSUE_TEXT, PLAN_NOTE_MAX, PLANNED_SETS_MAX,
  REST_MAX_SEC, REST_MIN_SEC, REST_PRESETS, RIR_MAX, TRAINING_NAME_MAX, WEEKDAY_NAMES, capitalize, planIssues, rirValueText,
} from '@life/shared';
import { useTrainingPlan } from '../../db/corpoData';
import { useToday } from '../../db/hooks';
import { TrainingValidationError, saveTrainingPlan } from '../../domain/trainingActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { FAILURE_TOAST } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import './corpo.css';

const ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** Rest choice of the editor: a preset (index), none, or "Outro" with its own minimum and maximum (seconds). */
type RestChoice = `p${number}` | 'none' | 'other';
interface DraftExercise {
  key: number; name: string; sets: string; repsMin: string; repsMax: string;
  rest: RestChoice; restMin: string; restMax: string; note: string;
}
interface DraftDay { name: string; exercises: DraftExercise[] }
type Draft = Record<number, DraftDay>;
interface DraftWeek { rirMin: number; rirMax: number; cardioMin: string; cardioMax: string }
interface DraftBlock { startDay: string; weeks: DraftWeek[] }

let nextKey = 1;
const str = (n: number | undefined): string => (n === undefined ? '' : String(n));

function restChoiceOf(p: PlannedExercise): RestChoice {
  if (p.restMinSec === undefined) return 'none';
  const i = REST_PRESETS.findIndex((r) => r.min === p.restMinSec && r.max === p.restMaxSec);
  return i >= 0 ? `p${i}` : 'other';
}

const draftExercise = (p?: PlannedExercise): DraftExercise => ({
  key: nextKey++, name: p?.name ?? '', sets: str(p?.sets), repsMin: str(p?.repsMin), repsMax: str(p?.repsMax),
  rest: p ? restChoiceOf(p) : 'none', restMin: str(p?.restMinSec), restMax: str(p?.restMaxSec), note: p?.note ?? '',
});

const draftOf = (days: readonly TrainingDay[]): Draft => Object.fromEntries(ORDER.map((wd) => {
  const d = days.find((x) => x.weekday === wd);
  return [wd, { name: d?.name ?? '', exercises: (d?.exercises ?? []).map(draftExercise) }];
}));

const blockDraftOf = (b: TrainingBlock | undefined): DraftBlock | null => (b ? {
  startDay: b.startDay,
  weeks: b.weeks.map((w) => ({ rirMin: w.rirMin, rirMax: w.rirMax, cardioMin: str(w.cardioMin), cardioMax: str(w.cardioMax) })),
} : null);

/** '' → undefined; anything else → a number (an invalid one is refused by planIssues / blockIssue, never fixed). */
const num = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s.trim().replace(',', '.')));

function plannedOfDraft(e: DraftExercise): PlannedExercise {
  const rest = e.rest === 'none' ? {}
    : e.rest === 'other' ? { restMinSec: num(e.restMin), restMaxSec: num(e.restMax) }
      : { restMinSec: REST_PRESETS[Number(e.rest.slice(1))]!.min, restMaxSec: REST_PRESETS[Number(e.rest.slice(1))]!.max };
  const out: PlannedExercise = { name: e.name, sets: num(e.sets), repsMin: num(e.repsMin), repsMax: num(e.repsMax), ...rest, note: e.note };
  for (const k of Object.keys(out) as (keyof PlannedExercise)[]) if (out[k] === undefined) delete out[k];
  return out;
}

const daysOfDraft = (draft: Draft): TrainingDay[] =>
  ORDER.map((wd) => ({ weekday: wd, name: draft[wd]!.name, exercises: draft[wd]!.exercises.map(plannedOfDraft) }));

function blockOfDraft(b: DraftBlock): TrainingBlock {
  return {
    startDay: b.startDay,
    weeks: b.weeks.map((w): BlockWeek => {
      const lo = num(w.cardioMin);
      const hi = num(w.cardioMax);
      return { rirMin: w.rirMin, rirMax: w.rirMax, ...(lo !== undefined ? { cardioMin: lo } : {}), ...(hi !== undefined ? { cardioMax: hi } : {}) };
    }),
  };
}

/** "/corpo/plano": the week's plan, one fieldset per day, and the optional block. Only "Salvar plano" writes. */
export function TrainingPlanScreen() {
  const plan = useTrainingPlan();
  return (
    <section className="screen training stack" aria-labelledby="plan-title">
      <Link href="/corpo" className="settings__back">‹ Corpo</Link>
      <h1 id="plan-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Plano de treino</h1>
      {plan !== undefined && <PlanForm plan={plan} />}
    </section>
  );
}

function PlanForm({ plan }: { plan: TrainingPlan | null }) {
  const [, navigate] = useLocation();
  const today = useToday();
  const [draft, setDraft] = useState<Draft>(() => draftOf(plan?.days ?? []));
  const [block, setBlock] = useState<DraftBlock | null>(() => blockDraftOf(plan?.block));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const issues = planIssues(daysOfDraft(draft));

  const setDay = (wd: number, patch: Partial<DraftDay>) => { setDraft((d) => ({ ...d, [wd]: { ...d[wd]!, ...patch } })); setError(undefined); };
  const setExercise = (wd: number, key: number, patch: Partial<DraftExercise>) =>
    setDay(wd, { exercises: draft[wd]!.exercises.map((e) => (e.key === key ? { ...e, ...patch } : e)) });
  const move = (wd: number, index: number, by: -1 | 1) => {
    const list = [...draft[wd]!.exercises];
    const [item] = list.splice(index, 1);
    list.splice(index + by, 0, item!);
    setDay(wd, { exercises: list });
  };

  const save = async () => {
    if (issues.length > 0) { setError('Corrija os campos marcados antes de salvar.'); return; }
    setBusy(true);
    try {
      await saveTrainingPlan(daysOfDraft(draft), block ? blockOfDraft(block) : null);
      useToast.getState().show('Plano de treino salvo.');
      navigate('/corpo');
    } catch (err) {
      if (err instanceof TrainingValidationError) setError(err.message);
      else { console.error('training plan save failed', err); useToast.getState().show(FAILURE_TOAST); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p>Para cada dia, o nome do treino e os exercícios. Séries, repetições, descanso e observação são opcionais. Dia vazio fica como descanso da musculação.</p>
      {!plan && (
        <div><Button onClick={() => setDraft(draftOf(FIVE_DAY_SPLIT))}>Preencher com a divisão de exemplo de 5 dias</Button></div>
      )}
      {ORDER.map((wd) => {
        const day = capitalize(WEEKDAY_NAMES[wd]!);
        const list = draft[wd]!.exercises;
        return (
          <fieldset key={wd} className="stack training-plan__day">
            <legend className="corpo__subtitle">{day}</legend>
            <label className="field">
              <span className="field__label">Nome do treino</span>
              <input aria-label={`Nome do treino de ${day}`} maxLength={TRAINING_NAME_MAX} value={draft[wd]!.name}
                onChange={(e) => setDay(wd, { name: e.target.value })} />
            </label>
            {list.length > 0 && (
              <ol className="plan-exercises">
                {list.map((e, i) => (
                  <ExerciseRow key={e.key} day={day} index={i} count={list.length} exercise={e}
                    issues={issues.filter((x) => x.weekday === wd && x.index === i).map((x) => PLAN_ISSUE_TEXT[x.kind])}
                    onChange={(patch) => setExercise(wd, e.key, patch)}
                    onMove={(by) => move(wd, i, by)}
                    onRemove={() => setDay(wd, { exercises: list.filter((x) => x.key !== e.key) })} />
                ))}
              </ol>
            )}
            {list.length < EXERCISES_MAX && (
              <div><Button size="sm" onClick={() => setDay(wd, { exercises: [...list, draftExercise()] })}>{`Adicionar exercício a ${day}`}</Button></div>
            )}
          </fieldset>
        );
      })}
      <BlockForm block={block} today={today} onChange={(b) => { setBlock(b); setError(undefined); }} />
      {error && <p role="alert" className="training__error">{error}</p>}
      <div className="body-block__actions">
        <Button variant="primary" disabled={busy} onClick={() => { void save(); }}>Salvar plano</Button>
        <Button variant="ghost" onClick={() => navigate('/corpo')}>Cancelar</Button>
      </div>
    </>
  );
}

function ExerciseRow({ day, index, count, exercise: e, issues, onChange, onMove, onRemove }: {
  day: string; index: number; count: number; exercise: DraftExercise; issues: string[];
  onChange(patch: Partial<DraftExercise>): void; onMove(by: -1 | 1): void; onRemove(): void;
}) {
  const label = e.name.trim() || `exercício ${index + 1}`;
  return (
    <li className="plan-exercise" role="group" aria-label={`${label} (${day})`}>
      <label className="field">
        <span className="field__label">Exercício</span>
        <input aria-label={`Nome do exercício ${index + 1} de ${day}`} maxLength={EXERCISE_NAME_MAX} value={e.name}
          onChange={(ev) => onChange({ name: ev.target.value })} />
      </label>
      <div className="plan-exercise__numbers">
        <label className="field">
          <span className="field__label">Séries</span>
          <select aria-label={`Séries de ${label}`} value={e.sets} onChange={(ev) => onChange({ sets: ev.target.value })}>
            <option value="">—</option>
            {Array.from({ length: PLANNED_SETS_MAX }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Repetições de</span>
          <input aria-label={`Repetições mínimas de ${label}`} inputMode="numeric" value={e.repsMin} onChange={(ev) => onChange({ repsMin: ev.target.value })} />
        </label>
        <label className="field">
          <span className="field__label">até</span>
          <input aria-label={`Repetições máximas de ${label}`} inputMode="numeric" value={e.repsMax} onChange={(ev) => onChange({ repsMax: ev.target.value })} />
        </label>
      </div>
      <div className="plan-exercise__rest" role="group" aria-label={`Descanso de ${label}`}>
        <span className="field__label">Descanso</span>
        <div className="plan-exercise__chips">
          {REST_PRESETS.map((r, i) => (
            <Chip key={r.label} selected={e.rest === `p${i}`} aria-label={`Descanso ${r.label} em ${label}`}
              onClick={() => onChange({ rest: `p${i}` })}>{r.label}</Chip>
          ))}
          <Chip selected={e.rest === 'none'} aria-label={`Sem descanso definido em ${label}`} onClick={() => onChange({ rest: 'none' })}>Sem descanso</Chip>
          <Chip selected={e.rest === 'other'} aria-label={`Outro descanso em ${label}`} onClick={() => onChange({ rest: 'other' })}>Outro</Chip>
        </div>
        {e.rest === 'other' && (
          <div className="plan-exercise__numbers">
            <label className="field">
              <span className="field__label">{`Mínimo (s, de ${REST_MIN_SEC} a ${REST_MAX_SEC})`}</span>
              <input aria-label={`Descanso mínimo em segundos de ${label}`} inputMode="numeric" value={e.restMin} onChange={(ev) => onChange({ restMin: ev.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">Máximo (s, opcional)</span>
              <input aria-label={`Descanso máximo em segundos de ${label}`} inputMode="numeric" value={e.restMax} onChange={(ev) => onChange({ restMax: ev.target.value })} />
            </label>
          </div>
        )}
      </div>
      <label className="field">
        <span className="field__label">Observação (opcional)</span>
        <input aria-label={`Observação de ${label}`} maxLength={PLAN_NOTE_MAX} value={e.note} onChange={(ev) => onChange({ note: ev.target.value })} />
      </label>
      {issues.map((msg) => <p key={msg} role="alert" className="training__error">{msg}</p>)}
      <div className="plan-exercise__actions">
        <Button size="sm" variant="ghost" disabled={index === 0} aria-label={`Subir ${label}`} onClick={() => onMove(-1)}>Subir</Button>
        <Button size="sm" variant="ghost" disabled={index === count - 1} aria-label={`Descer ${label}`} onClick={() => onMove(1)}>Descer</Button>
        <Button size="sm" variant="ghost" aria-label={`Remover ${label}`} onClick={onRemove}>Remover</Button>
      </div>
    </li>
  );
}

const RIR_OPTIONS = Array.from({ length: RIR_MAX + 1 }, (_, i) => i);
const newWeek = (prev?: DraftWeek): DraftWeek => ({ rirMin: prev?.rirMin ?? 2, rirMax: prev?.rirMax ?? 2, cardioMin: prev?.cardioMin ?? '', cardioMax: prev?.cardioMax ?? '' });

function BlockForm({ block, today, onChange }: { block: DraftBlock | null; today?: string; onChange(b: DraftBlock | null): void }) {
  if (!block) {
    return (
      <section className="stack training-plan__day" aria-labelledby="block-title">
        <h2 id="block-title" className="corpo__subtitle">Bloco de treino (opcional)</h2>
        <p className="muted">Um bloco tem semanas com uma faixa de RIR (repetições que ainda daria para fazer com boa técnica) e, se quiser, os minutos de cardio. O treino de hoje mostra a semana e as metas.</p>
        {/* Disabled until today is read: the block starts today, never with an empty date. */}
        <div><Button size="sm" disabled={!today} onClick={() => { if (today) onChange({ startDay: today, weeks: [newWeek(), newWeek(), newWeek(), newWeek()] }); }}>Começar um bloco</Button></div>
      </section>
    );
  }
  const setWeek = (i: number, patch: Partial<DraftWeek>) => onChange({ ...block, weeks: block.weeks.map((w, j) => (j === i ? { ...w, ...patch } : w)) });
  const setCount = (n: number) => {
    const weeks = block.weeks.slice(0, n);
    while (weeks.length < n) weeks.push(newWeek(weeks[weeks.length - 1]));
    onChange({ ...block, weeks });
  };
  return (
    <section className="stack training-plan__day" aria-labelledby="block-title">
      <h2 id="block-title" className="corpo__subtitle">Bloco de treino (opcional)</h2>
      <div className="plan-exercise__numbers">
        <label className="field">
          <span className="field__label">Início</span>
          <input type="date" aria-label="Início do bloco" value={block.startDay} onChange={(ev) => onChange({ ...block, startDay: ev.target.value })} />
        </label>
        <label className="field">
          <span className="field__label">Semanas</span>
          <select aria-label="Semanas do bloco" value={String(block.weeks.length)} onChange={(ev) => setCount(Number(ev.target.value))}>
            {Array.from({ length: BLOCK_WEEKS_MAX }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}</option>)}
          </select>
        </label>
      </div>
      <ol className="plan-weeks">
        {block.weeks.map((w, i) => (
          <li key={i} className="plan-week" role="group" aria-label={`Semana ${i + 1} do bloco`}>
            <span className="plan-week__title">{`Semana ${i + 1}`}</span>
            <label className="field">
              <span className="field__label">RIR de</span>
              <select aria-label={`RIR mínimo da semana ${i + 1}`} value={String(w.rirMin)} onChange={(ev) => setWeek(i, { rirMin: Number(ev.target.value) })}>
                {RIR_OPTIONS.map((n) => <option key={n} value={String(n)}>{rirValueText(n)}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field__label">até</span>
              <select aria-label={`RIR máximo da semana ${i + 1}`} value={String(w.rirMax)} onChange={(ev) => setWeek(i, { rirMax: Number(ev.target.value) })}>
                {RIR_OPTIONS.map((n) => <option key={n} value={String(n)}>{rirValueText(n)}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Cardio mín. (min)</span>
              <input aria-label={`Cardio mínimo da semana ${i + 1}`} inputMode="numeric" value={w.cardioMin} onChange={(ev) => setWeek(i, { cardioMin: ev.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">máx. (min)</span>
              <input aria-label={`Cardio máximo da semana ${i + 1}`} inputMode="numeric" value={w.cardioMax} onChange={(ev) => setWeek(i, { cardioMax: ev.target.value })} />
            </label>
          </li>
        ))}
      </ol>
      <div><Button size="sm" variant="ghost" onClick={() => onChange(null)}>Remover bloco</Button></div>
    </section>
  );
}
