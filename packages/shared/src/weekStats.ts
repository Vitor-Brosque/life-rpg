import type { Block, BlockSession, Checkin, Commitment, DayKey, DayState, XpEvent } from './types';
import { addDays, dayKeyOf, logicalTimestamp, weekdayOf } from './dates';
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
  const inWeek = new Set(weekDays);
  const past = weekDays.filter((d) => d < today);
  const stateOf = (d: DayKey): DayState | undefined => input.dayStates.find((s) => s.id === d && !s.deleted);

  const counted = past
    .map((day) => ({ day, mode: defaultDayMode(day, stateOf(day)) }))
    .filter((x) => x.mode !== 'free');
  const countedDays = new Set(counted.map((x) => x.day));

  let planned = 0;
  for (const { day, mode } of counted) {
    const occs = planDay({
      day, mode, now: logicalTimestamp(day, `${String(dayEndHour).padStart(2, '0')}:00`, dayStartHour),
      dayStartHour, dayEndHour, dayStartedAt: stateOf(day)?.startedAt,
      blocks: input.blocks, commitments: input.commitments,
      sessions: input.sessions.filter((s) => s.day === day && !s.deleted),
    });
    // Routine blocks are checklists (start of day, wind-down), not work blocks: they don't count.
    planned += occs.filter((o) => o.state !== 'skipped' && o.block.kind !== 'routine').length;
  }

  const routineIds = new Set(input.blocks.filter((b) => b.kind === 'routine').map((b) => b.id));
  const started = input.sessions.filter(
    (s) => !s.deleted && s.startedAt !== undefined && past.includes(s.day) && !routineIds.has(s.blockId),
  );
  const xpDays = new Set(input.xpEvents.filter((e) => !e.deleted).map((e) => e.dayKey));
  const checkinDay = (c: Checkin): DayKey => dayKeyOf(c.at, dayStartHour);
  const weekCheckins = input.checkins.filter((c) => !c.deleted && inWeek.has(checkinDay(c)));

  const counts = new Map<string, number>();
  for (const c of weekCheckins) {
    if (c.kind !== 'start') continue;
    for (const f of c.feelings) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const topFeeling = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0]?.[0];

  return {
    planned,
    started: started.length,
    minimumUsed: started.filter((s) => s.version === 'minimum').length,
    resumptions: input.xpEvents.filter((e) => !e.deleted && e.reason === 'resumption' && inWeek.has(e.dayKey)).length,
    escapes: weekCheckins.filter((c) => c.kind === 'escape').length,
    topFeeling,
    activeWorkdays: [...countedDays].filter((d) => xpDays.has(d)).length,
    workdays: countedDays.size,
  };
}
