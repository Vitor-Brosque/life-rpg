import type {
  CardioModality, DayKey, ExerciseSet, ID, TrainingCardio, TrainingDay, TrainingExercise, TrainingLog, TrainingPlan,
  Workout, WorkoutKind,
} from './types';
import { weekdayOf } from './dates';
import { normalize } from './parser';
import { completedWeeks, type Period } from './periods';
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

/** An example 5-day split (invented, by muscle group), offered by "Usar a divisão de exemplo de 5 dias". */
export const FIVE_DAY_SPLIT: readonly TrainingDay[] = [
  { weekday: 1, name: 'Peito e tríceps', exercises: [
    'Supino reto', 'Supino inclinado', 'Crucifixo na máquina', 'Tríceps na polia', 'Tríceps testa',
  ] },
  { weekday: 2, name: 'Costas e bíceps', exercises: [
    'Puxada frontal', 'Remada baixa', 'Remada curvada', 'Rosca direta', 'Rosca alternada',
  ] },
  { weekday: 3, name: 'Pernas', exercises: [
    'Agachamento livre', 'Leg press', 'Cadeira extensora', 'Mesa flexora', 'Panturrilha em pé', 'Abdominal',
  ] },
  { weekday: 4, name: 'Ombros', exercises: [
    'Desenvolvimento com halteres', 'Elevação lateral', 'Elevação frontal', 'Crucifixo inverso', 'Encolhimento',
  ] },
  { weekday: 5, name: 'Corpo inteiro', exercises: [
    'Levantamento terra', 'Barra fixa', 'Flexão de braço', 'Afundo', 'Prancha',
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

/**
 * The plan as stored: valid weekdays only, the last entry of a weekday wins, sorted by weekday. An
 * entry with no name and no exercises is a rest day (dropped); a missing name becomes "Treino".
 */
export function normalizePlanDays(days: readonly TrainingDay[]): TrainingDay[] {
  const byWeekday = new Map<number, TrainingDay>();
  for (const d of days) {
    if (!Number.isInteger(d.weekday) || d.weekday < 0 || d.weekday > 6) continue;
    const name = d.name.trim().slice(0, TRAINING_NAME_MAX).trim();
    const exercises = d.exercises.map((e) => e.trim()).filter((e) => e !== '')
      .map((e) => cleanName(e, EXERCISE_NAME_MAX)).slice(0, EXERCISES_MAX);
    if (!name && exercises.length === 0) byWeekday.delete(d.weekday);
    else byWeekday.set(d.weekday, { weekday: d.weekday, name: name || 'Treino', exercises });
  }
  return [...byWeekday.values()].sort((a, b) => a.weekday - b.weekday);
}

/** The plan's entry for the weekday of `day`; undefined = rest day, or no plan. */
export function trainingDayOf(plan: Pick<TrainingPlan, 'days' | 'deleted'> | undefined, day: DayKey): TrainingDay | undefined {
  if (!plan || plan.deleted) return undefined;
  return plan.days.find((d) => d.weekday === weekdayOf(day));
}

/**
 * Fields of a new day log, created on the first explicit action: the day's plan name and exercises
 * copied (ids `p0`, `p1`… by position, so the screen can show the plan before the log exists).
 */
export function startTrainingLog(day: DayKey, plan: Pick<TrainingPlan, 'days' | 'deleted'> | undefined):
  Pick<TrainingLog, 'day' | 'planName' | 'exercises'> {
  const entry = trainingDayOf(plan, day);
  return {
    day,
    ...(entry ? { planName: entry.name } : {}),
    exercises: (entry?.exercises ?? []).map((name, i) => ({ id: `p${i}`, name, sets: [] })),
  };
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

/** A set from the two fields of the form, or what is wrong with them. */
export function parseSet(repsText: string, kgText: string): ExerciseSet | SetIssue {
  const t = repsText.trim();
  const reps = Number(t);
  if (!/^\d+$/.test(t) || reps < 1 || reps > REPS_MAX) return 'reps';
  const kg = parseKg(kgText);
  if (kg === null) return 'kg';
  return kg === undefined ? { reps } : { reps, kg };
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
      const session: ExerciseSession = {
        day: log.day, name, sets,
        ...(bestOf(sets) ? { best: bestOf(sets)! } : {}),
        volume: sets.reduce((v, s) => v + (s.kg !== undefined ? s.reps * s.kg : 0), 0),
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

export const lastSessionText = (s: ExerciseSession): string => `Última: ${setsText(s.sets)}`;

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
