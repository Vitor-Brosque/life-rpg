import { fsrs, State, type Card as FsrsCard, type FSRS, type Grade } from 'ts-fsrs';
import type { CardSchedule, CardState, DayKey, Rating } from './types';
import { addDays, dayKeyOf, diffDays, formatHHmm, timestampAt, weekdayOf } from './dates';

// Spaced-repetition scheduling (spec §4): FSRS-6 through ts-fsrs, plus the app's own rules —
// day-or-longer intervals start at the logical day start and never land on a rest day.

/** `shortTerm: false` (topic cards): no 1 m / 10 m steps, every interval in days. Default true. */
export interface ScheduleCtx { dayStartHour: number; restDays: number[]; retention: number; shortTerm?: boolean }

const TO_STATE: Record<State, CardState> = {
  [State.New]: 'new', [State.Learning]: 'learning', [State.Review]: 'review', [State.Relearning]: 'relearning',
};
const FROM_STATE: Record<CardState, State> = {
  new: State.New, learning: State.Learning, review: State.Review, relearning: State.Relearning,
};

const engines = new Map<string, FSRS>();

function engine(retention: number, shortTerm = true): FSRS {
  const r = Math.round(Math.min(0.97, Math.max(0.7, retention)) * 100) / 100;
  const key = `${r}:${shortTerm}`;
  let f = engines.get(key);
  if (!f) {
    f = fsrs({
      request_retention: r, maximum_interval: 365, enable_fuzz: true, enable_short_term: shortTerm,
      learning_steps: ['1m', '10m'], relearning_steps: ['10m'],
    });
    engines.set(key, f);
  }
  return f;
}

export function newSchedule(now: number): CardSchedule {
  return { state: 'new', due: now, stability: 0, difficulty: 0, reps: 0, lapses: 0, learningSteps: 0, scheduledDays: 0 };
}

export function scheduleOf(c: CardSchedule): CardSchedule {
  const { state, due, stability, difficulty, reps, lapses, learningSteps, scheduledDays, lastReview } = c;
  return {
    state, due, stability, difficulty, reps, lapses, learningSteps, scheduledDays,
    ...(lastReview !== undefined ? { lastReview } : {}),
  };
}

function toFsrs(s: CardSchedule): FsrsCard {
  return {
    due: new Date(s.due), stability: s.stability, difficulty: s.difficulty, elapsed_days: 0,
    scheduled_days: s.scheduledDays, learning_steps: s.learningSteps, reps: s.reps, lapses: s.lapses,
    state: FROM_STATE[s.state], ...(s.lastReview !== undefined ? { last_review: new Date(s.lastReview) } : {}),
  };
}

function fromFsrs(c: FsrsCard): CardSchedule {
  return {
    state: TO_STATE[c.state], due: c.due.getTime(), stability: c.stability, difficulty: c.difficulty,
    reps: c.reps, lapses: c.lapses, learningSteps: c.learning_steps, scheduledDays: c.scheduled_days,
    ...(c.last_review ? { lastReview: c.last_review.getTime() } : {}),
  };
}

/** `dayStartHour:00` of logical day `day`. */
export function dayStartTimestamp(day: DayKey, dayStartHour: number): number {
  return timestampAt(day, formatHHmm(dayStartHour * 60));
}

/** First instant of the logical day after `today`: "due today" means due before this. */
export function nextDayStart(today: DayKey, dayStartHour: number): number {
  return dayStartTimestamp(addDays(today, 1), dayStartHour);
}

/**
 * `day` when it is a study day; otherwise the nearest study day (earlier wins a tie), where an
 * earlier day only counts when it is after `today`. All seven days at rest = no rule.
 */
export function shiftRestDay(day: DayKey, today: DayKey, restDays: number[]): DayKey {
  const rest = new Set(restDays);
  if (rest.size >= 7 || !rest.has(weekdayOf(day))) return day;
  let before: DayKey | undefined;
  for (let i = 1; i <= 7; i++) {
    const d = addDays(day, -i);
    if (d <= today) break;
    if (!rest.has(weekdayOf(d))) { before = d; break; }
  }
  let after = day;
  for (let i = 1; i <= 7; i++) {
    const d = addDays(day, i);
    if (!rest.has(weekdayOf(d))) { after = d; break; }
  }
  if (!before) return after;
  return diffDays(before, day) <= diffDays(day, after) ? before : after;
}

/** Day-or-longer intervals start at their logical day start, never today or on a rest day. */
export function placeDue(s: CardSchedule, now: number, ctx: ScheduleCtx): CardSchedule {
  if (s.state === 'new' || s.scheduledDays < 1) return s;
  const today = dayKeyOf(now, ctx.dayStartHour);
  let day = dayKeyOf(s.due, ctx.dayStartHour);
  if (day <= today) day = addDays(today, 1);
  day = shiftRestDay(day, today, ctx.restDays);
  return { ...s, due: dayStartTimestamp(day, ctx.dayStartHour), scheduledDays: diffDays(today, day) };
}

export function rate(s: CardSchedule, rating: Rating, now: number, ctx: ScheduleCtx): CardSchedule {
  const next = engine(ctx.retention, ctx.shortTerm ?? true).next(toFsrs(s), new Date(now), rating as Grade).card;
  return placeDue(fromFsrs(next), now, ctx);
}

export interface IntervalPreview { schedule: CardSchedule; short: string; long: string }

export function previews(s: CardSchedule, now: number, ctx: ScheduleCtx): Record<Rating, IntervalPreview> {
  const log = engine(ctx.retention, ctx.shortTerm ?? true).repeat(toFsrs(s), new Date(now));
  const out = {} as Record<Rating, IntervalPreview>;
  for (const r of [1, 2, 3, 4] as Rating[]) {
    const schedule = placeDue(fromFsrs(log[r as Grade].card), now, ctx);
    out[r] = { schedule, ...intervalLabel(schedule, now) };
  }
  return out;
}

const word = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** "1 min" / "2 d" / "3 sem" / "4 m" / "1 a" for the buttons, and the full words for screen readers. */
export function intervalLabel(s: CardSchedule, now: number): { short: string; long: string } {
  if (s.scheduledDays >= 1) {
    const d = s.scheduledDays;
    if (d < 14) return { short: `${d} d`, long: word(d, 'dia', 'dias') };
    if (d < 60) { const w = Math.round(d / 7); return { short: `${w} sem`, long: word(w, 'semana', 'semanas') }; }
    if (d < 365) { const m = Math.round(d / 30); return { short: `${m} m`, long: word(m, 'mês', 'meses') }; }
    return { short: '1 a', long: '1 ano' };
  }
  const min = Math.max(1, Math.round((s.due - now) / 60_000));
  if (min < 60) return { short: `${min} min`, long: word(min, 'minuto', 'minutos') };
  const h = Math.round(min / 60);
  return { short: `${h} h`, long: word(h, 'hora', 'horas') };
}

/** Probability of recall now (1 for new cards). Used to review the most at-risk cards first. */
export function retrievability(s: CardSchedule, now: number, retention = 0.9): number {
  if (s.state === 'new') return 1;
  return engine(retention).get_retrievability(toFsrs(s), new Date(now), false);
}
