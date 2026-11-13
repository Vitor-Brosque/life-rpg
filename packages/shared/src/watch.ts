import type { DayKey } from './types';
import { addDays, diffDays } from './dates';
import { weekKey } from './weekStats';
import { periodDays } from './periods';
import { dayIndex, type DayIndex, type PatternData } from './trends';

export const WATCH_FIRST_WEEK = 5;
export const WATCH_LAST_WEEK = 8;
/** Minimum drop, relative to the first 4 weeks' rate… */
export const WATCH_DROP_RATIO = 0.3;
/** …and in percentage points. */
export const WATCH_DROP_POINTS = 0.15;
export const WATCH_BASE_MIN_PLANNED = 8;
export const WATCH_BASE_MIN_STARTED = 4;
export const WATCH_RECENT_MIN_PLANNED = 5;
/** This many weeks in a row without starting make the next start a new beginning. */
export const WATCH_GAP_WEEKS = 3;
export const WATCH_HISTORY_WEEKS = 52;
const EPS = 1e-9;

export interface WeekTally { week: DayKey; started: number; planned: number }
export interface BlockHabit {
  key: string;            // habitKeyOf(name)
  name: string;
  minimumMin: number;
  weeks: WeekTally[];     // consecutive whole weeks, oldest → newest
  activeBefore: boolean;  // started before the first week listed
}
export interface WatchNotice {
  key: string;            // `${habitKey}:${anchor}`, what a dismissal stores
  habitKey: string;
  name: string;
  minimumMin: number;
  anchor: DayKey;         // Monday of week 1
  weekNumber: number;     // the last whole week, counting the anchor week as 1 (5–8)
  base: { started: number; planned: number };                  // weeks 1–4
  recent: { started: number; planned: number; weeks: number }; // the 5th alone, then the last 2
}

/** Blocks are grouped by name, like the week's objectives. */
export const habitKeyOf = (name: string): string => `block:${name.trim().toLocaleLowerCase('pt-BR')}`;

/**
 * Index of the habit's first week: the first with a start; after WATCH_GAP_WEEKS weeks in a row
 * without one, the next start begins again. When the habit was already active before the list
 * (`activeBefore`), only such a restart counts. undefined when there is no beginning in the list.
 */
export function habitAnchor(weeks: readonly WeekTally[], activeBefore = false): number | undefined {
  let anchor: number | undefined = activeBefore ? -1 : undefined;
  let gap = 0;
  for (const [i, w] of weeks.entries()) {
    if (w.started > 0) {
      if (anchor === undefined || gap >= WATCH_GAP_WEEKS) anchor = i;
      gap = 0;
    } else if (anchor !== undefined) {
      gap += 1;
    }
  }
  return anchor === undefined || anchor < 0 ? undefined : anchor;
}

const total = (ws: readonly WeekTally[]): { started: number; planned: number } =>
  ws.reduce((a, w) => ({ started: a.started + w.started, planned: a.planned + w.planned }), { started: 0, planned: 0 });

/** The weeks 5–8 notice of one habit (spec §2, decision 12), or undefined. */
export function watchNotice(h: BlockHabit): WatchNotice | undefined {
  const a = habitAnchor(h.weeks, h.activeBefore);
  if (a === undefined) return undefined;
  const weekNumber = h.weeks.length - a;
  if (weekNumber < WATCH_FIRST_WEEK || weekNumber > WATCH_LAST_WEEK) return undefined;
  const base = total(h.weeks.slice(a, a + 4));
  const n = weekNumber === WATCH_FIRST_WEEK ? 1 : 2;
  const recent = total(h.weeks.slice(h.weeks.length - n));
  if (base.planned < WATCH_BASE_MIN_PLANNED || base.started < WATCH_BASE_MIN_STARTED
    || recent.planned < WATCH_RECENT_MIN_PLANNED) return undefined;
  const baseRate = base.started / base.planned;
  const drop = baseRate - recent.started / recent.planned;
  if (drop + EPS < WATCH_DROP_POINTS || drop + EPS < WATCH_DROP_RATIO * baseRate) return undefined;
  const anchor = h.weeks[a]!.week;
  return {
    key: `${h.key}:${anchor}`, habitKey: h.key, name: h.name, minimumMin: h.minimumMin,
    anchor, weekNumber, base, recent: { ...recent, weeks: n },
  };
}

/**
 * Whole weeks of every block group (non-routine blocks counted by countedBlocksOn), from the week of
 * the first started session (at most WATCH_HISTORY_WEEKS back) to the last whole week. Only groups
 * that still have a live, unarchived block; name and minimum come from it.
 */
export function blockHabits(data: PatternData, idx: DayIndex = dayIndex(data)): BlockHabit[] {
  const thisWeek = weekKey(data.today);
  const lastWeek = addDays(thisWeek, -7);
  const started = data.sessions.filter((s) => !s.deleted && s.startedAt !== undefined && s.day < thisWeek);
  if (started.length === 0) return [];
  const firstWeek = weekKey(started.reduce((m, s) => (s.day < m ? s.day : m), started[0]!.day));
  const earliest = addDays(lastWeek, -7 * (WATCH_HISTORY_WEEKS - 1));
  const startWeek = firstWeek > earliest ? firstWeek : earliest;
  const count = diffDays(startWeek, lastWeek) / 7 + 1;

  const tallies = new Map<string, WeekTally[]>();
  for (let i = 0; i < count; i++) {
    const monday = addDays(startWeek, 7 * i);
    for (const d of periodDays({ start: monday, end: addDays(monday, 6) })) {
      for (const c of idx.blocks(d)) {
        const key = habitKeyOf(c.block.name);
        let weeks = tallies.get(key);
        if (!weeks) {
          weeks = Array.from({ length: count }, (_, j) => ({ week: addDays(startWeek, 7 * j), started: 0, planned: 0 }));
          tallies.set(key, weeks);
        }
        weeks[i]!.planned += 1;
        if (c.started) weeks[i]!.started += 1;
      }
    }
  }

  const blockById = new Map(data.blocks.map((b) => [b.id, b]));
  const before = new Set<string>();
  for (const s of started) {
    const b = s.day < startWeek ? blockById.get(s.blockId) : undefined;
    if (b) before.add(habitKeyOf(b.name));
  }

  const out: BlockHabit[] = [];
  for (const [key, weeks] of tallies) {
    const ref = data.blocks.find((b) => !b.deleted && !b.archived && habitKeyOf(b.name) === key);
    if (!ref) continue;
    out.push({ key, name: ref.name.trim(), minimumMin: ref.minimumMin, weeks, activeBefore: before.has(key) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/** The notices of every block group, without the dismissed ones, by name. */
export function watchNotices(data: PatternData, idx: DayIndex = dayIndex(data)): WatchNotice[] {
  const dismissed = new Set(data.watchDismissed);
  return blockHabits(data, idx)
    .map(watchNotice)
    .filter((n): n is WatchNotice => n !== undefined && !dismissed.has(n.key));
}
