import type {
  Area, Block, BlockSession, Checkin, Commitment, DayKey, DayMode, DayState, LifeEvent, Mission,
  MonthObserved, MonthReview, PracticeSession, Review, SleepLog, Week, Workout, XpEvent,
} from './types';
import { addDays, dayKeyOf } from './dates';
import { defaultDayMode } from './planDay';
import { countedBlocksOn, type CountedBlock } from './weekStats';
import { SLEEP_MIN_NIGHTS, minutesFromNoon, sleepMinutes } from './sleep';
import {
  PARTS_OF_DAY, PART_LABEL, addMonths, monthKeyOf, monthPeriod, partOfDay, periodDays, type MonthKey, type Period,
} from './periods';

/** Everything the Padrões screen reads, without soft-deleted records. */
export interface PatternData {
  today: DayKey;
  dayStartHour: number;
  dayEndHour: number;
  dayStates: DayState[];
  blocks: Block[];               // archived included (past plans)
  commitments: Commitment[];
  sessions: BlockSession[];
  xpEvents: XpEvent[];
  events: LifeEvent[];
  missions: Mission[];
  areas: Area[];                 // archived included
  checkins: Checkin[];
  reviews: Review[];
  practice: PracticeSession[];   // Marco 3d
  sleepLogs: SleepLog[];         // Marco 4
  workouts: Workout[];           // Marco 4
  weeks: Week[];
  watchDismissed: string[];      // settings.patterns.watchDismissed
}

export interface DayIndex {
  /** The recorded mode, else the weekday default (defaultDayMode). */
  mode(day: DayKey): DayMode;
  /** The mode chosen that day ("Como está hoje?"), when there is one. */
  recordedMode(day: DayKey): DayMode | undefined;
  isWorkday(day: DayKey): boolean;
  /** countedBlocksOn for the day, memoised (the same array on every call). */
  blocks(day: DayKey): CountedBlock[];
}

export function dayIndex(data: PatternData): DayIndex {
  const states = new Map(data.dayStates.filter((d) => !d.deleted).map((d) => [d.id, d]));
  const sessionsByDay = new Map<DayKey, BlockSession[]>();
  for (const s of data.sessions) {
    if (s.deleted) continue;
    const list = sessionsByDay.get(s.day);
    if (list) list.push(s);
    else sessionsByDay.set(s.day, [s]);
  }
  const blocks = data.blocks.filter((b) => !b.deleted);
  const commitments = data.commitments.filter((c) => !c.deleted);
  const cache = new Map<DayKey, CountedBlock[]>();
  const mode = (day: DayKey): DayMode => defaultDayMode(day, states.get(day));
  return {
    mode,
    recordedMode: (day) => states.get(day)?.mode,
    isWorkday: (day) => mode(day) !== 'free',
    blocks(day) {
      let counted = cache.get(day);
      if (!counted) {
        counted = countedBlocksOn({
          day, mode: mode(day), dayStartedAt: states.get(day)?.startedAt, blocks, commitments,
          sessions: sessionsByDay.get(day) ?? [], dayStartHour: data.dayStartHour, dayEndHour: data.dayEndHour,
        });
        cache.set(day, counted);
      }
      return counted;
    },
  };
}

/** Mondays of the weeks marked as atypical (exams, travel...): kept out of comparisons (research P3). */
export function atypicalWeekSet(weeks: readonly Pick<Week, 'id' | 'deleted' | 'atypical'>[] | undefined): Set<DayKey> {
  return new Set((weeks ?? []).filter((w) => !w.deleted && w.atypical).map((w) => w.id));
}

/** Whether some atypical week overlaps [start, end] (a week period is its own Monday). */
export function overlapsAtypical(atypical: ReadonlySet<DayKey>, start: DayKey, end: DayKey): boolean {
  for (const monday of atypical) if (monday <= end && addDays(monday, 6) >= start) return true;
  return false;
}

/** Accuracy is shown only from this many reviews of learned cards. */
export const ACCURACY_MIN = 20;
/** A period's sleep averages need this many complete nights. */
export const SLEEP_TREND_MIN_NIGHTS = SLEEP_MIN_NIGHTS;

export interface TrendPoint {
  period: Period;
  workdays: number;
  activeWorkdays: number;
  blocksPlanned: number;
  blocksStarted: number;
  minimumUsed: number;
  resumptions: number;
  reviews: number;
  learnedReviews: number;      // before.state === 'review'
  learnedCorrect: number;      // of those, rating > 1
  practiceClosed: number;
  practiceTop: { delivered: number; understood: number; autonomous: number };  // sessions rated 2
  sleepNights: number;         // complete nights
  sleepAvgMin?: number;        // only with ≥ SLEEP_TREND_MIN_NIGHTS
  bedSpreadMin?: number;       // population SD of the bedtime (minutes from noon), same condition
  workouts: number;
  workoutMinutes: number;
  cardio: number;
  startCheckins: number;
  escapes: number;
  /** The week (or, for a month, some week of it) was marked as atypical: shown apart, nothing is dropped. */
  atypical?: boolean;
}

const mean = (v: readonly number[]): number => v.reduce((s, x) => s + x, 0) / v.length;
/** Population standard deviation. */
function popSd(v: readonly number[]): number {
  const m = mean(v);
  return Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
}

/** One point per period, counting only the days before today. */
export function trendPoints(data: PatternData, periods: readonly Period[], idx: DayIndex = dayIndex(data)): TrendPoint[] {
  const { today, dayStartHour } = data;
  const xp = data.xpEvents.filter((x) => !x.deleted);
  const xpDays = new Set(xp.map((x) => x.dayKey));
  const atypical = atypicalWeekSet(data.weeks);
  return periods.map((period) => {
    const inP = (d: DayKey): boolean => d >= period.start && d <= period.end && d < today;
    let workdays = 0;
    let activeWorkdays = 0;
    let blocksPlanned = 0;
    let blocksStarted = 0;
    let minimumUsed = 0;
    for (const d of periodDays(period)) {
      if (d >= today || !idx.isWorkday(d)) continue;
      workdays += 1;
      if (xpDays.has(d)) activeWorkdays += 1;
      for (const c of idx.blocks(d)) {
        blocksPlanned += 1;
        if (c.started) {
          blocksStarted += 1;
          if (c.minimum) minimumUsed += 1;
        }
      }
    }
    const reviews = data.reviews.filter((r) => !r.deleted && inP(r.day));
    const learned = reviews.filter((r) => r.before.state === 'review');
    const closed = data.practice.filter((s) => !s.deleted && s.status === 'done' && s.endedAt !== undefined
      && inP(dayKeyOf(s.endedAt, dayStartHour)));
    const top = (k: 'delivered' | 'understood' | 'autonomous'): number => closed.filter((s) => s.ratings[k] === 2).length;
    const nights = data.sleepLogs.flatMap((l) => {
      if (l.deleted || !inP(l.night)) return [];
      const minutes = sleepMinutes(l);
      return minutes === undefined ? [] : [{ minutes, bed: minutesFromNoon(l.night, l.bedAt!) }];
    });
    const workouts = data.workouts.filter((w) => !w.deleted && inP(w.day));
    const checkins = data.checkins.filter((c) => !c.deleted && inP(dayKeyOf(c.at, dayStartHour)));
    return {
      period, workdays, activeWorkdays, blocksPlanned, blocksStarted, minimumUsed,
      resumptions: xp.filter((x) => x.reason === 'resumption' && inP(x.dayKey)).length,
      reviews: reviews.length,
      learnedReviews: learned.length,
      learnedCorrect: learned.filter((r) => r.rating > 1).length,
      practiceClosed: closed.length,
      practiceTop: { delivered: top('delivered'), understood: top('understood'), autonomous: top('autonomous') },
      sleepNights: nights.length,
      ...(nights.length >= SLEEP_TREND_MIN_NIGHTS ? {
        sleepAvgMin: Math.round(mean(nights.map((n) => n.minutes))),
        bedSpreadMin: Math.round(popSd(nights.map((n) => n.bed))),
      } : {}),
      workouts: workouts.length,
      workoutMinutes: workouts.reduce((s, w) => s + w.minutes, 0),
      cardio: workouts.filter((w) => w.kind === 'cardio').length,
      startCheckins: checkins.filter((c) => c.kind === 'start').length,
      escapes: checkins.filter((c) => c.kind === 'escape').length,
      ...(overlapsAtypical(atypical, period.start, period.end) ? { atypical: true } : {}),
    };
  });
}

export interface AreaShare { key: string; name: string; xp: number; share: number }

/** XP of [from, to] by area, largest first: "Sem área" without one, "Outra área" for an unknown id. */
export function effortByArea(data: Pick<PatternData, 'xpEvents' | 'areas'>, from: DayKey, to: DayKey): AreaShare[] {
  const names = new Map(data.areas.map((a) => [a.id, a.name]));
  const sums = new Map<string, number>();
  let total = 0;
  for (const x of data.xpEvents) {
    if (x.deleted || x.amount <= 0 || x.dayKey < from || x.dayKey > to) continue;
    const key = x.areaId ?? '';
    sums.set(key, (sums.get(key) ?? 0) + x.amount);
    total += x.amount;
  }
  return [...sums.entries()]
    .map(([key, xp]) => ({ key, name: key === '' ? 'Sem área' : names.get(key) ?? 'Outra área', xp, share: xp / total }))
    .sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name, 'pt-BR'));
}

export interface CountRow { key: string; label: string; count: number }
export interface CheckinBreakdown {
  escapesByPart: CountRow[];   // in the order of the day
  escapesByArea: CountRow[];
  escapesByPlace: CountRow[];
  feelings: CountRow[];        // start cards
}
export const ESCAPE_PLACE_LABEL: Record<string, string> = { youtube: 'YouTube', redes: 'Redes', outro: 'Outro' };

type Counter = Map<string, { label: string; count: number }>;
function bump(m: Counter, key: string, label: string): void {
  const v = m.get(key);
  if (v) v.count += 1;
  else m.set(key, { label, count: 1 });
}
const byCount = (m: Counter): CountRow[] => [...m.entries()]
  .map(([key, v]) => ({ key, ...v }))
  .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));

/** "Escapei" by part of the day, area and place, and the start cards' feelings, in [from, to]. */
export function checkinBreakdown(
  data: Pick<PatternData, 'checkins' | 'missions' | 'blocks' | 'areas' | 'dayStartHour'>, from: DayKey, to: DayKey,
): CheckinBreakdown {
  const missions = new Map(data.missions.map((m) => [m.id, m]));
  const blocks = new Map(data.blocks.map((b) => [b.id, b]));
  const areas = new Map(data.areas.map((a) => [a.id, a.name]));
  const part: Counter = new Map();
  const area: Counter = new Map();
  const place: Counter = new Map();
  const feelings: Counter = new Map();
  for (const c of data.checkins) {
    const day = dayKeyOf(c.at, data.dayStartHour);
    if (c.deleted || day < from || day > to) continue;
    if (c.kind === 'start') {
      for (const f of c.feelings) bump(feelings, f, f);
      continue;
    }
    const p = partOfDay(c.at, data.dayStartHour);
    bump(part, p, PART_LABEL[p]);
    const areaId = (c.missionId ? missions.get(c.missionId)?.areaId : undefined)
      ?? (c.blockId ? blocks.get(c.blockId)?.areaId : undefined);
    const areaName = areaId ? areas.get(areaId) : undefined;
    bump(area, areaName ? areaId! : '', areaName ?? 'Sem área');
    const dest = c.escapedTo ?? 'outro';
    bump(place, dest, ESCAPE_PLACE_LABEL[dest] ?? dest);
  }
  return {
    escapesByPart: PARTS_OF_DAY.flatMap((k) => {
      const v = part.get(k);
      return v ? [{ key: k, ...v }] : [];
    }),
    escapesByArea: byCount(area),
    escapesByPlace: byCount(place),
    feelings: byCount(feelings),
  };
}

/** The reflection card is offered on the first days of the month. */
export const MONTH_CARD_DAYS = 7;
export const monthReviewId = (month: MonthKey): string => `month-${month}`;

/** The month's observed numbers, from its trend point (copied into the reflection). */
export function monthObserved(data: PatternData, month: MonthKey, idx: DayIndex = dayIndex(data)): MonthObserved {
  const p = trendPoints(data, [monthPeriod(month)], idx)[0]!;
  return {
    workdays: p.workdays,
    activeWorkdays: p.activeWorkdays,
    blocksPlanned: p.blocksPlanned,
    blocksStarted: p.blocksStarted,
    minimumUsed: p.minimumUsed,
    resumptions: p.resumptions,
    reviews: p.reviews,
    ...(p.learnedReviews >= ACCURACY_MIN ? { accuracy: p.learnedCorrect / p.learnedReviews } : {}),
    practiceClosed: p.practiceClosed,
    workouts: p.workouts,
    ...(p.sleepAvgMin !== undefined ? { sleepAvgMin: p.sleepAvgMin } : {}),
    escapes: p.escapes,
  };
}

/**
 * The month whose reflection the Agora offers today: the previous one, on days 1–7, on a day that
 * is not free, when it had some activity and has no live record yet.
 */
export function monthCardDue(input: {
  today: DayKey; mode: DayMode; prevReview?: Pick<MonthReview, 'deleted'>; prevActive: boolean;
}): MonthKey | undefined {
  if (Number(input.today.slice(8, 10)) > MONTH_CARD_DAYS) return undefined;
  if (input.mode === 'free' || !input.prevActive) return undefined;
  if (input.prevReview && !input.prevReview.deleted) return undefined;
  return addMonths(monthKeyOf(input.today), -1);
}
