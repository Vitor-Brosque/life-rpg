import type { Block, BlockSession, Checkin, Commitment, DayKey, DayMode, DayState, XpEvent } from './types';
import { addDays, dayEndTimestamp, dayKeyOf, weekdayOf } from './dates';
import { blocksForDay, defaultDayMode, planDay } from './planDay';

export interface WeekStatsInput {
  weekStart: DayKey;
  today: DayKey;
  dayStates: DayState[];
  sessions: BlockSession[];
  checkins: Checkin[];
  xpEvents: XpEvent[];
  blocks: Block[];
  commitments: Commitment[];
  dayStartHour: number;
  dayEndHour: number;
}
export interface WeekStats {
  planned: number;
  started: number;
  minimumUsed: number;
  resumptions: number;
  escapes: number;
  topFeeling?: string;
  activeWorkdays: number;
  workdays: number;
}

/** Monday of the week containing `day`. */
export function weekKey(day: DayKey): DayKey {
  return addDays(day, -((weekdayOf(day) + 6) % 7));
}

/** One work block of a day that counts as planned (the weekly review's rule). */
export interface CountedBlock {
  block: Block;
  started: boolean;
  minimum: boolean;
  /** Minutes the plan gave it: the day mode's version when the routine listed it that day; 0 when it was only lived. */
  plannedMin: number;
  /** When started: the lived window as planning sees it (an open session ends where planDay ends it). */
  lived?: { start: number; end: number };
}

export interface CountedBlocksInput {
  day: DayKey;
  mode: DayMode;
  dayStartedAt?: number;
  blocks: Block[];
  commitments: Commitment[];
  /** Any sessions: only the live ones of `day` are used. */
  sessions: BlockSession[];
  dayStartHour: number;
  dayEndHour: number;
}

/**
 * The day's work blocks that count as planned (§8): none on a free day; routine blocks and blocks
 * without room ('sem-tempo') don't count; a block created after its target time counts only when
 * it was started. `started`: not skipped and the session has `startedAt`; `minimum`: started in the
 * minimum version.
 */
export function countedBlocksOn(input: CountedBlocksInput): CountedBlock[] {
  const { day, mode, dayStartHour, dayEndHour } = input;
  if (mode === 'free') return [];
  const occs = planDay({
    day, mode, now: dayEndTimestamp(day, dayStartHour, dayEndHour),
    dayStartHour, dayEndHour, dayStartedAt: input.dayStartedAt,
    blocks: input.blocks, commitments: input.commitments,
    sessions: input.sessions.filter((s) => s.day === day && !s.deleted),
  });
  const listed = new Set(blocksForDay(input.blocks, day, mode).map((x) => x.block.id));
  const out: CountedBlock[] = [];
  for (const o of occs) {
    // Routine blocks are checklists (start of day, wind-down), not work blocks: they don't count.
    if (o.block.kind === 'routine' || o.skipReason === 'sem-tempo') continue;
    const started = o.state !== 'skipped' && o.session?.startedAt !== undefined;
    // A block that did not exist yet at its target time was not planned (unless it was started).
    if (o.block.createdAt > o.plannedStart && !started) continue;
    out.push({
      block: o.block, started, minimum: started && o.version === 'minimum',
      plannedMin: listed.has(o.block.id) ? (mode === 'normal' ? o.block.durationMin : o.block.minimumMin) : 0,
      ...(started ? { lived: { start: o.start, end: o.end } } : {}),
    });
  }
  return out;
}

export function weekStats(input: WeekStatsInput): WeekStats {
  const { weekStart, today, dayStartHour, dayEndHour } = input;
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  // Every counter looks at the same window: the days of the week before today.
  const past = new Set(weekDays.filter((d) => d < today));
  const stateOf = (d: DayKey): DayState | undefined => input.dayStates.find((s) => s.id === d && !s.deleted);

  const counted = [...past]
    .map((day) => ({ day, mode: defaultDayMode(day, stateOf(day)) }))
    .filter((x) => x.mode !== 'free');
  const countedDays = new Set(counted.map((x) => x.day));

  let planned = 0;
  let started = 0;
  let minimumUsed = 0;
  for (const { day, mode } of counted) {
    for (const c of countedBlocksOn({
      day, mode, dayStartedAt: stateOf(day)?.startedAt, dayStartHour, dayEndHour,
      blocks: input.blocks, commitments: input.commitments, sessions: input.sessions,
    })) {
      planned += 1;
      if (c.started) {
        started += 1;
        if (c.minimum) minimumUsed += 1;
      }
    }
  }

  const xpDays = new Set(input.xpEvents.filter((e) => !e.deleted).map((e) => e.dayKey));
  const checkins = input.checkins.filter((c) => !c.deleted && past.has(dayKeyOf(c.at, dayStartHour)));

  const counts = new Map<string, number>();
  for (const c of checkins) {
    if (c.kind !== 'start') continue;
    for (const f of c.feelings) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const topFeeling = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0]?.[0];

  return {
    planned,
    started,
    minimumUsed,
    resumptions: input.xpEvents.filter((e) => !e.deleted && e.reason === 'resumption' && past.has(e.dayKey)).length,
    escapes: checkins.filter((c) => c.kind === 'escape').length,
    topFeeling,
    activeWorkdays: [...countedDays].filter((d) => xpDays.has(d)).length,
    workdays: countedDays.size,
  };
}
