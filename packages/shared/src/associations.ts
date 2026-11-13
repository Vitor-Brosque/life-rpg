import type { DayKey } from './types';
import { addDays } from './dates';
import { sleepMinutes } from './sleep';
import { dayIndex, type DayIndex, type PatternData } from './trends';

export const ASSOC_WINDOW_DAYS = 90;
export const ASSOC_MIN_PAIRS = 14;
export const ASSOC_MIN_GROUP = 5;
export const METHOD_MIN_REVIEWS = 30;

export interface Pair<T> { x: number; y: T }
export interface Split<T> { threshold: number; low: Array<Pair<T>>; high: Array<Pair<T>> }

/** Lower median of x: low = x ≤ threshold, high = x > threshold (ties go low). Needs ≥ 1 pair. */
export function medianSplit<T>(pairs: ReadonlyArray<Pair<T>>): Split<T> {
  const xs = pairs.map((p) => p.x).sort((a, b) => a - b);
  const threshold = xs[Math.floor((xs.length - 1) / 2)]!;
  return { threshold, low: pairs.filter((p) => p.x <= threshold), high: pairs.filter((p) => p.x > threshold) };
}

export type NotEnough = 'poucos' | 'variacao';

export interface BlocksHalf { days: number; started: number; planned: number }   // averages per day
export interface SleepBlocksAssociation {
  pairs: number;
  enough: boolean;
  reason?: NotEnough;
  thresholdMin?: number;
  shorter?: BlocksHalf;
  longer?: BlocksHalf;
}

export interface ModeHalf { days: number; lowDays: number }   // days that were Baixa energia or Recuperação
export interface SleepModeAssociation {
  pairs: number;
  enough: boolean;
  reason?: NotEnough;
  thresholdMin?: number;
  shorter?: ModeHalf;
  longer?: ModeHalf;
}

/** The 90 days before today, oldest first. */
function windowDays(today: DayKey): DayKey[] {
  return Array.from({ length: ASSOC_WINDOW_DAYS }, (_, i) => addDays(today, i - ASSOC_WINDOW_DAYS));
}

/** Minutes slept in the night before each logical day (the night dated the day before). */
function nightBefore(data: Pick<PatternData, 'sleepLogs'>): (day: DayKey) => number | undefined {
  const byNight = new Map(data.sleepLogs.filter((l) => !l.deleted).map((l) => [l.night, l]));
  return (day) => {
    const log = byNight.get(addDays(day, -1));
    return log ? sleepMinutes(log) : undefined;
  };
}

function split<T>(pairs: Array<Pair<T>>): { split?: Split<T>; reason?: NotEnough } {
  if (pairs.length < ASSOC_MIN_PAIRS) return { reason: 'poucos' };
  const s = medianSplit(pairs);
  if (s.low.length < ASSOC_MIN_GROUP || s.high.length < ASSOC_MIN_GROUP) return { reason: 'variacao' };
  return { split: s };
}

/** Sleep before each workday that had planned blocks × blocks started and planned that day. */
export function sleepVsBlocks(data: PatternData, idx: DayIndex = dayIndex(data)): SleepBlocksAssociation {
  const minutesBefore = nightBefore(data);
  const pairs: Array<Pair<{ started: number; planned: number }>> = [];
  for (const d of windowDays(data.today)) {
    if (!idx.isWorkday(d)) continue;
    const counted = idx.blocks(d);
    if (counted.length === 0) continue;
    const min = minutesBefore(d);
    if (min === undefined) continue;
    pairs.push({ x: min, y: { started: counted.filter((c) => c.started).length, planned: counted.length } });
  }
  const { split: s, reason } = split(pairs);
  if (!s) return { pairs: pairs.length, enough: false, reason };
  const half = (g: Array<Pair<{ started: number; planned: number }>>): BlocksHalf => ({
    days: g.length,
    started: g.reduce((a, p) => a + p.y.started, 0) / g.length,
    planned: g.reduce((a, p) => a + p.y.planned, 0) / g.length,
  });
  return { pairs: pairs.length, enough: true, thresholdMin: s.threshold, shorter: half(s.low), longer: half(s.high) };
}

/** Sleep before each day whose type was chosen (Normal, Baixa energia, Recuperação) × low-energy days. */
export function sleepVsDayMode(data: PatternData, idx: DayIndex = dayIndex(data)): SleepModeAssociation {
  const minutesBefore = nightBefore(data);
  const pairs: Array<Pair<boolean>> = [];
  for (const d of windowDays(data.today)) {
    const mode = idx.recordedMode(d);
    if (mode === undefined || mode === 'free') continue;
    const min = minutesBefore(d);
    if (min === undefined) continue;
    pairs.push({ x: min, y: mode !== 'normal' });
  }
  const { split: s, reason } = split(pairs);
  if (!s) return { pairs: pairs.length, enough: false, reason };
  const half = (g: Array<Pair<boolean>>): ModeHalf => ({ days: g.length, lowDays: g.filter((p) => p.y).length });
  return { pairs: pairs.length, enough: true, thresholdMin: s.threshold, shorter: half(s.low), longer: half(s.high) };
}

export type ReviewMethod = 'wrote' | 'drew' | 'spoke' | 'none';
export const REVIEW_METHODS: readonly ReviewMethod[] = ['wrote', 'drew', 'spoke', 'none'];
export const METHOD_LABEL: Record<ReviewMethod, string> = {
  wrote: 'Escreveu antes', drew: 'Desenhou antes', spoke: 'Falou antes', none: 'Só pensou',
};
export interface MethodRow { method: ReviewMethod; reviews: number; correct: number }
export interface MethodAssociation {
  all: MethodRow[];       // every method, in REVIEW_METHODS order
  rows: MethodRow[];      // those with ≥ METHOD_MIN_REVIEWS
  enough: boolean;        // 'none' and at least one other method qualify
}

/**
 * Reviews of learned cards (before.state 'review') in the 90 days before today, counted in every
 * method they used (wrote, drew, spoke) or in 'none'; correct = rating > 1.
 */
export function reviewMethods(data: Pick<PatternData, 'reviews' | 'today'>): MethodAssociation {
  const from = addDays(data.today, -ASSOC_WINDOW_DAYS);
  const rows = new Map<ReviewMethod, MethodRow>(REVIEW_METHODS.map((m) => [m, { method: m, reviews: 0, correct: 0 }]));
  for (const r of data.reviews) {
    if (r.deleted || r.day < from || r.day >= data.today || r.before.state !== 'review') continue;
    const used: ReviewMethod[] = [];
    if (r.wrote) used.push('wrote');
    if (r.drew) used.push('drew');
    if (r.spoke) used.push('spoke');
    if (used.length === 0) used.push('none');
    for (const m of used) {
      const row = rows.get(m)!;
      row.reviews += 1;
      if (r.rating > 1) row.correct += 1;
    }
  }
  const all = REVIEW_METHODS.map((m) => rows.get(m)!);
  const shown = all.filter((r) => r.reviews >= METHOD_MIN_REVIEWS);
  return { all, rows: shown, enough: shown.some((r) => r.method === 'none') && shown.some((r) => r.method !== 'none') };
}
