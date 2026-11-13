import type { Area, Block, BlockSession, DayKey, FocusSession, Journey, Mission, XpEvent } from '@life/shared';
import { formatHHmm, freezerFacts, sleepFacts, timestampAt, weekKey, workoutFacts } from '@life/shared';
import { db } from '../../db/db';

// Everything the world needs, in one read (spec §4–§5). Live rows only; tables of Marco 4 are
// read by name, so a build without them simply has no body/freezer/sleep facts.

export interface WorldData {
  areas: Area[];             // live, not archived, by order
  xp: XpEvent[];
  journeys: Journey[];
  missions: Mission[];
  focus: FocusSession[];     // started this week
  blocks: Block[];           // archived included (their sessions still count)
  sessions: BlockSession[];  // this week
  sketchesThisWeek: number;
  checkinsThisWeek: number;
  workouts?: { total: number; cardio: number };
  freezer?: { portions: number; everPrepped: boolean };
  sleepNights?: number;
}

/** Monday of today's week and the start of its logical day. */
export function weekWindow(today: DayKey, dayStartHour: number): { weekStart: DayKey; weekStartTs: number } {
  const weekStart = weekKey(today);
  return { weekStart, weekStartTs: timestampAt(weekStart, formatHHmm(dayStartHour * 60)) };
}

/** Rows of a table another milestone owns, or undefined when this build has no such table. */
async function optionalRows(name: string): Promise<unknown[] | undefined> {
  const table = db.tables.find((t) => t.name === name);
  return table ? table.toArray() : undefined;
}

export async function readWorldData(today: DayKey, dayStartHour: number): Promise<WorldData> {
  const { weekStart, weekStartTs } = weekWindow(today, dayStartHour);
  const [areas, xp, journeys, missions, focus, blocks, sessions, sketchesThisWeek, checkinsThisWeek, workouts, moves, sleep] =
    await Promise.all([
      db.areas.orderBy('order').toArray(),
      db.xpEvents.toArray(),
      db.journeys.toArray(),
      db.missions.toArray(),
      db.focusSessions.where('startedAt').aboveOrEqual(weekStartTs).toArray(),
      db.blocks.toArray(),
      db.blockSessions.where('day').between(weekStart, today, true, true).toArray(),
      db.sketches.where('updatedAt').aboveOrEqual(weekStartTs).filter((s) => !s.deleted).count(),
      db.checkins.where('at').aboveOrEqual(weekStartTs).filter((c) => !c.deleted && c.kind === 'start').count(),
      optionalRows('workouts'),
      optionalRows('freezerMoves'),
      optionalRows('sleepLogs'),
    ]);
  return {
    areas: areas.filter((a) => !a.deleted && !a.archived),
    xp: xp.filter((x) => !x.deleted),
    journeys: journeys.filter((j) => !j.deleted),
    missions: missions.filter((m) => !m.deleted),
    focus: focus.filter((f) => !f.deleted),
    blocks: blocks.filter((b) => !b.deleted),
    sessions: sessions.filter((s) => !s.deleted),
    sketchesThisWeek,
    checkinsThisWeek,
    ...(workouts ? { workouts: workoutFacts(workouts, weekStart, today) } : {}),
    ...(moves ? { freezer: freezerFacts(moves) } : {}),
    ...(sleep ? { sleepNights: sleepFacts(sleep, today) } : {}),
  };
}
