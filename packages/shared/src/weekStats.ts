import type { Block, BlockSession, Checkin, Commitment, DayKey, DayState, XpEvent } from './types';
import { addDays, dayEndTimestamp, dayKeyOf, weekdayOf } from './dates';
import { defaultDayMode, planDay } from './planDay';

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
    const occs = planDay({
      day, mode, now: dayEndTimestamp(day, dayStartHour, dayEndHour),
      dayStartHour, dayEndHour, dayStartedAt: stateOf(day)?.startedAt,
      blocks: input.blocks, commitments: input.commitments,
      sessions: input.sessions.filter((s) => s.day === day && !s.deleted),
    });
    for (const o of occs) {
      // Routine blocks are checklists (start of day, wind-down), not work blocks: they don't count.
      if (o.block.kind === 'routine' || o.skipReason === 'sem-tempo') continue;
      const isStarted = o.state !== 'skipped' && o.session?.startedAt !== undefined;
      // A block that did not exist yet at its target time was not planned (unless it was started).
      if (o.block.createdAt > o.plannedStart && !isStarted) continue;
      planned += 1;
      if (isStarted) {
        started += 1;
        if (o.version === 'minimum') minimumUsed += 1;
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
