import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Commitment, Mission } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { useCharacterStats } from '../src/db/hooks';
import {
  captureLines, completeMission, createMission, finishReview, shrinkMission, snoozeMission,
  splitMission, startMission, undoComplete, setHardDay, recordFocus, completeJourney,
} from '../src/domain/actions';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

const xpTotal = async () => (await db.xpEvents.toArray()).filter((x) => !x.deleted).reduce((s, x) => s + x.amount, 0);

describe('captureLines', () => {
  it('creates a mission and a commitment', async () => {
    const out = await captureLines('ler 20min @estudo\ndentista amanhã 15h');
    expect(out).toHaveLength(2);
    const m = out[0] as Mission;
    expect(m.durationMin).toBe(20);
    expect(m.areaId).toBe('area-intelecto');
    const c = out[1] as Commitment;
    expect(c.start).toBe('15:00');
    expect(c.end).toBe('16:00');
    expect(c.date).toBe('2026-11-12');
  });

  it('creates a journey once for two lines', async () => {
    const out = await captureLines('pintar quarto #mudança\nembalar livros #Mudanca');
    const [a, b] = out as Mission[];
    expect(a!.journeyId).toBeTruthy();
    expect(a!.journeyId).toBe(b!.journeyId);
    expect(await db.journeys.count()).toBe(1);
  });
});

describe('completion', () => {
  it('gives 8 XP for a plain mission', async () => {
    const m = await createMission({ title: 'a' });
    const r = await completeMission(m.id);
    expect(r.xp).toBe(8);
    expect(r.next).toBeUndefined();
    expect((await db.missions.get(m.id))!.status).toBe('done');
  });

  it('creates the next instance for a daily mission and undo removes everything', async () => {
    const m = await createMission({
      title: 'água', recurrence: { kind: 'daily' }, date: '2026-11-11',
      checklist: [{ id: 'c1', text: 'x', done: true }],
    });
    const r = await completeMission(m.id);
    expect(r.next).toBeDefined();
    expect(r.next!.date).toBe('2026-11-12');
    expect(r.next!.status).toBe('open');
    expect(r.next!.checklist[0]).toMatchObject({ text: 'x', done: false });
    expect(r.next!.checklist[0]!.id).not.toBe('c1');
    const { result } = renderHook(() => useCharacterStats());
    await waitFor(() => expect(result.current?.total.total).toBe(8));
    await undoComplete(m.id);
    await waitFor(() => expect(result.current?.total.total).toBe(0));
    expect((await db.missions.get(m.id))!.status).toBe('open');
    expect((await db.missions.get(m.id))!.completedAt).toBeUndefined();
    expect((await db.missions.get(r.next!.id))!.deleted).toBe(true);
    expect(await xpTotal()).toBe(0);
  });

  it('keeps a touched next instance on undo', async () => {
    const m = await createMission({ title: 'água', recurrence: { kind: 'daily' }, date: '2026-11-11' });
    const r = await completeMission(m.id);
    await db.missions.update(r.next!.id, { updatedAt: r.next!.updatedAt + 5 });
    await undoComplete(m.id);
    expect((await db.missions.get(r.next!.id))!.deleted).toBe(false);
  });

  it('adds resilience XP on the first completion of a hard day', async () => {
    await setHardDay(true);
    const m = await createMission({ title: 'a' });
    expect((await completeMission(m.id)).xp).toBe(13);
  });

  it('reports level up', async () => {
    const m = await createMission({ title: 'a', durationMin: 120, important: true });
    const r = await completeMission(m.id);
    expect(r.leveledUp).toBe(false);
    const m2 = await createMission({ title: 'b', durationMin: 120, important: true });
    const r2 = await completeMission(m2.id);
    expect(r2.leveledUp).toBe(true);
    expect(r2.newLevel).toBe(2);
  });
});

describe('other actions', () => {
  it('startMission awards XP once for a heavy mission', async () => {
    const m = await createMission({ title: 'h', energy: 'heavy' });
    expect((await startMission(m.id)).xp).toBe(5);
    expect((await startMission(m.id)).xp).toBe(0);
    expect((await db.missions.get(m.id))!.status).toBe('doing');
  });

  it('snooze increments postponeCount', async () => {
    const m = await createMission({ title: 's', date: '2026-11-11', dayOrder: 2 });
    await snoozeMission(m.id, 'tomorrow');
    let cur = (await db.missions.get(m.id))!;
    expect(cur.postponeCount).toBe(1);
    expect(cur.date).toBe('2026-11-12');
    expect(cur.dayOrder).toBeUndefined();
    await snoozeMission(m.id, 'later');
    cur = (await db.missions.get(m.id))!;
    expect(cur.postponeCount).toBe(2);
    expect(cur.snoozedUntil).toBe(Date.now() + 3 * 3600_000);
  });

  it('shrink awards strategy XP once after a postpone', async () => {
    const m = await createMission({ title: 's' });
    expect((await shrinkMission(m.id, 'abrir')).xp).toBe(0);
    await snoozeMission(m.id, 'later');
    expect((await shrinkMission(m.id, 'abrir')).xp).toBe(2);
    expect((await shrinkMission(m.id, 'abrir')).xp).toBe(0);
  });

  it('finishReview awards XP once per day', async () => {
    expect((await finishReview()).xp).toBe(5);
    expect((await finishReview()).xp).toBe(0);
  });

  it('recordFocus awards XP and stores the session', async () => {
    const s = { startedAt: 0, endedAt: 1, activeMs: 25 * 60_000, mode: 'free' as const, outcome: 'finished' as const };
    expect((await recordFocus(s)).xp).toBe(4);
    expect(await db.focusSessions.count()).toBe(1);
  });

  it('completeJourney awards once', async () => {
    const [m] = (await captureLines('x #j')) as Mission[];
    expect((await completeJourney(m!.journeyId!)).xp).toBe(30);
    expect((await completeJourney(m!.journeyId!)).xp).toBe(0);
  });

  it('splitMission creates a journey and missions from the checklist', async () => {
    const m = await createMission({
      title: 'mudança', areaId: 'area-ordem',
      checklist: [{ id: '1', text: 'caixas', done: false }, { id: '2', text: 'frete', done: false }],
    });
    const j = await splitMission(m.id);
    const ms = (await db.missions.where('journeyId').equals(j.id).toArray()).sort((a, b) => a.journeyOrder! - b.journeyOrder!);
    expect(ms.map((x) => x.title)).toEqual(['caixas', 'frete']);
    expect(ms.map((x) => x.journeyOrder)).toEqual([0, 1]);
    expect((await db.missions.get(m.id))!.deleted).toBe(true);
    expect(j.title).toBe('mudança');
  });
});
