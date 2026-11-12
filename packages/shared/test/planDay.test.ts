import { describe, expect, it } from 'vitest';
import type { Block, BlockSession, Commitment, DayMode } from '../src/types';
import { timestampAt } from '../src/dates';
import {
  blocksForDay, defaultDayMode, nextBlockDay, planDay, type PlanDayInput,
} from '../src/planDay';

const DAY = '2026-11-11';
const t = (hhmm: string): number => timestampAt(DAY, hhmm);

function blk(p: Partial<Block> & { id: string }): Block {
  return {
    createdAt: 1, updatedAt: 1, deleted: false, name: p.id, weekdays: [1, 2, 3, 4, 5], order: 0,
    targetStart: '09:00', durationMin: 60, minimumMin: 30, kind: 'focus', protected: false,
    checklist: [], archived: false, ...p,
  };
}
const b1 = blk({ id: 'b1', name: 'Tech', order: 0, targetStart: '09:00', durationMin: 180, minimumMin: 45, kind: 'focus', journeyId: 'j-tech' });
const b2 = blk({ id: 'b2', name: 'Treino', order: 1, targetStart: '12:30', durationMin: 120, minimumMin: 45, kind: 'body', areaId: 'area-vigor' });
const b3 = blk({ id: 'b3', name: 'Facul', order: 2, targetStart: '15:00', durationMin: 90, minimumMin: 30, kind: 'study', protected: true, areaId: 'area-facul' });
const b4 = blk({ id: 'b4', name: 'Tecnico', order: 3, targetStart: '16:45', durationMin: 60, minimumMin: 25, kind: 'study', areaId: 'area-intelecto' });
const b5 = blk({ id: 'b5', name: 'Compl', order: 4, targetStart: '18:00', durationMin: 40, minimumMin: 10, kind: 'light' });
const BLOCKS = [b1, b2, b3, b4, b5];

const aula: Commitment = {
  id: 'aula', createdAt: 1, updatedAt: 1, deleted: false, title: 'Aula', date: '2026-11-02',
  start: '19:00', end: '23:00', weekdays: [1, 2, 3, 4, 5], remind: false,
};

function plan(p: Partial<PlanDayInput> = {}) {
  return planDay({
    day: DAY, now: t('08:45'), dayStartHour: 4, dayEndHour: 0, mode: 'normal',
    dayStartedAt: t('08:30'), blocks: BLOCKS, commitments: [aula], sessions: [], ...p,
  });
}
const by = (occ: ReturnType<typeof plan>, id: string) => occ.find((o) => o.block.id === id)!;
const win = (occ: ReturnType<typeof plan>, id: string) => [by(occ, id).start, by(occ, id).end];
function session(blockId: string, startedAt?: number, endedAt?: number): BlockSession {
  return {
    id: `bs-${blockId}-${DAY}`, createdAt: 1, updatedAt: 1, deleted: false, blockId, day: DAY,
    startedAt, endedAt, version: 'normal',
  };
}

describe('planDay', () => {
  it('1. normal day on time', () => {
    const o = plan();
    expect(win(o, 'b1')).toEqual([t('09:00'), t('12:00')]);
    expect(win(o, 'b2')).toEqual([t('12:30'), t('14:30')]);
    expect(win(o, 'b3')).toEqual([t('15:00'), t('16:30')]);
    expect(win(o, 'b4')).toEqual([t('16:45'), t('17:45')]);
    expect(win(o, 'b5')).toEqual([t('18:00'), t('18:40')]);
    expect(o.every((x) => x.state === 'upcoming' && !x.shrunk && x.version === 'normal')).toBe(true);
    expect(o.map((x) => x.block.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
  });

  it('2. late start keeps the target end and shrinks the block', () => {
    const o = plan({ dayStartedAt: t('10:30') });
    expect(win(o, 'b1')).toEqual([t('10:30'), t('12:00')]);
    expect(by(o, 'b1').shrunk).toBe(true);
    expect(win(o, 'b2')).toEqual([t('12:30'), t('14:30')]);
    expect(by(o, 'b2').shrunk).toBe(false);
  });

  it('3. shrinks down to the minimum', () => {
    const o = plan({ dayStartedAt: t('11:45') });
    expect(win(o, 'b1')).toEqual([t('11:45'), t('12:30')]);
    expect(by(o, 'b1').shrunk).toBe(true);
    expect(win(o, 'b2')).toEqual([t('12:30'), t('14:30')]);
  });

  it('4. very late start cascades with shrinking', () => {
    const o = plan({ dayStartedAt: t('14:00'), now: t('14:00') });
    expect(win(o, 'b1')).toEqual([t('14:00'), t('14:45')]);
    expect(by(o, 'b1').state).toBe('current');
    expect(win(o, 'b2')).toEqual([t('14:45'), t('15:30')]);
    expect(win(o, 'b3')).toEqual([t('15:30'), t('16:30')]);
    expect(by(o, 'b3').shrunk).toBe(true);
    expect(win(o, 'b4')).toEqual([t('16:45'), t('17:45')]);
    expect(win(o, 'b5')).toEqual([t('18:00'), t('18:40')]);
  });

  it('5. never jumps the class: blocks that do not fit are skipped', () => {
    const o = plan({ dayStartedAt: t('18:30'), now: t('18:30') });
    expect(by(o, 'b1').state).toBe('skipped');
    expect(by(o, 'b1').skipReason).toBe('sem-tempo');
    expect(by(o, 'b2').state).toBe('skipped');
    expect(win(o, 'b3')).toEqual([t('18:30'), t('19:00')]);
    expect(by(o, 'b3').state).toBe('current');
    expect(by(o, 'b4').state).toBe('skipped');
    expect(by(o, 'b5').state).toBe('skipped');
    const skipped = by(o, 'b1');
    expect(skipped.start).toBe(skipped.plannedStart);
    expect(skipped.end).toBe(skipped.plannedStart);
    expect(o.filter((x) => x.state !== 'skipped').every((x) => x.end <= t('19:00'))).toBe(true);
  });

  it('6. a commitment inside the window pushes the block after it', () => {
    const dentista: Commitment = {
      id: 'dent', createdAt: 1, updatedAt: 1, deleted: false, title: 'Dentista', date: DAY,
      start: '15:20', end: '16:00', remind: false,
    };
    const o = plan({ commitments: [aula, dentista] });
    expect(win(o, 'b3')).toEqual([t('16:00'), t('16:30')]);
    expect(by(o, 'b3').shrunk).toBe(true);
    expect(win(o, 'b4')).toEqual([t('16:45'), t('17:45')]);
  });

  it('7. low energy: minimum versions, no light blocks', () => {
    const o = plan({ mode: 'low' });
    expect(win(o, 'b1')).toEqual([t('09:00'), t('09:45')]);
    expect(win(o, 'b2')).toEqual([t('12:30'), t('13:15')]);
    expect(win(o, 'b3')).toEqual([t('15:00'), t('15:30')]);
    expect(win(o, 'b4')).toEqual([t('16:45'), t('17:10')]);
    expect(o.find((x) => x.block.id === 'b5')).toBeUndefined();
    expect(o.every((x) => x.version === 'minimum' && !x.shrunk)).toBe(true);
  });

  it('8. recovery: only protected blocks, minimum version', () => {
    const o = plan({ mode: 'recovery' });
    expect(o.map((x) => x.block.id)).toEqual(['b3']);
    expect(win(o, 'b3')).toEqual([t('15:00'), t('15:30')]);
    expect(by(o, 'b3').version).toBe('minimum');
  });

  it('9. free day and weekend have no blocks', () => {
    expect(plan({ mode: 'free' })).toEqual([]);
    expect(plan({ day: '2026-11-14', mode: 'normal' })).toEqual([]);
  });

  it('10. a session started before the target starts there and keeps the target end', () => {
    const o = plan({ sessions: [session('b1', t('08:40'))], now: t('09:30') });
    expect(win(o, 'b1')).toEqual([t('08:40'), t('12:00')]);
    expect(by(o, 'b1').state).toBe('current');
  });

  it('11. an open session past its end stays current (overrun) for 30 min; the next block starts at now', () => {
    const before = plan({ sessions: [session('b3', t('15:00'))], now: t('16:00') });
    expect(by(before, 'b3').state).toBe('current');
    expect(by(before, 'b3').overrun).toBeFalsy();
    const o = plan({ sessions: [session('b3', t('15:00'))], now: t('16:50') });
    expect(by(o, 'b3').state).toBe('current');
    expect(by(o, 'b3').overrun).toBe(true);
    expect(by(o, 'b3').autoClosed).toBeFalsy();
    expect(win(o, 'b3')).toEqual([t('15:00'), t('16:30')]);
    expect(win(o, 'b4')).toEqual([t('16:50'), t('17:45')]);
    expect(by(o, 'b4').state).toBe('upcoming');
    expect(o.filter((x) => x.state === 'current')).toHaveLength(1);
  });

  it('11b. 30 min after its end an open session is closed at its end and later blocks are placed normally', () => {
    const o = plan({ sessions: [session('b3', t('15:00'))], now: t('17:05') });
    expect(by(o, 'b3').state).toBe('done');
    expect(by(o, 'b3').autoClosed).toBe(true);
    expect(by(o, 'b3').overrun).toBeFalsy();
    expect(win(o, 'b3')).toEqual([t('15:00'), t('16:30')]);
    expect(win(o, 'b4')).toEqual([t('16:45'), t('17:45')]);
    expect(by(o, 'b4').state).toBe('current');
    expect(win(o, 'b5')).toEqual([t('18:00'), t('18:40')]);
  });

  it('12. an ended session is done and frees the cursor', () => {
    const o = plan({ sessions: [session('b1', t('09:00'), t('10:00'))], now: t('10:30') });
    expect(win(o, 'b1')).toEqual([t('09:00'), t('10:00')]);
    expect(by(o, 'b1').state).toBe('done');
    expect(win(o, 'b2')).toEqual([t('12:30'), t('14:30')]);
  });

  it('13. a past block without a session is missed', () => {
    const o = plan({ now: t('12:10') });
    expect(by(o, 'b1').state).toBe('missed');
    expect(by(o, 'b2').state).toBe('upcoming');
  });

  it('14. without dayStartedAt blocks sit at their targets', () => {
    const o = plan({ dayStartedAt: undefined, now: t('05:00') });
    expect(win(o, 'b1')).toEqual([t('09:00'), t('12:00')]);
    expect(win(o, 'b5')).toEqual([t('18:00'), t('18:40')]);
    expect(o.every((x) => !x.shrunk)).toBe(true);
  });

  it('15. a target before dayStartHour belongs to the next calendar morning', () => {
    const late = blk({ id: 'late', targetStart: '01:00', durationMin: 30, minimumMin: 15 });
    const o = plan({ blocks: [late], commitments: [], dayEndHour: 3, dayStartedAt: undefined });
    expect(o[0]!.plannedStart).toBe(timestampAt('2026-11-12', '01:00'));
    expect(o[0]!.state).not.toBe('skipped');
  });

  it('17. day start and end both at midnight: the day lasts until the next midnight', () => {
    const o = plan({ dayStartHour: 0, dayEndHour: 0 });
    expect(o.every((x) => x.state !== 'skipped')).toBe(true);
    expect(win(o, 'b1')).toEqual([t('09:00'), t('12:00')]);
    expect(win(o, 'b5')).toEqual([t('18:00'), t('18:40')]);
    const late = blk({ id: 'late', targetStart: '23:15', durationMin: 30, minimumMin: 15 });
    const l = plan({ blocks: [late], commitments: [], dayStartHour: 0, dayEndHour: 0 });
    expect(win(l, 'late')).toEqual([t('23:15'), t('23:45')]);
  });

  it('18. day end 0 or 23 with day start 4 is unchanged', () => {
    const late = blk({ id: 'late', targetStart: '23:15', durationMin: 30, minimumMin: 15 });
    expect(win(plan({ blocks: [late], commitments: [] }), 'late')).toEqual([t('23:15'), t('23:45')]);
    const at23 = plan({ blocks: [late], commitments: [], dayEndHour: 23 });
    expect(by(at23, 'late').state).toBe('skipped');
    expect(win(plan({ dayEndHour: 23 }), 'b5')).toEqual([t('18:00'), t('18:40')]);
  });

  it('19. a block skipped by the user ("Pular hoje") is skipped at its target and frees the time', () => {
    const skipped: BlockSession = { ...session('b1', undefined, t('09:10')), skipped: true };
    const o = plan({ sessions: [skipped], now: t('09:15') });
    expect(by(o, 'b1').state).toBe('skipped');
    expect(by(o, 'b1').skipReason).toBe('pulado');
    expect(win(o, 'b1')).toEqual([t('09:00'), t('09:00')]);
    expect(win(o, 'b2')).toEqual([t('12:30'), t('14:30')]);
    expect(o.some((x) => x.state === 'current')).toBe(false);
    // An ended session that was never started counts the same.
    const legacy = plan({ sessions: [session('b2', undefined, t('12:40'))], now: t('12:45') });
    expect(by(legacy, 'b2').state).toBe('skipped');
    expect(by(legacy, 'b2').skipReason).toBe('pulado');
    expect(win(legacy, 'b3')).toEqual([t('15:00'), t('16:30')]);
  });

  it('20. an unstarted block before a started one is missed, never current or upcoming', () => {
    const inicio = blk({ id: 'r0', order: -1, targetStart: '08:30', durationMin: 30, minimumMin: 15, kind: 'routine' });
    const blocks = [inicio, ...BLOCKS];
    const late = plan({ blocks, sessions: [session('b1', t('09:20'))], now: t('09:25') });
    expect(by(late, 'r0').state).toBe('missed');
    expect(by(late, 'b1').state).toBe('current');
    // Started early, while the routine's window is still running.
    const early = plan({ blocks, sessions: [session('b1', t('08:40'))], now: t('08:45') });
    expect(by(early, 'r0').state).toBe('missed');
    expect(by(early, 'r0').end).toBeLessThanOrEqual(t('08:40'));
    expect(early.filter((x) => x.state === 'current').map((x) => x.block.id)).toEqual(['b1']);
  });

  it('21. starting Treino passes over an unstarted Bloco 1 at its planned window', () => {
    const o = plan({ dayStartedAt: t('13:50'), sessions: [session('b2', t('14:00'))], now: t('14:10') });
    expect(by(o, 'b1').state).toBe('missed');
    expect(win(o, 'b1')).toEqual([t('09:00'), t('12:00')]);
    expect(by(o, 'b2').state).toBe('current');
    // A passed-over block whose target is after that start does not fit anymore.
    const evening = blk({ id: 'x', order: 0, targetStart: '16:00', durationMin: 30, minimumMin: 15 });
    const e = plan({ blocks: [evening, { ...b2, order: 1 }], sessions: [session('b2', t('13:00'))], now: t('13:10') });
    expect(by(e, 'x').state).toBe('skipped');
    expect(by(e, 'x').skipReason).toBe('sem-tempo');
  });

  it('22. with two open sessions only the later-started one is current', () => {
    const o = plan({ sessions: [session('b1', t('09:00')), session('b2', t('10:00'))], now: t('10:30') });
    expect(o.filter((x) => x.state === 'current').map((x) => x.block.id)).toEqual(['b2']);
    expect(by(o, 'b1').state).toBe('done');
    expect(by(o, 'b1').autoClosed).toBe(true);
    expect(win(o, 'b1')).toEqual([t('09:00'), t('10:00')]);
    // Order does not matter, only the start time.
    const r = plan({ sessions: [session('b2', t('12:30')), session('b1', t('13:00'))], now: t('13:10') });
    expect(r.filter((x) => x.state === 'current').map((x) => x.block.id)).toEqual(['b1']);
    expect(win(r, 'b2')).toEqual([t('12:30'), t('13:00')]);
  });

  it('23. switching to low energy mid-block keeps the current unstarted block, from now', () => {
    const o = plan({ mode: 'low', dayStartedAt: t('08:00'), now: t('10:30') });
    expect(win(o, 'b1')).toEqual([t('10:30'), t('11:15')]);
    expect(by(o, 'b1').state).toBe('current');
    expect(by(o, 'b1').version).toBe('minimum');
    expect(win(o, 'b2')).toEqual([t('12:30'), t('13:15')]);
    // Past the normal window it is missed as usual.
    expect(by(plan({ mode: 'low', dayStartedAt: t('08:00'), now: t('12:10') }), 'b1').state).toBe('missed');
  });

  it('24. a block with a session today stays in the plan with the session version', () => {
    const light: BlockSession = { ...session('b5', t('18:00')), version: 'normal' };
    const o = plan({ mode: 'low', sessions: [light], now: t('18:10') });
    expect(by(o, 'b5').state).toBe('current');
    expect(by(o, 'b5').version).toBe('normal');
    expect(win(o, 'b5')).toEqual([t('18:00'), t('18:40')]);
    const archived = plan({ blocks: [{ ...b1, archived: true }, b2], sessions: [session('b1', t('09:00'))], now: t('09:30') });
    expect(by(archived, 'b1').state).toBe('current');
    const sat = '2026-11-14';
    const weekend = planDay({
      day: sat, now: timestampAt(sat, '09:30'), dayStartHour: 4, dayEndHour: 0, mode: 'normal',
      blocks: BLOCKS, commitments: [], sessions: [{ ...session('b1', timestampAt(sat, '09:00')), day: sat }],
    });
    expect(weekend.map((x) => [x.block.id, x.state])).toEqual([['b1', 'current']]);
    // A version choice alone (no start) does not keep a filtered block.
    const chosen: BlockSession = { ...session('b5'), version: 'minimum' };
    expect(plan({ mode: 'low', sessions: [chosen] }).find((x) => x.block.id === 'b5')).toBeUndefined();
  });

  it('16. nextBlockDay, defaultDayMode and blocksForDay', () => {
    expect(nextBlockDay(b1, '2026-11-13')).toBe('2026-11-16');
    expect(nextBlockDay(b1, '2026-11-11')).toBe('2026-11-12');
    expect(nextBlockDay({ ...b1, weekdays: [] }, '2026-11-13')).toBeUndefined();
    expect(defaultDayMode('2026-11-14')).toBe('free');
    expect(defaultDayMode('2026-11-15')).toBe('free');
    expect(defaultDayMode('2026-11-11')).toBe('normal');
    expect(defaultDayMode('2026-11-11', { hardDay: true })).toBe('low');
    expect(defaultDayMode('2026-11-14', { hardDay: true })).toBe('free');
    expect(defaultDayMode('2026-11-15', { hardDay: true })).toBe('free');
    expect(defaultDayMode('2026-11-14', { hardDay: true, mode: 'low' })).toBe('low');
    expect(defaultDayMode('2026-11-14', { mode: 'normal' as DayMode })).toBe('normal');
    expect(blocksForDay(BLOCKS, DAY, 'recovery').map((x) => x.block.id)).toEqual(['b3']);
    expect(blocksForDay([{ ...b1, archived: true }, { ...b2, deleted: true }], DAY, 'normal')).toEqual([]);
  });
});
