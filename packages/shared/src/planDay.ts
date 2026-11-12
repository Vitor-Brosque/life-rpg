import type { Block, BlockSession, Commitment, DayKey, DayMode } from './types';
import { addDays, logicalTimestamp, timestampAt, weekdayOf } from './dates';
import { occurrencesOn } from './engine';

export interface BlockOccurrence {
  block: Block; day: DayKey;
  plannedStart: number; plannedEnd: number;
  start: number; end: number;          // for skipped: start = end = plannedStart
  version: 'normal' | 'minimum';
  shrunk: boolean;
  state: 'upcoming' | 'current' | 'done' | 'missed' | 'skipped';
  skipReason?: 'sem-tempo';
  session?: BlockSession;
}
export interface PlanDayInput {
  day: DayKey; now: number; dayStartHour: number; dayEndHour: number;
  mode: DayMode; dayStartedAt?: number;
  blocks: Block[]; commitments: Commitment[]; sessions: BlockSession[];
}

const MINUTE = 60000;
const hh = (h: number): string => `${String(h).padStart(2, '0')}:00`;

/** Blocks that apply to `day` under `mode`, in plan order, with the version they use. */
export function blocksForDay(
  blocks: Block[], day: DayKey, mode: DayMode,
): Array<{ block: Block; version: 'normal' | 'minimum' }> {
  if (mode === 'free') return [];
  const wd = weekdayOf(day);
  const version = mode === 'normal' ? 'normal' : 'minimum';
  return blocks
    .filter((b) => !b.deleted && !b.archived && b.weekdays.includes(wd))
    .filter((b) => (mode === 'recovery' ? b.protected : mode === 'low' ? b.kind !== 'light' : true))
    .sort((a, b) => a.order - b.order || (a.targetStart < b.targetStart ? -1 : a.targetStart > b.targetStart ? 1 : 0))
    .map((block) => ({ block, version }));
}

/** First day after `after` (within 7 days) that has the block; undefined when it never occurs. */
export function nextBlockDay(block: Block, after: DayKey): DayKey | undefined {
  if (block.weekdays.length === 0) return undefined;
  for (let i = 1; i <= 7; i++) {
    const d = addDays(after, i);
    if (block.weekdays.includes(weekdayOf(d))) return d;
  }
  return undefined;
}

export function defaultDayMode(day: DayKey, state?: { mode?: DayMode; hardDay?: boolean }): DayMode {
  if (state?.mode) return state.mode;
  if (state?.hardDay) return 'low';
  const wd = weekdayOf(day);
  return wd === 0 || wd === 6 ? 'free' : 'normal';
}

export function planDay(input: PlanDayInput): BlockOccurrence[] {
  const { day, now, dayStartHour, dayEndHour, mode } = input;
  const dayEnd = logicalTimestamp(day, hh(dayEndHour), dayStartHour);
  const occs = occurrencesOn(input.commitments, day, dayStartHour);
  const sessionOf = (id: string): BlockSession | undefined =>
    input.sessions.find((s) => s.blockId === id && s.day === day && !s.deleted);

  let cursor = input.dayStartedAt ?? timestampAt(day, hh(dayStartHour));
  let openBefore = false;
  const out: BlockOccurrence[] = [];

  for (const { block, version: modeVersion } of blocksForDay(input.blocks, day, mode)) {
    const session = sessionOf(block.id);
    const version = session?.version ?? modeVersion;
    const d = version === 'minimum' ? block.minimumMin : block.durationMin;
    const plannedStart = logicalTimestamp(day, block.targetStart, dayStartHour);
    const plannedEnd = plannedStart + d * MINUTE;
    const minMs = block.minimumMin * MINUTE;
    const base = { block, day, plannedStart, plannedEnd, version, session };

    if (session?.startedAt !== undefined) {
      const start = session.startedAt;
      const open = session.endedAt === undefined;
      const end = session.endedAt ?? Math.max(plannedEnd, start + minMs);
      out.push({ ...base, start, end, shrunk: end - start < d * MINUTE, state: open ? 'current' : 'done' });
      cursor = end;
      if (open) openBefore = true;
      continue;
    }

    let s = Math.max(cursor, plannedStart);
    if (openBefore) s = Math.max(s, now);
    let placed: [number, number] | undefined;
    for (let guard = 0; guard < 50; guard++) {
      const inside = occs.find((o) => o.startTs <= s && s < o.endTs);
      if (inside) {
        if (inside.endTs < plannedEnd) { s = inside.endTs; continue; }
        break;
      }
      const next = occs.find((o) => o.startTs > s);
      const limit = next ? Math.min(next.startTs, dayEnd) : dayEnd;
      const e = Math.min(Math.max(plannedEnd, s + minMs), limit);
      if (e - s >= minMs) { placed = [s, e]; break; }
      if (next && next.startTs <= dayEnd && next.endTs < plannedEnd) { s = next.endTs; continue; }
      break;
    }

    if (!placed) {
      out.push({
        ...base, start: plannedStart, end: plannedStart, shrunk: false,
        state: 'skipped', skipReason: 'sem-tempo',
      });
      continue;
    }
    const [start, end] = placed;
    out.push({
      ...base, start, end, shrunk: end - start < d * MINUTE,
      state: now >= end ? 'missed' : 'upcoming',
    });
    cursor = end;
  }

  // At most one current: an open session wins, otherwise the first window containing now.
  const open = out.find((o) => o.state === 'current');
  if (open) {
    for (const o of out) if (o !== open && o.state === 'current') o.state = 'upcoming';
  } else {
    const cur = out.find((o) => o.state === 'upcoming' && o.start <= now && now < o.end);
    if (cur) cur.state = 'current';
  }
  return out.sort((a, b) => a.start - b.start);
}
