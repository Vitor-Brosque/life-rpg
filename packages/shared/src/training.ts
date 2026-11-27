import type {
  BlockWeek, CardioModality, DayKey, Discomfort, DiscomfortSpot, ExerciseSet, ID, PlannedDetail, PlannedExercise,
  TrainingBlock, TrainingCardio, TrainingDay, TrainingExercise, TrainingLog, TrainingPlan, TrainingTarget, Workout, WorkoutKind,
} from './types';
import { diffDays, weekdayOf } from './dates';
import { normalize } from './parser';
import { WEEKDAY_NAMES, completedWeeks, type Period } from './periods';
import { WORKOUT_MAX_MIN } from './workouts';

// Treino do dia (Acompanhamento A): the weekly plan, the day log (sets, skipped, swapped, cardio) and
// what was observed (last session, evolution, cardio per week). Nothing here invents a set, a load or
// a progression: every number comes from what was logged.

export const TRAINING_PLAN_ID = 'plan';
export const trainingLogId = (day: DayKey): ID => `training-${day}`;

export const TRAINING_NAME_MAX = 40;
export const EXERCISE_NAME_MAX = 80;
export const EXERCISES_MAX = 20;
/** Planned exercises plus the ones added on the day. */
export const LOG_EXERCISES_MAX = 30;
export const SETS_MAX = 20;
export const REPS_MAX = 100;
export const KG_MAX = 500;
export const EFFORT_MAX = 5;
export const INTENSITY_MAX = 10;
/** Sessions shown per exercise in "Evolução". */
export const EVOLUTION_SESSIONS = 8;
export const CARDIO_WEEKS = 8;

// Treino detalhado (2026-11-25): what the plan asks per exercise, the block, RIR and discomfort.
export const PLANNED_SETS_MAX = 10;
export const REST_MIN_SEC = 15;
export const REST_MAX_SEC = 600;
export const RIR_MAX = 5;               // 5 = "5 or more"
export const PLAN_NOTE_MAX = 120;
export const DISCOMFORT_NOTE_MAX = 120;
export const BLOCK_WEEKS_MAX = 8;
export const DISCOMFORT_SPOTS: readonly DiscomfortSpot[] = ['ombro', 'cotovelo', 'punho', 'lombar', 'joelho', 'canela', 'outro'];
export const DISCOMFORT_LABEL: Record<DiscomfortSpot, string> = {
  ombro: 'Ombro', cotovelo: 'Cotovelo', punho: 'Punho', lombar: 'Lombar', joelho: 'Joelho', canela: 'Canela', outro: 'Outro',
};
export const DISCOMFORT_NOTE_TEXT = 'Dor que persiste ou piora: procure avaliação profissional. O app só registra.';
/** The rest buttons of the plan editor (seconds); "Outro" opens minimum and maximum. */
export const REST_PRESETS: readonly { label: string; min: number; max?: number }[] = [
  { label: '60 s', min: 60 }, { label: '90 s', min: 90 }, { label: '2 min', min: 120 }, { label: '2–3 min', min: 120, max: 180 },
  { label: '3 min', min: 180 }, { label: '3–4 min', min: 180, max: 240 },
];

const ex = (name: string, sets: number, repsMin: number, repsMax: number, restMinSec: number, restMaxSec?: number): PlannedExercise =>
  ({ name, sets, repsMin, repsMax, restMinSec, ...(restMaxSec !== undefined ? { restMaxSec } : {}) });

/** An example 5-day split (invented, by muscle group), offered by "Usar a divisão de exemplo de 5 dias". */
export const FIVE_DAY_SPLIT: readonly TrainingDay[] = [
  { weekday: 1, name: 'Peito e tríceps', exercises: [
    ex('Supino reto', 3, 6, 10, 120, 180), ex('Supino inclinado', 3, 8, 12, 90), ex('Crucifixo na máquina', 3, 10, 15, 60),
    ex('Tríceps na polia', 3, 10, 15, 60), ex('Tríceps testa', 2, 8, 12, 90),
  ] },
  { weekday: 2, name: 'Costas e bíceps', exercises: [
    ex('Puxada frontal', 3, 8, 12, 90), ex('Remada baixa', 3, 8, 12, 90), ex('Remada curvada', 3, 6, 10, 120, 180),
    ex('Rosca direta', 3, 8, 12, 60), ex('Rosca alternada', 2, 10, 15, 60),
  ] },
  { weekday: 3, name: 'Pernas', exercises: [
    ex('Agachamento livre', 3, 6, 10, 120, 180), ex('Leg press', 3, 10, 15, 120), ex('Cadeira extensora', 3, 10, 15, 90),
    ex('Mesa flexora', 3, 10, 15, 90), ex('Panturrilha em pé', 3, 10, 15, 60), ex('Abdominal', 3, 12, 20, 60),
  ] },
  { weekday: 4, name: 'Ombros', exercises: [
    ex('Desenvolvimento com halteres', 3, 8, 12, 90), ex('Elevação lateral', 3, 12, 15, 60), ex('Elevação frontal', 2, 10, 15, 60),
    ex('Crucifixo inverso', 3, 12, 15, 60), ex('Encolhimento', 3, 10, 15, 60),
  ] },
  { weekday: 5, name: 'Corpo inteiro', exercises: [
    ex('Levantamento terra', 3, 5, 8, 180), ex('Barra fixa', 3, 6, 10, 120), ex('Flexão de braço', 3, 10, 20, 60),
    ex('Afundo', 2, 8, 12, 90), { name: 'Prancha', sets: 3, restMinSec: 60, note: '30 a 45 s por série' },
  ] },
];

export const CARDIO_MODALITIES: readonly CardioModality[] = ['bicicleta', 'esteira', 'caminhada', 'outro'];
export const CARDIO_LABEL: Record<CardioModality, string> = {
  bicicleta: 'Bicicleta ergométrica', esteira: 'Esteira', caminhada: 'Caminhada', outro: 'Outro',
};

/** First letter upper-case (pt-BR); the rest as typed. */
export const capitalize = (s: string): string => s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1);

const cleanName = (s: string, max: number): string => capitalize(s.trim().slice(0, max).trim());

/** The editor's textarea (one exercise per line) → exercises: trimmed, blank lines out, capitalised, within the limits. */
export function exercisesFromText(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
    .map((l) => cleanName(l, EXERCISE_NAME_MAX)).slice(0, EXERCISES_MAX);
}

// ------------------------------------------------------------------ the plan: exercises and block

const isInt = (n: unknown, min: number, max: number): n is number => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

/** A stored exercise as `PlannedExercise`: plans saved before 2026-11-25 hold a plain string. */
export function plannedOf(x: PlannedExercise | string): PlannedExercise {
  return typeof x === 'string' ? { name: x } : x;
}

/** What the plan asks besides the name (no empty fields). */
export function plannedDetailOf(p: PlannedExercise): PlannedDetail {
  const { name: _n, ...rest } = p;
  return rest;
}

/**
 * One planned exercise as stored: name cleaned (blank → undefined), each number kept only when valid,
 * a reversed range swapped, a lone maximum kept, the note trimmed. Never throws.
 */
export function cleanPlanned(x: PlannedExercise | string): PlannedExercise | undefined {
  const p = plannedOf(x);
  const name = cleanName(p.name ?? '', EXERCISE_NAME_MAX);
  if (!name) return undefined;
  const out: PlannedExercise = { name };
  if (isInt(p.sets, 1, PLANNED_SETS_MAX)) out.sets = p.sets;
  let lo = isInt(p.repsMin, 1, REPS_MAX) ? p.repsMin : undefined;
  let hi = isInt(p.repsMax, 1, REPS_MAX) ? p.repsMax : undefined;
  if (lo !== undefined && hi !== undefined && lo > hi) [lo, hi] = [hi, lo];
  if (lo !== undefined) out.repsMin = lo;
  if (hi !== undefined) out.repsMax = hi;
  let rlo = isInt(p.restMinSec, REST_MIN_SEC, REST_MAX_SEC) ? p.restMinSec : undefined;
  let rhi = isInt(p.restMaxSec, REST_MIN_SEC, REST_MAX_SEC) ? p.restMaxSec : undefined;
  if (rlo === undefined && rhi !== undefined) { rlo = rhi; rhi = undefined; }
  if (rlo !== undefined && rhi !== undefined && rlo > rhi) [rlo, rhi] = [rhi, rlo];
  if (rlo !== undefined) out.restMinSec = rlo;
  if (rhi !== undefined && rhi !== rlo) out.restMaxSec = rhi;
  const note = (p.note ?? '').trim().slice(0, PLAN_NOTE_MAX).trim();
  if (note) out.note = note;
  return out;
}

/**
 * The plan as stored: valid weekdays only, the last entry of a weekday wins, sorted by weekday. An
 * entry with no name and no exercises is a rest day (dropped); a missing name becomes "Treino".
 */
export function normalizePlanDays(days: readonly TrainingDay[]): TrainingDay[] {
  const byWeekday = new Map<number, TrainingDay>();
  for (const d of days) {
    if (!Number.isInteger(d.weekday) || d.weekday < 0 || d.weekday > 6) continue;
    const name = d.name.trim().slice(0, TRAINING_NAME_MAX).trim();
    const exercises = (d.exercises as (PlannedExercise | string)[]).map(cleanPlanned)
      .filter((e): e is PlannedExercise => e !== undefined).slice(0, EXERCISES_MAX);
    if (!name && exercises.length === 0) byWeekday.delete(d.weekday);
    else byWeekday.set(d.weekday, { weekday: d.weekday, name: name || 'Treino', exercises });
  }
  return [...byWeekday.values()].sort((a, b) => a.weekday - b.weekday);
}

/** The plan's days with every exercise as `PlannedExercise` (reads plans saved with plain strings). */
export function planDaysOf(plan: Pick<TrainingPlan, 'days'> | undefined | null): TrainingDay[] {
  return (plan?.days ?? []).map((d) => ({ ...d, exercises: (d.exercises as (PlannedExercise | string)[]).map(plannedOf) }));
}

/** A plan record read from storage: exercises as objects. Anything else is untouched. */
export function readPlan<T extends Pick<TrainingPlan, 'days'>>(plan: T): T {
  return { ...plan, days: planDaysOf(plan) };
}

export type PlanIssueKind = 'reps' | 'rest';
export interface PlanIssue { weekday: number; index: number; kind: PlanIssueKind }
export const PLAN_ISSUE_TEXT: Record<PlanIssueKind, string> = {
  reps: 'Repetições: "de" e "até" entre 1 e 100, com "de" menor ou igual a "até".',
  rest: 'Descanso: entre 15 s e 10 min, com o mínimo menor ou igual ao máximo.',
};

/** What the editor must refuse (instead of silently fixing): a reversed or out-of-range range. */
export function planIssues(days: readonly TrainingDay[]): PlanIssue[] {
  const out: PlanIssue[] = [];
  for (const d of days) {
    d.exercises.forEach((e, index) => {
      if (!e.name?.trim()) return;
      const reps = [e.repsMin, e.repsMax].filter((v) => v !== undefined);
      if (reps.some((v) => !isInt(v, 1, REPS_MAX)) || (e.repsMin !== undefined && e.repsMax !== undefined && e.repsMin > e.repsMax)) {
        out.push({ weekday: d.weekday, index, kind: 'reps' });
      }
      const rest = [e.restMinSec, e.restMaxSec].filter((v) => v !== undefined);
      if (rest.some((v) => !isInt(v, REST_MIN_SEC, REST_MAX_SEC)) || (e.restMinSec !== undefined && e.restMaxSec !== undefined && e.restMinSec > e.restMaxSec)) {
        out.push({ weekday: d.weekday, index, kind: 'rest' });
      }
    });
  }
  return out;
}

export type BlockIssueKind = 'start' | 'weeks' | 'rir' | 'cardio';
export const BLOCK_ISSUE_TEXT: Record<BlockIssueKind, string> = {
  start: 'Escolha a data de início do bloco.',
  weeks: `O bloco tem de 1 a ${BLOCK_WEEKS_MAX} semanas.`,
  rir: 'RIR: de 0 a 5, com "de" menor ou igual a "até".',
  cardio: 'Cardio: de 1 a 300 minutos, com o mínimo menor ou igual ao máximo.',
};

/** The first problem of a block, or undefined. */
export function blockIssue(block: TrainingBlock): { kind: BlockIssueKind; week?: number } | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(block.startDay ?? '')) return { kind: 'start' };
  if (!Array.isArray(block.weeks) || block.weeks.length < 1 || block.weeks.length > BLOCK_WEEKS_MAX) return { kind: 'weeks' };
  for (const [i, w] of block.weeks.entries()) {
    if (!isInt(w.rirMin, 0, RIR_MAX) || !isInt(w.rirMax, 0, RIR_MAX) || w.rirMin > w.rirMax) return { kind: 'rir', week: i + 1 };
    const c = [w.cardioMin, w.cardioMax].filter((v) => v !== undefined);
    if (c.some((v) => !isInt(v, 1, WORKOUT_MAX_MIN)) || (w.cardioMin !== undefined && w.cardioMax !== undefined && w.cardioMin > w.cardioMax)) {
      return { kind: 'cardio', week: i + 1 };
    }
  }
  return undefined;
}

/** The block as stored (only fields that exist); a lone cardio maximum becomes the minimum. */
export function cleanBlock(block: TrainingBlock): TrainingBlock {
  return {
    startDay: block.startDay,
    weeks: block.weeks.slice(0, BLOCK_WEEKS_MAX).map((w) => {
      const lo = w.cardioMin ?? w.cardioMax;
      const hi = w.cardioMin !== undefined && w.cardioMax !== undefined && w.cardioMax !== w.cardioMin ? w.cardioMax : undefined;
      return { rirMin: w.rirMin, rirMax: w.rirMax, ...(lo !== undefined ? { cardioMin: lo } : {}), ...(hi !== undefined ? { cardioMax: hi } : {}) };
    }),
  };
}

/** The block week covering `day` (1-based), or undefined before the start, after the last week or without a block. */
export function blockWeekOf(block: TrainingBlock | undefined, day: DayKey): TrainingTarget | undefined {
  if (!block || block.weeks.length === 0) return undefined;
  const d = diffDays(block.startDay, day);
  if (d < 0) return undefined;
  const week = Math.floor(d / 7) + 1;
  const w: BlockWeek | undefined = block.weeks[week - 1];
  if (!w) return undefined;
  return {
    week, weeks: block.weeks.length, rirMin: w.rirMin, rirMax: w.rirMax,
    ...(w.cardioMin !== undefined ? { cardioMin: w.cardioMin } : {}), ...(w.cardioMax !== undefined ? { cardioMax: w.cardioMax } : {}),
  };
}

/** The plan's entry for the weekday of `day`; undefined = rest day, or no plan. */
export function trainingDayOf(plan: Pick<TrainingPlan, 'days' | 'deleted'> | undefined, day: DayKey): TrainingDay | undefined {
  if (!plan || plan.deleted) return undefined;
  return planDaysOf(plan).find((d) => d.weekday === weekdayOf(day));
}

/**
 * Fields of a new day log, created on the first explicit action: the day's plan name and exercises
 * copied (ids `p0`, `p1`… by position, so the screen can show the plan before the log exists), with what
 * the plan asked of each exercise and the block week of the day.
 */
export function startTrainingLog(day: DayKey, plan: Pick<TrainingPlan, 'days' | 'deleted' | 'block'> | undefined):
  Pick<TrainingLog, 'day' | 'planName' | 'exercises' | 'target'> {
  const entry = trainingDayOf(plan, day);
  const target = plan && !plan.deleted ? blockWeekOf(plan.block, day) : undefined;
  return {
    day,
    ...(entry ? { planName: entry.name } : {}),
    exercises: (entry?.exercises ?? []).map((p, i) => {
      const planned = plannedDetailOf(p);
      return { id: `p${i}`, name: p.name, sets: [], ...(Object.keys(planned).length > 0 ? { planned } : {}) };
    }),
    ...(target ? { target } : {}),
  };
}

// ------------------------------------------------------------------ texts of the plan and of the block

/** "45 s", "90 s", "2 min", "2 min 30 s". */
const secText = (s: number): string =>
  (s < 60 || (s <= 120 && s % 60 !== 0) ? `${s} s` : s % 60 === 0 ? `${s / 60} min` : `${Math.floor(s / 60)} min ${s % 60} s`);

/** "90 s", "2 min", "2–3 min", "60–90 s", "2 min 30 s a 4 min". */
export function restText(minSec: number, maxSec?: number): string {
  if (maxSec === undefined || maxSec === minSec) return secText(minSec);
  if (minSec % 60 === 0 && maxSec % 60 === 0) return `${minSec / 60}–${maxSec / 60} min`;
  if (maxSec <= 120) return `${minSec}–${maxSec} s`;
  return `${secText(minSec)} a ${secText(maxSec)}`;
}

/** "3 × 6–8 · descanso 2–3 min", "3 × 8", "3 séries", "6–8 repetições"; '' when the plan asks nothing. */
export function plannedText(p: PlannedDetail | undefined): string {
  if (!p) return '';
  const reps = p.repsMin !== undefined && p.repsMax !== undefined && p.repsMin !== p.repsMax
    ? `${p.repsMin}–${p.repsMax}` : String(p.repsMax ?? p.repsMin ?? '');
  const head = p.sets !== undefined
    ? (reps ? `${p.sets} × ${reps}` : `${p.sets} ${p.sets === 1 ? 'série' : 'séries'}`)
    : (reps ? `${reps} repetições` : '');
  const rest = p.restMinSec !== undefined ? `descanso ${restText(p.restMinSec, p.restMaxSec)}` : '';
  return [head, rest].filter(Boolean).join(' · ');
}

const rangeText = (lo: number, hi: number): string => (lo === hi ? String(lo) : `${lo}–${hi}`);
export const rirValueText = (rir: number): string => (rir >= RIR_MAX ? `${RIR_MAX}+` : String(rir));

/** "RIR ~2" / "RIR 1–2". */
export const targetRirText = (t: Pick<TrainingTarget, 'rirMin' | 'rirMax'>): string =>
  (t.rirMin === t.rirMax ? `RIR ~${t.rirMin}` : `RIR ${t.rirMin}–${t.rirMax}`);

/** "30 min" / "20–25 min"; '' without cardio. */
export function targetCardioText(t: Pick<TrainingTarget, 'cardioMin' | 'cardioMax'>): string {
  if (t.cardioMin === undefined) return '';
  return `${t.cardioMax !== undefined ? rangeText(t.cardioMin, t.cardioMax) : t.cardioMin} min`;
}

/** "Semana 2 de 4 · RIR ~2 · cardio 30 min". */
export function targetText(t: TrainingTarget): string {
  const cardio = targetCardioText(t);
  return [`Semana ${t.week} de ${t.weeks}`, targetRirText(t), cardio ? `cardio ${cardio}` : ''].filter(Boolean).join(' · ');
}

// ------------------------------------------------------------------ sets

export type SetIssue = 'reps' | 'kg';
export const SET_ISSUE_TEXT: Record<SetIssue, string> = {
  reps: 'Repetições: um número inteiro de 1 a 100.',
  kg: 'Carga: um número de 0 a 500 (pode ter vírgula), ou vazio.',
};

/** "40" → 40, "42,5" → 42.5, "" → undefined (no load); anything else → null. */
export function parseKg(text: string): number | undefined | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return undefined;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const v = Number(t);
  return v <= KG_MAX ? v : null;
}

/** A set from the fields of the form (RIR from its buttons, optional), or what is wrong with them. */
export function parseSet(repsText: string, kgText: string, rir?: number): ExerciseSet | SetIssue {
  const t = repsText.trim();
  const reps = Number(t);
  if (!/^\d+$/.test(t) || reps < 1 || reps > REPS_MAX) return 'reps';
  const kg = parseKg(kgText);
  if (kg === null) return 'kg';
  const withRir = rir !== undefined && isInt(rir, 0, RIR_MAX) ? { rir } : {};
  return kg === undefined ? { reps, ...withRir } : { reps, kg, ...withRir };
}

/** "RIR 2, 2, 1" (a set without RIR shows "–"); '' when no set has RIR. */
export function setsRirText(sets: readonly ExerciseSet[]): string {
  if (!sets.some((s) => s.rir !== undefined)) return '';
  return `RIR ${sets.map((s) => (s.rir !== undefined ? rirValueText(s.rir) : '–')).join(', ')}`;
}

const kgText = (kg: number): string => `${String(kg).replace('.', ',')} kg`;

/** "3 × 10 · 40 kg" when every set is the same; else "10 × 40 kg, 8 × 42,5 kg"; without load "3 × 12" / "12, 10". */
export function setsText(sets: readonly ExerciseSet[]): string {
  const first = sets[0];
  if (!first) return '';
  if (sets.every((s) => s.reps === first.reps && s.kg === first.kg)) {
    return `${sets.length} × ${first.reps}${first.kg !== undefined ? ` · ${kgText(first.kg)}` : ''}`;
  }
  return sets.map((s) => (s.kg !== undefined ? `${s.reps} × ${kgText(s.kg)}` : String(s.reps))).join(', ');
}

// ------------------------------------------------------------------ log changes (pure; the app applies them with `mutate`)

type Exercises = Pick<TrainingLog, 'exercises'>;
const mapExercise = (log: Exercises, id: ID, f: (e: TrainingExercise) => TrainingExercise): Exercises =>
  ({ exercises: log.exercises.map((e) => (e.id === id ? f(e) : e)) });
const withoutStatus = (e: TrainingExercise): TrainingExercise => {
  const { status: _s, replacedBy: _r, ...rest } = e;
  return rest;
};

/** A set saved: the exercise is done ('feito'), or stays swapped ('trocado': the sets are of the replacement). */
export function withSet(log: Exercises, id: ID, set: ExerciseSet): Exercises {
  return mapExercise(log, id, (e) => (e.sets.length >= SETS_MAX ? e
    : e.status === 'trocado' ? { ...e, sets: [...e.sets, set] }
      : { ...withoutStatus(e), status: 'feito', sets: [...e.sets, set] }));
}

/** Set `index` corrected. */
export function withSetAt(log: Exercises, id: ID, index: number, set: ExerciseSet): Exercises {
  return mapExercise(log, id, (e) => ({ ...e, sets: e.sets.map((s, i) => (i === index ? set : s)) }));
}

/** Set `index` removed; a done exercise left without sets goes back to not done. */
export function withoutSet(log: Exercises, id: ID, index: number): Exercises {
  return mapExercise(log, id, (e) => {
    const sets = e.sets.filter((_, i) => i !== index);
    return sets.length === 0 && e.status === 'feito' ? { ...withoutStatus(e), sets } : { ...e, sets };
  });
}

/** "Pulei" (offered only while the exercise has no sets). */
export function withSkipped(log: Exercises, id: ID): Exercises {
  return mapExercise(log, id, (e) => (e.sets.length > 0 ? e : { ...withoutStatus(e), status: 'pulado', sets: [] }));
}

/** "Troquei por…": the replacement's name (blank is ignored). Sets already saved stay (they are of the replacement). */
export function withReplaced(log: Exercises, id: ID, replacement: string): Exercises {
  const name = cleanName(replacement, EXERCISE_NAME_MAX);
  if (!name) return log;
  return mapExercise(log, id, (e) => ({ ...e, status: 'trocado', replacedBy: name }));
}

/** "Desfazer" of Pulei / Troquei (offered only without sets): back to not done. */
export function withStatusCleared(log: Exercises, id: ID): Exercises {
  return mapExercise(log, id, (e) => (e.sets.length > 0 ? e : withoutStatus(e)));
}

/** An exercise that was not in the plan (blank or over the limit is ignored). `id` = `x-${ulid}`. */
export function withExtra(log: Exercises, id: ID, name: string): Exercises {
  const clean = cleanName(name, EXERCISE_NAME_MAX);
  if (!clean || log.exercises.length >= LOG_EXERCISES_MAX) return log;
  return { exercises: [...log.exercises, { id, name: clean, sets: [], extra: true }] };
}

/** Removes an exercise added on the day (planned ones are skipped instead, never removed). */
export function withoutExtra(log: Exercises, id: ID): Exercises {
  return { exercises: log.exercises.filter((e) => e.id !== id || !e.extra) };
}

/** "Senti desconforto": where and an optional note; undefined removes it. */
export function withDiscomfort(log: Exercises, id: ID, d: Discomfort | undefined): Exercises {
  return mapExercise(log, id, (e) => {
    const { discomfort: _d, ...rest } = e;
    if (!d || !DISCOMFORT_SPOTS.includes(d.spot)) return rest;
    const note = (d.note ?? '').trim().slice(0, DISCOMFORT_NOTE_MAX).trim();
    return { ...rest, discomfort: { spot: d.spot, ...(note ? { note } : {}) } };
  });
}

/** "desconforto: ombro (pegou no fim)". */
export const discomfortText = (d: Discomfort): string =>
  `desconforto: ${DISCOMFORT_LABEL[d.spot].toLocaleLowerCase('pt-BR')}${d.note ? ` (${d.note})` : ''}`;

/** The name the sets belong to: the replacement when swapped. */
export const performedName = (e: Pick<TrainingExercise, 'name' | 'status' | 'replacedBy'>): string =>
  (e.status === 'trocado' && e.replacedBy ? e.replacedBy : e.name);

// ------------------------------------------------------------------ cardio

export type CardioIssue = 'minutes' | 'intensity';
export const CARDIO_ISSUE_TEXT: Record<CardioIssue, string> = {
  minutes: 'Informe quantos minutos durou (de 1 a 300).',
  intensity: 'Intensidade: de 1 a 10, ou vazio.',
};

export function cardioIssue(c: TrainingCardio): CardioIssue | undefined {
  if (!Number.isInteger(c.minutes) || c.minutes < 1 || c.minutes > WORKOUT_MAX_MIN) return 'minutes';
  if (c.intensity !== undefined && (!Number.isInteger(c.intensity) || c.intensity < 1 || c.intensity > INTENSITY_MAX)) return 'intensity';
  return undefined;
}

/** "Bicicleta ergométrica · 20 min · intensidade 6". */
export function cardioText(c: TrainingCardio): string {
  return `${CARDIO_LABEL[c.modality]} · ${c.minutes} min${c.intensity !== undefined ? ` · intensidade ${c.intensity}` : ''}`;
}

// ------------------------------------------------------------------ summary (the evening card)

export interface TrainingCounts { done: number; swapped: number; skipped: number; pending: number }

export function trainingCounts(log: Pick<TrainingLog, 'exercises'>): TrainingCounts {
  const out = { done: 0, swapped: 0, skipped: 0, pending: 0 };
  for (const e of log.exercises) {
    if (e.status === 'feito') out.done += 1;
    else if (e.status === 'trocado') out.swapped += 1;
    else if (e.status === 'pulado') out.skipped += 1;
    else out.pending += 1;
  }
  return out;
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "Pernas: 4 feitos, 1 trocado, 1 pulado · cardio 20 min" (only what happened); "Treino: nada registrado". */
export function trainingSummaryText(log: Pick<TrainingLog, 'planName' | 'exercises' | 'cardio'>): string {
  const c = trainingCounts(log);
  const parts = [
    c.done > 0 ? count(c.done, 'feito', 'feitos') : '',
    c.swapped > 0 ? count(c.swapped, 'trocado', 'trocados') : '',
    c.skipped > 0 ? count(c.skipped, 'pulado', 'pulados') : '',
  ].filter(Boolean);
  const head = `${log.planName ?? 'Treino'}: ${parts.length > 0 ? parts.join(', ') : 'nada registrado'}`;
  return log.cardio ? `${head} · cardio ${log.cardio.minutes} min` : head;
}

/**
 * The live workout of `kind` that "Terminei o treino" adopts instead of logging another: the one the log
 * already points at, else the first live one of that day (e.g. "Registrar treino" used earlier).
 */
export function adoptableWorkout(
  workouts: readonly Workout[], day: DayKey, kind: WorkoutKind, linkedId?: ID,
): Workout | undefined {
  const live = workouts.filter((w) => !w.deleted && w.day === day && w.kind === kind);
  return live.find((w) => w.id === linkedId) ?? [...live].sort((a, b) => a.at - b.at)[0];
}

// ------------------------------------------------------------------ observed: last session and evolution

export interface ExerciseSession {
  day: DayKey;
  name: string;                            // as written that day
  sets: ExerciseSet[];
  best?: { kg: number; reps: number };     // heaviest set (most reps at that load); only sets with a load
  volume: number;                          // Σ reps × kg of the sets with a load
  planned?: PlannedDetail;                 // what the plan asked that day (not for a swapped exercise)
  target?: TrainingTarget;                 // the block week of that day
  discomfort?: Discomfort;
}

const nameKey = (s: string): string => normalize(s.trim()).replace(/\s+/g, ' ');

function bestOf(sets: readonly ExerciseSet[]): { kg: number; reps: number } | undefined {
  let best: { kg: number; reps: number } | undefined;
  for (const s of sets) {
    if (s.kg === undefined) continue;
    if (!best || s.kg > best.kg || (s.kg === best.kg && s.reps > best.reps)) best = { kg: s.kg, reps: s.reps };
  }
  return best;
}

/** Sessions per performed exercise (case/accent-insensitive name), oldest → newest; one per day (sets merged). */
function sessionsByName(logs: readonly TrainingLog[], until: DayKey): Map<string, ExerciseSession[]> {
  const out = new Map<string, ExerciseSession[]>();
  const sorted = logs.filter((l) => !l.deleted && l.day <= until).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  for (const log of sorted) {
    for (const e of log.exercises) {
      if (e.sets.length === 0 || (e.status !== 'feito' && e.status !== 'trocado')) continue;
      const name = performedName(e);
      const key = nameKey(name);
      const list = out.get(key) ?? [];
      const same = list[list.length - 1];
      const sets = same?.day === log.day ? [...same.sets, ...e.sets] : [...e.sets];
      const planned = e.status === 'feito' ? (e.planned ?? (same?.day === log.day ? same.planned : undefined)) : undefined;
      const discomfort = e.discomfort ?? (same?.day === log.day ? same.discomfort : undefined);
      const session: ExerciseSession = {
        day: log.day, name, sets,
        ...(bestOf(sets) ? { best: bestOf(sets)! } : {}),
        volume: sets.reduce((v, s) => v + (s.kg !== undefined ? s.reps * s.kg : 0), 0),
        ...(planned ? { planned } : {}),
        ...(log.target ? { target: log.target } : {}),
        ...(discomfort ? { discomfort } : {}),
      };
      if (same?.day === log.day) list[list.length - 1] = session;
      else list.push(session);
      out.set(key, list);
    }
  }
  return out;
}

/** The latest session of `name` before `day` — the reference "Última: …" (never prefilled into the log). */
export function lastSession(logs: readonly TrainingLog[], name: string, day: DayKey): ExerciseSession | undefined {
  const list = sessionsByName(logs, day).get(nameKey(name)) ?? [];
  return [...list].reverse().find((s) => s.day < day);
}

/** "Última: 3 × 8 · 40 kg · RIR 2, 2, 1". */
export const lastSessionText = (s: ExerciseSession): string =>
  `Última: ${[setsText(s.sets), setsRirText(s.sets)].filter(Boolean).join(' · ')}`;

/**
 * "Pronto para subir a carga" (treino detalhado §4): the session reached the top of the planned range in every
 * planned set, at one load, and — when the session had a block week — with RIR at or above its minimum in each
 * of those sets. `fallback` is today's plan for the exercise, used when the session predates the copied request.
 * Returns the reason shown beside the tag, or undefined when the rule does not close.
 */
export function progressionReason(s: ExerciseSession, fallback?: PlannedDetail): string | undefined {
  const p = s.planned ?? fallback;
  const top = p?.repsMax ?? p?.repsMin;
  if (!p?.sets || top === undefined) return undefined;
  const sets = s.sets.slice(0, p.sets);
  if (sets.length < p.sets) return undefined;
  if (!sets.every((x) => x.reps >= top)) return undefined;
  if (!sets.every((x) => x.kg === sets[0]!.kg)) return undefined;
  if (s.target && !sets.every((x) => x.rir !== undefined && x.rir >= s.target!.rirMin)) return undefined;
  const [, m, d] = s.day.split('-');
  const wd = WEEKDAY_NAMES[weekdayOf(s.day)]!.slice(0, 3);
  const done = [setsText(sets), setsRirText(sets)].filter(Boolean).join(', ');
  return `Na última (${wd} ${d}/${m}): ${done}. Faixa até ${top}${s.target ? '' : ' (sem meta de RIR)'}.`;
}

export interface ExerciseHistory { key: string; name: string; sessions: ExerciseSession[] }

/** Per exercise performed up to `today`, its last 8 sessions (oldest → newest); the most recently done first. */
export function exerciseHistory(logs: readonly TrainingLog[], today: DayKey): ExerciseHistory[] {
  return [...sessionsByName(logs, today).entries()]
    .map(([key, list]) => {
      const sessions = list.slice(-EVOLUTION_SESSIONS);
      return { key, name: sessions[sessions.length - 1]!.name, sessions };
    })
    .sort((a, b) => {
      const da = a.sessions[a.sessions.length - 1]!.day;
      const db = b.sessions[b.sessions.length - 1]!.day;
      return da < db ? 1 : da > db ? -1 : a.name.localeCompare(b.name, 'pt-BR');
    });
}

export interface CardioWeek { period: Period; sessions: number; minutes: number }

/** Cardio workouts (any source) of the last `count` complete weeks, oldest → newest. Observed only. */
export function cardioWeeks(workouts: readonly Workout[], today: DayKey, count = CARDIO_WEEKS): CardioWeek[] {
  return completedWeeks(today, count).map((period) => {
    const list = workouts.filter((w) => !w.deleted && w.kind === 'cardio' && w.day >= period.start && w.day <= period.end);
    return { period, sessions: list.length, minutes: list.reduce((s, w) => s + w.minutes, 0) };
  });
}
