import { describe, expect, it } from 'vitest';
import type { Block, BlockSession, Checkin, Commitment, DayState, XpEvent } from '../src/types';
import { timestampAt } from '../src/dates';
import { weekKey, weekStats, type WeekStatsInput } from '../src/weekStats';

function blk(p: Partial<Block> & { id: string }): Block {
  return {
    createdAt: 1, updatedAt: 1, deleted: false, name: p.id, weekdays: [1, 2, 3, 4, 5], order: 0,
    targetStart: '09:00', durationMin: 60, minimumMin: 30, kind: 'focus', protected: false,
    checklist: [], archived: false, ...p,
  };
}
const BLOCKS = [
  blk({ id: 'b1', order: 0, targetStart: '09:00', durationMin: 180, minimumMin: 45 }),
  blk({ id: 'b2', order: 1, targetStart: '12:30', durationMin: 120, minimumMin: 45, kind: 'body' }),
  blk({ id: 'b3', order: 2, targetStart: '15:00', durationMin: 90, minimumMin: 30, kind: 'study', protected: true }),
  blk({ id: 'b4', order: 3, targetStart: '16:45', durationMin: 60, minimumMin: 25, kind: 'study' }),
  blk({ id: 'b5', order: 4, targetStart: '18:00', durationMin: 40, minimumMin: 10, kind: 'light' }),
];
const aula: Commitment = {
  id: 'aula', createdAt: 1, updatedAt: 1, deleted: false, title: 'Aula', date: '2026-11-02',
  start: '19:00', end: '23:00', weekdays: [1, 2, 3, 4, 5], remind: false,
};
const MON = '2026-11-09';
const sess = (blockId: string, version: 'normal' | 'minimum', start: string, end: string): BlockSession => ({
  id: `bs-${blockId}-${MON}`, createdAt: 1, updatedAt: 1, deleted: false, blockId, day: MON,
  startedAt: timestampAt(MON, start), endedAt: timestampAt(MON, end), version,
});
const checkin = (id: string, kind: 'start' | 'escape', feelings: string[]): Checkin => ({
  id, createdAt: 1, updatedAt: 1, deleted: false, at: timestampAt(MON, '10:00'), kind, feelings,
});
const xp = (id: string, dayKey: string, reason: XpEvent['reason'] = 'block'): XpEvent => ({
  id, createdAt: 1, updatedAt: 1, deleted: false, at: timestampAt(dayKey, '10:00'), amount: 5, reason, dayKey,
});
const free: DayState = {
  id: '2026-11-10', createdAt: 1, updatedAt: 1, deleted: false, hardDay: false, reviewDone: false, mode: 'free',
};

function input(p: Partial<WeekStatsInput> = {}): WeekStatsInput {
  return {
    weekStart: MON, today: '2026-11-11', dayStates: [], sessions: [], checkins: [], xpEvents: [],
    blocks: BLOCKS, commitments: [aula], dayStartHour: 4, dayEndHour: 0, ...p,
  };
}

describe('weekStats', () => {
  it('counts a week with a started Monday, a free Tuesday and today excluded', () => {
    const s = weekStats(input({
      dayStates: [free],
      sessions: [sess('b1', 'normal', '09:00', '12:00'), sess('b2', 'minimum', '12:30', '13:15')],
      checkins: [
        checkin('c1', 'start', ['ansiedade']), checkin('c2', 'start', ['ansiedade', 'tédio']),
        checkin('c3', 'escape', ['tédio']),
      ],
      xpEvents: [xp('x1', MON), xp('x2', '2026-11-11'), xp('x3', MON, 'resumption')],
    }));
    expect(s.planned).toBe(5);
    expect(s.started).toBe(2);
    expect(s.minimumUsed).toBe(1);
    expect(s.workdays).toBe(1);
    expect(s.activeWorkdays).toBe(1);
    expect(s.resumptions).toBe(1);
    expect(s.escapes).toBe(1);
    expect(s.topFeeling).toBe('ansiedade');
  });
  it('routine blocks (checklists like "Início do dia") count neither as planned nor as started', () => {
    const routine = blk({ id: 'r1', order: -1, targetStart: '08:30', durationMin: 30, minimumMin: 15, kind: 'routine' });
    const s = weekStats(input({
      blocks: [routine, ...BLOCKS],
      dayStates: [free],
      sessions: [sess('r1', 'normal', '08:30', '09:00'), sess('b1', 'normal', '09:00', '12:00')],
    }));
    expect(s.planned).toBe(5);
    expect(s.started).toBe(1);
  });
  it('a block counts as planned only from its creation (routine created Thursday 10:00)', () => {
    const thu10 = timestampAt('2026-11-12', '10:00');
    const s = weekStats(input({ today: '2026-11-14', blocks: BLOCKS.map((b) => ({ ...b, createdAt: thu10 })) }));
    // Mon–Wed: none; Thursday: the four blocks whose target is ≥ 10:00; Friday: all five.
    expect(s.planned).toBe(4 + 5);
  });

  it('started comes from the plan: never above planned, nothing from free days or deleted blocks', () => {
    const on = (day: string, blockId: string, start: string, end: string, version: 'normal' | 'minimum' = 'normal'): BlockSession => ({
      id: `bs-${blockId}-${day}`, createdAt: 1, updatedAt: 1, deleted: false, blockId, day,
      startedAt: timestampAt(day, start), endedAt: timestampAt(day, end), version,
    });
    const s = weekStats(input({
      today: '2026-11-14',
      blocks: [...BLOCKS, { ...BLOCKS[0]!, id: 'gone', deleted: true }],
      dayStates: [free],
      sessions: [
        on(MON, 'b1', '09:00', '12:00', 'minimum'),
        on('2026-11-10', 'b1', '09:00', '12:00'),          // Tuesday is free
        on('2026-11-11', 'gone', '09:00', '10:00'),        // deleted block
        { ...on('2026-11-12', 'b2', '12:30', '13:00'), deleted: true },
        { ...on('2026-11-13', 'b3', '15:00', '15:30'), startedAt: undefined, skipped: true }, // "Pular hoje"
      ],
    }));
    expect(s.started).toBe(1);
    expect(s.minimumUsed).toBe(1);
    expect(s.planned).toBe(4 * 5); // Mon, Wed, Thu, Fri; the skipped block was still planned
    expect(s.started).toBeLessThanOrEqual(s.planned);
  });

  it('every counter uses only the days before today', () => {
    const at = (day: string) => timestampAt(day, '10:00');
    const s = weekStats(input({
      checkins: [
        checkin('c1', 'escape', []), { ...checkin('c2', 'escape', []), at: at('2026-11-11') },
        checkin('c3', 'start', ['tédio']), { ...checkin('c4', 'start', ['ansiedade']), at: at('2026-11-11') },
        { ...checkin('c5', 'start', ['ansiedade']), at: at('2026-11-11') },
      ],
      xpEvents: [xp('x1', MON, 'resumption'), xp('x2', '2026-11-11', 'resumption')],
    }));
    expect(s.escapes).toBe(1);
    expect(s.resumptions).toBe(1);
    expect(s.topFeeling).toBe('tédio');
  });

  it('empty week gives zeros', () => {
    const s = weekStats(input({ today: MON }));
    expect(s).toEqual({
      planned: 0, started: 0, minimumUsed: 0, resumptions: 0, escapes: 0,
      topFeeling: undefined, activeWorkdays: 0, workdays: 0,
    });
  });
  it('ties on feeling resolve alphabetically', () => {
    const s = weekStats(input({ checkins: [checkin('c1', 'start', ['tédio', 'ansiedade'])] }));
    expect(s.topFeeling).toBe('ansiedade');
  });
});

describe('weekKey', () => {
  it('returns the Monday of the week', () => {
    expect(weekKey('2026-11-11')).toBe('2026-11-09');
    expect(weekKey('2026-11-15')).toBe('2026-11-09');
    expect(weekKey('2026-11-09')).toBe('2026-11-09');
  });
});
