import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { liveQuery } from 'dexie';
import type { Block, Commitment, DayState, Settings, XpEvent } from '@life/shared';
import { formatHHmm } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { newRecord, onLocalChange, patch, put } from '../src/db/repo';
import {
  useBlocks, useCharacterStats, useCurrentBlock, useDayMode, useDayPlan, useEngine, useNextBlock,
} from '../src/db/hooks';
import {
  applyRoutine, archiveBlock, copyBlockDays, createMission, defaultRoutine, endBlock, isFreeDayFor,
  lastNextAction, reorderBlocks, saveBlock, saveNextAction, setBlockVersion, setDayMode, skipBlock, startBlock,
} from '../src/domain/actions';

const base = { createdAt: 1, updatedAt: 1, deleted: false };
const WD = [1, 2, 3, 4, 5];
const block = (b: Partial<Block> & Pick<Block, 'id' | 'name' | 'order' | 'targetStart' | 'durationMin' | 'minimumMin' | 'kind'>): Block => ({
  ...base, weekdays: WD, protected: false, checklist: [], archived: false, ...b,
});
const FIXTURE: Block[] = [
  block({ id: 'b1', name: 'Tech', order: 0, targetStart: '09:00', durationMin: 180, minimumMin: 45, kind: 'focus', journeyId: 'j-tech' }),
  block({ id: 'b2', name: 'Treino', order: 1, targetStart: '12:30', durationMin: 120, minimumMin: 45, kind: 'body', areaId: 'area-vigor' }),
  block({ id: 'b3', name: 'Facul', order: 2, targetStart: '15:00', durationMin: 90, minimumMin: 30, kind: 'study', protected: true, areaId: 'area-facul' }),
  block({ id: 'b4', name: 'Tecnico', order: 3, targetStart: '16:45', durationMin: 60, minimumMin: 25, kind: 'study', areaId: 'area-intelecto' }),
  block({ id: 'b5', name: 'Compl', order: 4, targetStart: '18:00', durationMin: 40, minimumMin: 10, kind: 'light' }),
];
const AULA: Commitment = {
  ...base, id: 'aula', title: 'Aula', date: '2026-11-02', start: '19:00', end: '23:00', weekdays: WD, remind: true,
};

const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);
const xpOf = async () => (await db.xpEvents.toArray()).filter((x) => !x.deleted);
const xpTotal = async () => (await xpOf()).reduce((s, x) => s + x.amount, 0);
const pastXp = (dayKey: string) => put('xpEvents', newRecord<XpEvent>({ at: 1, amount: 8, reason: 'complete', dayKey }));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 10));
  await db.delete(); await db.open();
  await ensureSeed();
  await patch<Settings>('settings', 'settings', { dayEndHour: 0 });
  await db.blocks.bulkPut(FIXTURE);
  await db.commitments.put(AULA);
});
afterEach(() => { vi.useRealTimers(); });

describe('day mode', () => {
  it('sets the mode and keeps the first start time', async () => {
    await setDayMode('low');
    const first = await db.dayState.get('2026-11-11');
    expect(first).toMatchObject({ mode: 'low', startedAt: at(11, 10).getTime(), hardDay: true });
    vi.setSystemTime(at(11, 11));
    await setDayMode('normal');
    expect(await db.dayState.get('2026-11-11')).toMatchObject({ mode: 'normal', startedAt: at(11, 10).getTime(), hardDay: false });
  });

  it('isFreeDayFor uses the recorded mode, then the weekday', () => {
    const states = [{ ...base, id: '2026-11-09', hardDay: false, reviewDone: false, mode: 'free' }] as DayState[];
    const free = isFreeDayFor(states);
    expect(free('2026-11-09')).toBe(true);   // Monday marked free
    expect(free('2026-11-10')).toBe(false);  // Tuesday, no state
    expect(free('2026-11-08')).toBe(true);   // Sunday, no state
    expect(isFreeDayFor([{ ...base, id: '2026-11-08', hardDay: false, reviewDone: false, mode: 'normal' }])('2026-11-08')).toBe(false);
  });
});

describe('startBlock', () => {
  it('creates one session and awards block XP once', async () => {
    expect(await startBlock('b2')).toEqual({ xp: 5, resumption: false });
    vi.setSystemTime(at(11, 10, 20));
    expect(await startBlock('b2')).toEqual({ xp: 0, resumption: false });
    const sessions = await db.blockSessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: 'bs-b2-2026-11-11', blockId: 'b2', day: '2026-11-11', startedAt: at(11, 10).getTime(), version: 'normal' });
    const xp = await xpOf();
    expect(xp).toHaveLength(1);
    expect(xp[0]).toMatchObject({ id: 'xp-block-b2-2026-11-11', amount: 5, reason: 'block', dayKey: '2026-11-11', areaId: 'area-vigor' });
    expect((await db.dayState.get('2026-11-11'))!.startedAt).toBe(at(11, 10).getTime());
  });

  it('concurrent starts create one session and one block XP', async () => {
    const results = await Promise.all([startBlock('b2'), startBlock('b2'), startBlock('b2')]);
    expect(results.map((r) => r.xp).sort()).toEqual([0, 0, 5]);
    expect(await db.blockSessions.count()).toBe(1);
    expect((await xpOf()).map((x) => x.id)).toEqual(['xp-block-b2-2026-11-11']);
  });

  it('sets today to normal when the day type was not chosen, and keeps a chosen one', async () => {
    await startBlock('b2');
    expect(await db.dayState.get('2026-11-11')).toMatchObject({ mode: 'normal', hardDay: false, startedAt: at(11, 10).getTime() });
    vi.setSystemTime(at(12, 10));
    await setDayMode('low');
    await startBlock('b2');
    expect((await db.dayState.get('2026-11-12'))!.mode).toBe('low');
  });

  it('ignores archived and deleted blocks', async () => {
    await db.blocks.update('b5', { archived: true });
    await db.blocks.update('b4', { deleted: true });
    expect(await startBlock('b5')).toEqual({ xp: 0, resumption: false });
    expect(await startBlock('b4')).toEqual({ xp: 0, resumption: false });
    expect(await db.blockSessions.count()).toBe(0);
    expect(await xpOf()).toHaveLength(0);
  });

  it('uses the minimum version on a low-energy day and keeps an earlier day start', async () => {
    vi.setSystemTime(at(11, 9));
    await setDayMode('low');
    vi.setSystemTime(at(11, 10));
    await startBlock('b1');
    expect((await db.blockSessions.get('bs-b1-2026-11-11'))!.version).toBe('minimum');
    expect((await db.dayState.get('2026-11-11'))!.startedAt).toBe(at(11, 9).getTime());
  });

  it('awards the resumption once after two empty workdays', async () => {
    await pastXp('2026-11-06'); // Friday active; weekend free; Mon/Tue empty
    expect(await startBlock('b1')).toEqual({ xp: 15, resumption: true });
    expect(await startBlock('b2')).toEqual({ xp: 5, resumption: false });
    const res = (await xpOf()).filter((x) => x.reason === 'resumption');
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ id: 'xp-resumption-2026-11-11', amount: 10, dayKey: '2026-11-11' });
  });

  it('gives no resumption when a recent workday was active', async () => {
    await pastXp('2026-11-06');
    await pastXp('2026-11-10');
    expect(await startBlock('b1')).toEqual({ xp: 5, resumption: false });
  });

  it('skips days marked free when looking back', async () => {
    await pastXp('2026-11-06');
    await put('dayState', newRecord<DayState>({ id: '2026-11-09', hardDay: false, reviewDone: false, mode: 'free' }));
    // Recent non-free days: Tue 10 (empty) and Fri 6 (active) → not a resumption.
    expect((await startBlock('b1')).resumption).toBe(false);
  });
});

describe('end, version and next action', () => {
  it('endBlock saves the next action that lastNextAction returns on a later day', async () => {
    vi.setSystemTime(at(9, 10));
    await startBlock('b1');
    await endBlock('b1', 'reler a pauta');
    vi.setSystemTime(at(10, 10));
    await startBlock('b1');
    await endBlock('b1', '  abrir o rascunho  ');
    const s = await db.blockSessions.get('bs-b1-2026-11-10');
    expect(s).toMatchObject({ endedAt: at(10, 10).getTime(), nextAction: 'abrir o rascunho' });
    vi.setSystemTime(at(11, 10));
    expect(await lastNextAction('b1', '2026-11-11')).toBe('abrir o rascunho');
    expect(await lastNextAction('b1', '2026-11-10')).toBe('reler a pauta');
    expect(await lastNextAction('b1', '2026-11-09')).toBeUndefined();
    expect(await lastNextAction('b2', '2026-11-11')).toBeUndefined();
  });

  it('endBlock without text keeps the session free of a next action', async () => {
    await startBlock('b1');
    await endBlock('b1', '   ');
    const s = await db.blockSessions.get('bs-b1-2026-11-11');
    expect(s!.endedAt).toBe(at(11, 10).getTime());
    expect(s!.nextAction).toBeUndefined();
  });

  it('skipBlock marks today\'s block as skipped without starting it, and awards no XP', async () => {
    await skipBlock('b1');
    const s = await db.blockSessions.get('bs-b1-2026-11-11');
    expect(s).toMatchObject({ skipped: true, endedAt: at(11, 10).getTime(), version: 'normal' });
    expect(s!.startedAt).toBeUndefined();
    expect(await xpOf()).toHaveLength(0);
    const { result } = renderHook(() => useDayPlan());
    await waitFor(() => expect(result.current).toBeDefined());
    const b1 = result.current!.find((o) => o.block.id === 'b1')!;
    expect(b1).toMatchObject({ state: 'skipped', skipReason: 'pulado' });
  });

  it('endBlock on a block that was never started skips it (no start, no XP) and keeps the note', async () => {
    await endBlock('b1', 'começar pelo README');
    const s = await db.blockSessions.get('bs-b1-2026-11-11');
    expect(s!.startedAt).toBeUndefined();
    expect(s).toMatchObject({ skipped: true, endedAt: at(11, 10).getTime(), nextAction: 'começar pelo README' });
    expect(await xpOf()).toHaveLength(0);
  });

  it('skipBlock on a started block just ends it; starting a skipped block reopens it', async () => {
    await startBlock('b1');
    vi.setSystemTime(at(11, 10, 30));
    await skipBlock('b1');
    expect(await db.blockSessions.get('bs-b1-2026-11-11')).toMatchObject({ startedAt: at(11, 10).getTime(), endedAt: at(11, 10, 30).getTime() });
    expect((await db.blockSessions.get('bs-b1-2026-11-11'))!.skipped).toBeFalsy();

    await skipBlock('b2');
    vi.setSystemTime(at(11, 12, 40));
    await startBlock('b2');
    const s = await db.blockSessions.get('bs-b2-2026-11-11');
    expect(s!.startedAt).toBe(at(11, 12, 40).getTime());
    expect(s!.endedAt).toBeUndefined();
    expect(s!.skipped).toBeFalsy();
  });

  it('endBlock keeps the original start of a started block', async () => {
    await startBlock('b1');
    vi.setSystemTime(new Date(at(11, 10).getTime() + 30 * 60000));
    await endBlock('b1');
    const s = await db.blockSessions.get('bs-b1-2026-11-11');
    expect(s!.startedAt).toBe(at(11, 10).getTime());
  });

  it('setBlockVersion switches the version without starting the block', async () => {
    await setBlockVersion('b1', 'minimum');
    expect(await db.blockSessions.get('bs-b1-2026-11-11')).toMatchObject({ version: 'minimum' });
    expect((await db.blockSessions.get('bs-b1-2026-11-11'))!.startedAt).toBeUndefined();
    await startBlock('b1');
    await setBlockVersion('b1', 'normal');
    expect(await db.blockSessions.get('bs-b1-2026-11-11')).toMatchObject({ version: 'normal', startedAt: at(11, 10).getTime() });
  });

  it('saveNextAction updates the session and the mission first step', async () => {
    const m = await createMission({ title: 'artigo' });
    await startBlock('b1');
    await saveNextAction({ blockId: 'b1', missionId: m.id, text: 'escrever a introdução' });
    expect((await db.missions.get(m.id))!.firstStep).toBe('escrever a introdução');
    expect((await db.blockSessions.get('bs-b1-2026-11-11'))!.nextAction).toBe('escrever a introdução');
    await saveNextAction({ missionId: m.id, text: '' });
    expect((await db.missions.get(m.id))!.firstStep).toBe('escrever a introdução');
  });
});

describe('block editing', () => {
  it('saveBlock creates with defaults and updates, keeping one link and minimum ≤ normal', async () => {
    const b = await saveBlock({ name: 'Leitura', targetStart: '21:00', durationMin: 30, minimumMin: 50, areaId: 'area-intelecto' });
    expect(b).toMatchObject({ name: 'Leitura', order: 5, weekdays: WD, kind: 'focus', protected: false, checklist: [], archived: false, durationMin: 30, minimumMin: 30 });
    const u = await saveBlock({ id: b.id, journeyId: 'j-tech' });
    expect(u.journeyId).toBe('j-tech');
    expect(u.areaId).toBeUndefined();
    expect(u.name).toBe('Leitura');
    expect(await db.blocks.count()).toBe(6);
  });

  it('archive, reorder and copy days', async () => {
    await archiveBlock('b5');
    expect((await db.blocks.get('b5'))!.archived).toBe(true);
    await reorderBlocks(['b3', 'b1', 'b2']);
    expect((await db.blocks.get('b3'))!.order).toBe(0);
    expect((await db.blocks.get('b1'))!.order).toBe(1);
    expect((await db.blocks.get('b2'))!.order).toBe(2);
    await db.blocks.update('b4', { weekdays: [1] });
    await copyBlockDays(3, [6, 1]);
    expect((await db.blocks.get('b1'))!.weekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await db.blocks.get('b4'))!.weekdays).toEqual([1]);       // not active on Wednesday
    expect((await db.blocks.get('b5'))!.weekdays).toEqual(WD);         // archived
  });
});

describe('reorderBlocks', () => {
  it('writes every new order in one transaction: one change notification, no half-reordered state', async () => {
    let notified = 0;
    const off = onLocalChange(() => { notified += 1; });
    const seen: string[] = [];
    const sub = liveQuery(() => db.blocks.orderBy('order').toArray())
      .subscribe((bs) => { seen.push(bs.map((b) => b.id).join(',')); });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    await reorderBlocks(['b5', 'b4', 'b3', 'b2', 'b1']);
    await vi.waitFor(() => expect(seen.at(-1)).toBe('b5,b4,b3,b2,b1'));
    sub.unsubscribe();
    off();
    expect(notified).toBe(1);
    expect(seen).toEqual(['b1,b2,b3,b4,b5', 'b5,b4,b3,b2,b1']);
    expect(await db.outbox.where('key').startsWith('blocks:').count()).toBe(4); // b3 kept its order
  });
});

describe('hooks', () => {
  it('useDayPlan, useCurrentBlock and useNextBlock follow a seeded routine', async () => {
    await db.blocks.clear();
    await db.commitments.clear();
    await applyRoutine(defaultRoutine('08:00', {
      journeys: [], areas: await db.areas.toArray(), commitments: [], dayEndHour: 0, today: '2026-11-11',
    }));
    vi.setSystemTime(at(11, 9, 30));
    const { result } = renderHook(() => ({
      plan: useDayPlan(), current: useCurrentBlock(), next: useNextBlock(), blocks: useBlocks(), mode: useDayMode(),
    }));
    await waitFor(() => expect(result.current.plan).toHaveLength(7));
    const plan = result.current.plan!;
    expect(plan.map((o) => o.state)).toEqual(['missed', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    await waitFor(() => expect(result.current.current?.block.name).toBe('Bloco 1 · Tech News'));
    const time = (ts: number) => formatHHmm(new Date(ts).getHours() * 60 + new Date(ts).getMinutes());
    expect(time(result.current.current!.end)).toBe('10:30');
    expect(result.current.next?.block.name).toBe('Treino');
    expect(result.current.blocks.map((b) => b.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(result.current.mode).toBe('normal');
  });

  it('useDayPlan returns nothing on a free weekend day', async () => {
    vi.setSystemTime(at(14, 10)); // Saturday
    const { result } = renderHook(() => ({ plan: useDayPlan(), mode: useDayMode() }));
    await waitFor(() => expect(result.current.plan).toEqual([]));
    expect(result.current.mode).toBe('free');
  });

  it('useEngine boosts missions of the current block', async () => {
    vi.setSystemTime(at(11, 13));
    const m = await createMission({ title: 'alongar', areaId: 'area-vigor', durationMin: 20 });
    await createMission({ title: 'outra', durationMin: 20 });
    const { result } = renderHook(() => useEngine());
    await waitFor(() => expect(result.current?.primary?.mission.id).toBe(m.id));
    expect(result.current!.primary!.reasons.map((r) => r.code)).toContain('block');
  });

  it('useCharacterStats counts only workdays in weekWorkdays', async () => {
    await pastXp('2026-11-10');
    await pastXp('2026-11-08'); // Sunday: free, not counted
    const { result } = renderHook(() => useCharacterStats());
    await waitFor(() => expect(result.current?.weekWorkdays).toBeDefined());
    expect(result.current!.weekWorkdays.total).toBe(5);
    expect(result.current!.weekWorkdays.active).toBe(1);
    expect(result.current!.monthWorkdays.days).toHaveLength(30);
    expect(result.current!.week).toHaveLength(7);
  });
});
