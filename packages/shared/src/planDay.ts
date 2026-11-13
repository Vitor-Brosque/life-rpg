import type { Block, BlockSession, Commitment, DayKey, DayMode, ID } from './types';
import { addDays, dayEndTimestamp, dayKeyOf, logicalTimestamp, timestampAt, weekdayOf } from './dates';
import { occurrencesOn } from './engine';

export interface BlockOccurrence {
  block: Block; day: DayKey;
  plannedStart: number; plannedEnd: number;
  start: number; end: number;          // for skipped: start = end = plannedStart
  version: 'normal' | 'minimum';
  shrunk: boolean;
  state: 'upcoming' | 'current' | 'done' | 'missed' | 'skipped';
  /** 'sem-tempo': did not fit; 'pulado': the user chose "Pular hoje". */
  skipReason?: 'sem-tempo' | 'pulado';
  /** Open session whose end has passed: still current, for up to 30 min after `end`. */
  overrun?: boolean;
  /** Open session that planning treats as ended (30 min past its end, or another block started after it). */
  autoClosed?: boolean;
  session?: BlockSession;
}
export interface PlanDayInput {
  day: DayKey; now: number; dayStartHour: number; dayEndHour: number;
  mode: DayMode; dayStartedAt?: number;
  blocks: Block[]; commitments: Commitment[]; sessions: BlockSession[];
}

const MINUTE = 60000;
/** How long an open session stays current after its end before planning closes it there. */
const OVERRUN_GRACE = 30 * MINUTE;
const hh = (h: number): string => `${String(h).padStart(2, '0')}:00`;

const byPlanOrder = (a: Block, b: Block): number =>
  a.order - b.order || (a.targetStart < b.targetStart ? -1 : a.targetStart > b.targetStart ? 1 : 0);

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
    .sort(byPlanOrder)
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

/** Days an if-then plan looks ahead for the block (today included). */
export const CUE_LOOKAHEAD_DAYS = 14;

/**
 * Day an if-then plan keeps a mission for `block`: the first logical day (from the logical day of
 * `now`, up to 14 days ahead) where the block is planned (it is on that weekday and `modeOf(day)`
 * lets it through) and, for today, has not reached its start yet. `modeOf` defaults to the weekday
 * default of a day with no stored state. Undefined when no such day exists.
 */
export function cueBlockDay(
  block: Block, now: number, dayStartHour: number,
  modeOf: (day: DayKey) => DayMode = (day) => defaultDayMode(day),
): DayKey | undefined {
  const today = dayKeyOf(now, dayStartHour);
  for (let i = 0; i <= CUE_LOOKAHEAD_DAYS; i++) {
    const day = addDays(today, i);
    if (blocksForDay([block], day, modeOf(day)).length === 0) continue;
    if (i === 0 && now >= logicalTimestamp(day, block.targetStart, dayStartHour)) continue;
    return day;
  }
  return undefined;
}

/** The recorded mode, else the weekday default; a weekend stays free even with an old `hardDay`. */
export function defaultDayMode(day: DayKey, state?: { mode?: DayMode; hardDay?: boolean }): DayMode {
  if (state?.mode) return state.mode;
  const wd = weekdayOf(day);
  if (wd === 0 || wd === 6) return 'free';
  return state?.hardDay ? 'low' : 'normal';
}

type StartedSession = BlockSession & { startedAt: number };
const isStarted = (s: BlockSession | undefined): s is StartedSession => s?.startedAt !== undefined;
/** "Pular hoje": skipped, or ended without ever being started. */
const isSkippedByUser = (s: BlockSession | undefined): boolean =>
  !!s && s.startedAt === undefined && (s.skipped === true || s.endedAt !== undefined);

interface Lived { start: number; end: number; open: boolean; overrun: boolean; autoClosed: boolean }

export function planDay(input: PlanDayInput): BlockOccurrence[] {
  const { day, now, dayStartHour, dayEndHour, mode } = input;
  const dayEnd = dayEndTimestamp(day, dayStartHour, dayEndHour);
  const occs = occurrencesOn(input.commitments, day, dayStartHour);
  const sessionOf = (id: string): BlockSession | undefined =>
    input.sessions.find((s) => s.blockId === id && s.day === day && !s.deleted);

  // A block lived today (started or skipped) stays in the plan even when it is archived, not on
  // this weekday or filtered out by the mode; it uses its session's version.
  const listed = blocksForDay(input.blocks, day, mode);
  const listedIds = new Set(listed.map((x) => x.block.id));
  const list = [...listed];
  for (const block of input.blocks) {
    if (block.deleted || listedIds.has(block.id)) continue;
    const s = sessionOf(block.id);
    if (s && (isStarted(s) || isSkippedByUser(s))) list.push({ block, version: s.version });
  }
  list.sort((a, b) => byPlanOrder(a.block, b.block));

  const windowOf = (block: Block, version: 'normal' | 'minimum') => {
    const d = (version === 'minimum' ? block.minimumMin : block.durationMin) * MINUTE;
    const plannedStart = logicalTimestamp(day, block.targetStart, dayStartHour);
    return { d, plannedStart, plannedEnd: plannedStart + d, minMs: block.minimumMin * MINUTE };
  };

  // Started sessions first: their windows and which one (at most) is still open.
  const lived = new Map<ID, Lived>();
  for (const { block, version } of list) {
    const s = sessionOf(block.id);
    if (!isStarted(s)) continue;
    const { plannedEnd, minMs } = windowOf(block, s.version ?? version);
    const start = s.startedAt;
    if (s.endedAt !== undefined) {
      lived.set(block.id, { start, end: s.endedAt, open: false, overrun: false, autoClosed: false });
      continue;
    }
    const end = Math.max(plannedEnd, start + minMs);
    // Forgotten "Encerrar": 30 min after its end the session counts as ended at its end.
    lived.set(block.id, now >= end + OVERRUN_GRACE
      ? { start, end, open: false, overrun: false, autoClosed: true }
      : { start, end, open: true, overrun: now >= end, autoClosed: false });
  }
  // Two open sessions: the one started last is current; the other ended when that one started.
  const open = [...lived.values()].filter((l) => l.open);
  const latest = open.reduce<Lived | undefined>((a, l) => (!a || l.start > a.start ? l : a), undefined);
  for (const l of open) {
    if (l === latest) continue;
    Object.assign(l, { open: false, overrun: false, autoClosed: true, end: Math.max(l.start, Math.min(l.end, latest!.start)) });
  }
  // Earliest start among the blocks after each position: an unstarted block before a started one
  // was passed over, so it is never placed at or after that start.
  const barrier: Array<number | undefined> = [];
  let laterStart: number | undefined;
  for (let i = list.length - 1; i >= 0; i--) {
    barrier[i] = laterStart;
    const l = lived.get(list[i]!.block.id);
    if (l) laterStart = laterStart === undefined ? l.start : Math.min(laterStart, l.start);
  }

  /** Window from `from` that respects commitments, the day end and the minimum (spec §3.5). */
  const place = (from: number, plannedEnd: number, minMs: number): [number, number] | undefined => {
    let s = from;
    for (let guard = 0; guard < 50; guard++) {
      const inside = occs.find((o) => o.startTs <= s && s < o.endTs);
      if (inside) {
        if (inside.endTs < plannedEnd) { s = inside.endTs; continue; }
        return undefined;
      }
      const next = occs.find((o) => o.startTs > s);
      const limit = next ? Math.min(next.startTs, dayEnd) : dayEnd;
      const e = Math.min(Math.max(plannedEnd, s + minMs), limit);
      if (e - s >= minMs) return [s, e];
      if (next && next.startTs <= dayEnd && next.endTs < plannedEnd) { s = next.endTs; continue; }
      return undefined;
    }
    return undefined;
  };

  let cursor = input.dayStartedAt ?? timestampAt(day, hh(dayStartHour));
  let openBefore = false;
  const out: BlockOccurrence[] = [];

  for (const [i, { block, version: modeVersion }] of list.entries()) {
    const session = sessionOf(block.id);
    const version = session?.version ?? modeVersion;
    const { d, plannedStart, plannedEnd, minMs } = windowOf(block, version);
    const base = { block, day, plannedStart, plannedEnd, version, session };
    const skippedAt = { start: plannedStart, end: plannedStart, shrunk: false, state: 'skipped' as const };

    const l = lived.get(block.id);
    if (l) {
      out.push({
        ...base, start: l.start, end: l.end, shrunk: l.end - l.start < d, state: l.open ? 'current' : 'done',
        ...(l.overrun ? { overrun: true } : {}), ...(l.autoClosed ? { autoClosed: true } : {}),
      });
      cursor = Math.max(cursor, l.end);
      if (l.open) openBefore = true;
      continue;
    }
    if (isSkippedByUser(session)) {
      out.push({ ...base, ...skippedAt, skipReason: 'pulado' });
      continue;
    }
    const passedOver = barrier[i];
    if (passedOver !== undefined) {
      if (plannedStart >= passedOver) out.push({ ...base, ...skippedAt, skipReason: 'sem-tempo' });
      else {
        const end = Math.min(plannedEnd, passedOver);
        out.push({ ...base, start: plannedStart, end, shrunk: end - plannedStart < d, state: 'missed' });
      }
      continue;
    }

    let placed = place(openBefore ? Math.max(cursor, plannedStart, now) : Math.max(cursor, plannedStart), plannedEnd, minMs);
    // The mode changed after the shorter version's window ended but inside the normal window
    // (e.g. low energy chosen at 10:30 for a 09:00–12:00 block): the block goes on from now.
    if (placed && now >= placed[1] && plannedStart <= now && now < plannedStart + block.durationMin * MINUTE) {
      placed = place(now, plannedEnd, minMs) ?? placed;
    }
    if (!placed) {
      out.push({ ...base, ...skippedAt, skipReason: 'sem-tempo' });
      continue;
    }
    const [start, end] = placed;
    out.push({ ...base, start, end, shrunk: end - start < d, state: now >= end ? 'missed' : 'upcoming' });
    cursor = end;
  }

  // At most one current: the open session, otherwise the first window containing now.
  if (!out.some((o) => o.state === 'current')) {
    const cur = out.find((o) => o.state === 'upcoming' && o.start <= now && now < o.end);
    if (cur) cur.state = 'current';
  }
  return out.sort((a, b) => a.start - b.start);
}
