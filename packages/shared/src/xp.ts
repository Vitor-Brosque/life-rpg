import type { DayKey, Mission } from './types';
import { addDays } from './dates';

export interface CompletionContext { completionsTodayBefore: number; hardDay: boolean }

export const REVIEW_XP = 5;
export const JOURNEY_XP = 30;
export const RESILIENCE_XP = 5;
export const FOCUS_DAILY_CAP = 40;
export const BLOCK_XP = 5;
export const RESUMPTION_XP = 10;
export const CHECKIN_XP = 2;
export const OBJECTIVE_XP = 10;

function baseByDuration(durationMin: number | undefined): number {
  if (durationMin === undefined) return 8;
  if (durationMin <= 5) return 5;
  if (durationMin <= 15) return 8;
  if (durationMin <= 30) return 12;
  if (durationMin <= 60) return 18;
  return 25;
}

export function completionXp(
  m: Pick<Mission, 'durationMin' | 'energy' | 'important'>,
  ctx: CompletionContext,
): { amount: number; resilience: number } {
  let amount = baseByDuration(m.durationMin);
  if (m.energy === 'heavy') amount *= 1.5;
  else if (m.energy === 'light') amount *= 0.8;
  amount = Math.round(amount);
  if (m.important) amount += 3;
  if (ctx.completionsTodayBefore >= 10) amount = Math.max(1, Math.round(amount * 0.5));
  const resilience = ctx.hardDay && ctx.completionsTodayBefore === 0 ? RESILIENCE_XP : 0;
  return { amount, resilience };
}

/** Caller ensures it is awarded once per mission. */
export function startXp(m: Pick<Mission, 'energy' | 'postponeCount'>): number {
  return m.energy === 'heavy' || m.postponeCount >= 2 ? 5 : 0;
}

/** Caller ensures it is awarded once per mission. */
export function strategyXp(m: Pick<Mission, 'postponeCount'>): number {
  return m.postponeCount >= 1 ? 2 : 0;
}

export function focusXp(activeMs: number, focusXpAlreadyToday: number): number {
  const raw = Math.floor(activeMs / 600000) * 2;
  const room = Math.max(0, FOCUS_DAILY_CAP - focusXpAlreadyToday);
  return Math.min(raw, room);
}

export interface LevelInfo { level: number; into: number; needed: number; total: number }

function requirement(level: number, attribute: boolean): number {
  const full = 40 + 20 * (level - 1);
  return attribute ? Math.ceil(full / 2) : full;
}

export function levelFromXp(total: number, attribute = false): LevelInfo {
  let level = 1;
  let into = Math.max(0, total);
  while (into >= requirement(level, attribute)) {
    into -= requirement(level, attribute);
    level += 1;
  }
  return { level, into, needed: requirement(level, attribute), total };
}

const TITLES: Array<[number, string]> = [
  [20, 'Lenda'], [16, 'Mestre'], [12, 'Cavaleiro'], [8, 'Guardião'],
  [5, 'Andarilho'], [3, 'Escudeiro'], [1, 'Aprendiz'],
];

export function titleForLevel(level: number): string {
  return TITLES.find(([min]) => level >= min)?.[1] ?? 'Aprendiz';
}

/** Oldest → newest, length = window, last entry = today. */
export function activeDays(xpDays: Set<DayKey>, today: DayKey, window: number): boolean[] {
  const out: boolean[] = [];
  for (let i = window - 1; i >= 0; i--) out.push(xpDays.has(addDays(today, -i)));
  return out;
}

export type FreeDayFn = (day: DayKey) => boolean;

/**
 * True when the 2 most recent non-free days before `today` (≤ 14 days back) have no xp and the
 * user was active on some earlier non-free day (≤ 30 days back from today).
 */
export function isResumption(today: DayKey, xpDays: Set<DayKey>, isFree: FreeDayFn): boolean {
  const recent: DayKey[] = [];
  let i = 1;
  for (; i <= 14 && recent.length < 2; i++) {
    const d = addDays(today, -i);
    if (!isFree(d)) recent.push(d);
  }
  if (recent.length < 2 || recent.some((d) => xpDays.has(d))) return false;
  for (; i <= 30; i++) {
    const d = addDays(today, -i);
    if (!isFree(d) && xpDays.has(d)) return true;
  }
  return false;
}

export function activeWorkdays(xpDays: Set<DayKey>, today: DayKey, window: number, isFree: FreeDayFn):
  { active: number; total: number; days: Array<{ day: DayKey; active: boolean; free: boolean }> } {
  const days: Array<{ day: DayKey; active: boolean; free: boolean }> = [];
  for (let i = window - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    days.push({ day, active: xpDays.has(day), free: isFree(day) });
  }
  const work = days.filter((d) => !d.free);
  return { active: work.filter((d) => d.active).length, total: work.length, days };
}
