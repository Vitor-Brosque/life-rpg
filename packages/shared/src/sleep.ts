import type { DayKey, HHmm, ID, SleepLog } from './types';
import { addDays, dayKeyOf, formatHHmm, parseHHmm, timestampAt, toDayKey } from './dates';

// Sono (Marco 4, spec §4): pure rules for the two-tap log, editing and the 14-night window.
// No scoring and no medical meaning: only times, durations and how much they vary.

/** A night runs from noon to noon: going to bed at 01:30 on the 14th belongs to the night of the 13th. */
export const SLEEP_CUTOFF_HOUR = 12;
/** Longer than this is a typo or a missing tap, not a night: no duration. */
export const SLEEP_MAX_MIN = 16 * 60;
export const SLEEP_WINDOW = 14;
/** Complete nights needed before the window shows averages and spreads. */
export const SLEEP_MIN_NIGHTS = 3;
/** "Deitei" is offered from 20:00 to 05:00; "Acordei" without a "Deitei" from 05:00 to 12:00. */
export const BED_PROMPT_FROM = 20 * 60;
export const WAKE_PROMPT_FROM = 5 * 60;
export const WAKE_PROMPT_UNTIL = 12 * 60;

const MIN = 60_000;

export const sleepLogId = (night: DayKey): ID => `sleep-${night}`;
export const sleepXpId = (night: DayKey): ID => `xp-sleep-${night}`;

/** The night a moment belongs to (noon to noon). */
export function sleepNightOf(ts: number): DayKey {
  return dayKeyOf(ts, SLEEP_CUTOFF_HOUR);
}

/** The newest night the 14-night window shows: the one that started yesterday evening. */
export function lastSleepNight(now: number): DayKey {
  return addDays(toDayKey(new Date(now)), -1);
}

/** Minutes asleep, only for a plausible night: both taps, wake after bed, at most 16 h. */
export function sleepMinutes(log: Pick<SleepLog, 'bedAt' | 'wakeAt'>): number | undefined {
  if (log.bedAt === undefined || log.wakeAt === undefined) return undefined;
  const min = Math.round((log.wakeAt - log.bedAt) / MIN);
  return min > 0 && min <= SLEEP_MAX_MIN ? min : undefined;
}

export type SleepPrompt =
  | { kind: 'none' }
  | { kind: 'bed'; night: DayKey }                    // "Deitei"
  | { kind: 'asleep'; night: DayKey; bedAt: number }  // after "Deitei": "Acordei"
  | { kind: 'wake'; night: DayKey };                  // morning without "Deitei": "Acordei"

const minuteOfDay = (ts: number): number => {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
};

/**
 * What the Agora offers now. An open night ("Deitei" up to 16 h ago, no "Acordei") always wins.
 * Otherwise "Deitei" from 20:00 to 05:00 (not during a commitment) while tonight has no time yet,
 * and "Acordei" from 05:00 to 12:00 while last night has no wake time.
 */
export function sleepPrompt(input: { now: number; logs: readonly SleepLog[]; inCommitment?: boolean }): SleepPrompt {
  const { now } = input;
  const live = input.logs.filter((l) => !l.deleted);
  const open = live
    .filter((l) => l.bedAt !== undefined && l.wakeAt === undefined && now >= l.bedAt && now - l.bedAt <= SLEEP_MAX_MIN * MIN)
    .sort((a, b) => b.bedAt! - a.bedAt!)[0];
  if (open) return { kind: 'asleep', night: open.night, bedAt: open.bedAt! };
  const night = sleepNightOf(now);
  const log = live.find((l) => l.night === night);
  const m = minuteOfDay(now);
  if (m >= BED_PROMPT_FROM || m < WAKE_PROMPT_FROM) {
    if (input.inCommitment) return { kind: 'none' };
    return log?.bedAt === undefined && log?.wakeAt === undefined ? { kind: 'bed', night } : { kind: 'none' };
  }
  if (m < WAKE_PROMPT_UNTIL) return log?.wakeAt === undefined ? { kind: 'wake', night } : { kind: 'none' };
  return { kind: 'none' };
}

/**
 * Timestamps for times typed for `night`: a bedtime before noon is the next morning; the wake
 * time is always on the next day. An absent time stays absent.
 */
export function sleepTimes(night: DayKey, bed?: HHmm, wake?: HHmm): { bedAt?: number; wakeAt?: number } {
  const next = addDays(night, 1);
  return {
    ...(bed ? { bedAt: timestampAt(parseHHmm(bed) < SLEEP_CUTOFF_HOUR * 60 ? next : night, bed) } : {}),
    ...(wake ? { wakeAt: timestampAt(next, wake) } : {}),
  };
}

export type SleepIssue = 'order' | 'long';

export const SLEEP_ISSUE_TEXT: Record<SleepIssue, string> = {
  order: 'O horário de acordar precisa ser depois do de deitar.',
  long: 'Confira os horários: deu mais de 16 h.',
};

/** Why two times cannot be saved together (undefined = fine, or only one of them). */
export function sleepIssue(t: { bedAt?: number; wakeAt?: number }): SleepIssue | undefined {
  if (t.bedAt === undefined || t.wakeAt === undefined) return undefined;
  if (t.wakeAt <= t.bedAt) return 'order';
  if (t.wakeAt - t.bedAt > SLEEP_MAX_MIN * MIN) return 'long';
  return undefined;
}

/** Minutes from noon of `night` to `ts`: bed 23:30 → 690, 01:00 the next day → 780, wake 07:00 → 1140. */
export function minutesFromNoon(night: DayKey, ts: number): number {
  return Math.round((ts - timestampAt(night, '12:00')) / MIN);
}

/** Clock time of a minutes-from-noon value: 690 → '23:30', 780 → '01:00', 1140 → '07:00'. */
export function clockFromNoon(min: number): HHmm {
  return formatHHmm((((Math.round(min) + 720) % 1440) + 1440) % 1440);
}

export interface SleepNight {
  night: DayKey;
  log?: SleepLog;
  bedMin?: number;      // minutesFromNoon
  wakeMin?: number;
  minutes?: number;     // sleepMinutes (complete, plausible nights only)
}

export interface SleepSpread {
  meanMin: number;      // minutes from noon (clockFromNoon shows it)
  spreadMin: number;    // population standard deviation, "variação típica"
  earliestMin: number;
  latestMin: number;
}

export interface SleepWindow {
  nights: SleepNight[]; // oldest → newest, `count` entries
  complete: number;     // nights with a duration
  enough: boolean;      // complete ≥ SLEEP_MIN_NIGHTS
  avgMinutes?: number;  // only when enough
  bed?: SleepSpread;
  wake?: SleepSpread;
}

function spread(values: number[]): SleepSpread {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return {
    meanMin: Math.round(mean),
    spreadMin: Math.round(Math.sqrt(variance)),
    earliestMin: Math.min(...values),
    latestMin: Math.max(...values),
  };
}

/** The `count` nights ending at `endNight`, and the observed regularity of the complete ones. */
export function sleepWindow(logs: readonly SleepLog[], endNight: DayKey, count = SLEEP_WINDOW): SleepWindow {
  const byNight = new Map(logs.filter((l) => !l.deleted).map((l) => [l.night, l]));
  const nights: SleepNight[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const night = addDays(endNight, -i);
    const log = byNight.get(night);
    const minutes = log ? sleepMinutes(log) : undefined;
    nights.push({
      night,
      ...(log ? { log } : {}),
      ...(log?.bedAt !== undefined ? { bedMin: minutesFromNoon(night, log.bedAt) } : {}),
      ...(log?.wakeAt !== undefined ? { wakeMin: minutesFromNoon(night, log.wakeAt) } : {}),
      ...(minutes !== undefined ? { minutes } : {}),
    });
  }
  const done = nights.filter((n) => n.minutes !== undefined);
  const enough = done.length >= SLEEP_MIN_NIGHTS;
  if (!enough) return { nights, complete: done.length, enough };
  return {
    nights,
    complete: done.length,
    enough,
    avgMinutes: Math.round(done.reduce((s, n) => s + n.minutes!, 0) / done.length),
    bed: spread(done.map((n) => n.bedMin!)),
    wake: spread(done.map((n) => n.wakeMin!)),
  };
}
