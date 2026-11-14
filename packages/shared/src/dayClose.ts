import type {
  BlockOutcome, Commitment, DayKey, DayMode, DayState, FocusSession, HHmm, ID, LifeEvent, Mission, PracticeSession, Review,
  Tiredness, TrainingLog, Workout,
} from './types';
import type { BlockOccurrence } from './planDay';
import { dayKeyOf, logicalTimestamp } from './dates';
import { occurrencesOn, todayList } from './engine';
import { trainingSummaryText } from './training';

// Encerramento do dia (Acompanhamento C): when the evening card shows, what the day observed, and the
// rules of the corrections (typed times, focus minutes). Optional, never blocking, no XP.

export const CLOSE_FROM: HHmm = '20:00';
export const CLOSE_NOTE_MAX = 280;
export const TIREDNESS: readonly Tiredness[] = ['pouco', 'medio', 'muito'];
export const TIREDNESS_LABEL: Record<Tiredness, string> = { pouco: 'Pouco', medio: 'Médio', muito: 'Muito' };
/** Longest focus session a correction accepts. */
export const FOCUS_MAX_MIN = 600;

const MIN = 60_000;

/** The card's start on `day`: the later of 20:00 and the end of the day's last commitment. */
export function closeCardFrom(day: DayKey, commitments: readonly Commitment[], dayStartHour: number): number {
  const from = logicalTimestamp(day, CLOSE_FROM, dayStartHour);
  const lastEnd = occurrencesOn([...commitments], day, dayStartHour).reduce((m, o) => Math.max(m, o.endTs), 0);
  return Math.max(from, lastEnd);
}

/**
 * "Como foi hoje" shows on a workday from `closeCardFrom` until the logical day ends (the caller passes
 * today's key), unless the day was closed or the card dismissed.
 */
export function closeCardDue(input: {
  now: number; day: DayKey; mode: DayMode; state?: Pick<DayState, 'closedAt' | 'closeDismissed'>;
  commitments: readonly Commitment[]; dayStartHour: number;
}): boolean {
  if (input.mode === 'free') return false;
  if (input.state?.closedAt !== undefined || input.state?.closeDismissed === true) return false;
  return input.now >= closeCardFrom(input.day, input.commitments, input.dayStartHour);
}

export type CloseBlockState = 'normal' | 'minimo' | 'pulado' | 'nao-iniciado';
export const CLOSE_BLOCK_LABEL: Record<CloseBlockState, string> = {
  normal: 'Iniciado', minimo: 'Versão mínima', pulado: 'Pulado', 'nao-iniciado': 'Não iniciado',
};

export interface CloseBlockRow {
  blockId: ID;
  name: string;
  state: CloseBlockState;
  plannedStart: number;
  plannedEnd: number;
  startedAt?: number;
  endedAt?: number;        // the lived end as planning sees it (an open session: its planned end)
  retro?: boolean;
  outcome?: BlockOutcome;
}

export interface DayCloseSummary {
  blocks: CloseBlockRow[];
  counts: Record<CloseBlockState, number>;
  completed: Mission[];                                   // concluded today, in completion order
  partial: Array<{ missionId: ID; title: string }>;      // "Parcial" today, one per mission
  focus: FocusSession[];                                  // today's live sessions, by start
  focusMin: number;
  reviews: number;
  practiceClosed: number;
  training?: string;                                      // trainingSummaryText of today's log
  workouts: Workout[];                                    // today's live workouts, by time
  pending: Mission[];                                     // open, planned up to today (todayList order)
}

export interface DayCloseInput {
  day: DayKey;
  dayStartHour: number;
  occurrences: readonly BlockOccurrence[];   // planDay of today
  missions: readonly Mission[];
  events: readonly LifeEvent[];
  focus: readonly FocusSession[];
  reviews: readonly Review[];
  practice: readonly PracticeSession[];
  trainingLog?: TrainingLog;
  workouts: readonly Workout[];
}

/** What today observed, for the evening card. Routine blocks (checklists) are left out. */
export function dayCloseSummary(input: DayCloseInput): DayCloseSummary {
  const { day, dayStartHour } = input;
  const onDay = (ts: number | undefined): boolean => ts !== undefined && dayKeyOf(ts, dayStartHour) === day;
  const counts: Record<CloseBlockState, number> = { normal: 0, minimo: 0, pulado: 0, 'nao-iniciado': 0 };
  const blocks: CloseBlockRow[] = [];
  for (const o of input.occurrences) {
    if (o.block.kind === 'routine') continue;
    const s = o.session;
    const started = o.state !== 'skipped' && s?.startedAt !== undefined;
    const state: CloseBlockState = started ? (o.version === 'minimum' ? 'minimo' : 'normal')
      : o.skipReason === 'pulado' ? 'pulado' : 'nao-iniciado';
    counts[state] += 1;
    blocks.push({
      blockId: o.block.id, name: o.block.name, state, plannedStart: o.plannedStart, plannedEnd: o.plannedEnd,
      ...(started ? { startedAt: o.start, endedAt: o.end } : {}),
      ...(s?.retro ? { retro: true } : {}),
      ...(s?.outcome ? { outcome: s.outcome } : {}),
    });
  }
  const missions = input.missions.filter((m) => !m.deleted);
  const titles = new Map(missions.map((m) => [m.id, m.title]));
  const partialIds: ID[] = [];
  for (const e of [...input.events].sort((a, b) => a.at - b.at)) {
    if (e.deleted || e.type !== 'partial' || !e.missionId || !onDay(e.at)) continue;
    if (!partialIds.includes(e.missionId) && titles.has(e.missionId)) partialIds.push(e.missionId);
  }
  const focus = input.focus.filter((f) => !f.deleted && onDay(f.startedAt)).sort((a, b) => a.startedAt - b.startedAt);
  const log = input.trainingLog && !input.trainingLog.deleted && input.trainingLog.day === day ? input.trainingLog : undefined;
  return {
    blocks,
    counts,
    completed: missions.filter((m) => m.status === 'done' && onDay(m.completedAt))
      .sort((a, b) => a.completedAt! - b.completedAt!),
    partial: partialIds.map((missionId) => ({ missionId, title: titles.get(missionId)! })),
    focus,
    focusMin: Math.round(focus.reduce((s, f) => s + f.activeMs, 0) / MIN),
    reviews: input.reviews.filter((r) => !r.deleted && r.day === day).length,
    practiceClosed: input.practice.filter((p) => !p.deleted && p.status === 'done' && onDay(p.endedAt)).length,
    ...(log ? { training: trainingSummaryText(log) } : {}),
    workouts: input.workouts.filter((w) => !w.deleted && w.day === day).sort((a, b) => a.at - b.at),
    pending: todayList([...missions], day, 0).filter((m) => m.status === 'open'),
  };
}

// ------------------------------------------------------------------ corrections

export type TimeIssue = 'format' | 'order' | 'future';
export const TIME_ISSUE_TEXT: Record<TimeIssue, string> = {
  format: 'Use o formato 14:30.',
  order: 'O fim precisa ser depois do início.',
  future: 'Esse horário ainda não chegou.',
};
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Start and end typed for `day` (before the day start hour = the next morning) → timestamps, or the issue. */
export function typedWindow(
  day: DayKey, start: string, end: string, dayStartHour: number, now: number,
): { startedAt: number; endedAt: number } | TimeIssue {
  if (!HHMM.test(start) || !HHMM.test(end)) return 'format';
  const startedAt = logicalTimestamp(day, start, dayStartHour);
  const endedAt = logicalTimestamp(day, end, dayStartHour);
  if (endedAt <= startedAt) return 'order';
  if (endedAt > now) return 'future';
  return { startedAt, endedAt };
}

export type FocusIssue = 'range' | 'future';
export const FOCUS_ISSUE_TEXT: Record<FocusIssue, string> = {
  range: 'Minutos: um número inteiro de 1 a 600.',
  future: 'Com esses minutos a sessão terminaria depois de agora.',
};

/** The session with `minutes` of active time; pauses are kept, so the end moves with the active time. */
export function correctedFocus(
  s: Pick<FocusSession, 'startedAt' | 'endedAt' | 'activeMs'>, minutes: number, now: number,
): { activeMs: number; endedAt: number } | FocusIssue {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > FOCUS_MAX_MIN) return 'range';
  const activeMs = minutes * MIN;
  const endedAt = s.startedAt + activeMs + Math.max(0, s.endedAt - s.startedAt - s.activeMs);
  return endedAt > now ? 'future' : { activeMs, endedAt };
}
