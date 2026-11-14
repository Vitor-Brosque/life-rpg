import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Commitment, Journey, Mission, SyncChange, SyncTable } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { importRecords, patch, softDelete } from '../src/db/repo';
import { useCharacterStats } from '../src/db/hooks';
import {
  captureLines, completeMission, createMission, finishReview, shrinkMission, snoozeMission,
  splitMission, startMission, dropMission, undoComplete, setHardDay, recordFocus, completeJourney, reorderDay,
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
  it('aplica a recorrência da linha: missão mensal/semanal e compromisso com os dias', async () => {
    vi.setSystemTime(new Date(2026, 10, 11, 10, 0));
    const [a, b, c, d] = (await captureLines('contador todo dia 5\nlavar roupa toda seg\nacademia 19h toda ter e qui\nremédio todo dia 8h')) as [Mission, Mission, Commitment, Commitment];
    expect(a.recurrence).toEqual({ kind: 'monthly', day: 5 });
    expect(b.recurrence).toEqual({ kind: 'weekly', weekdays: [1] });
    expect(c.weekdays).toEqual([2, 4]);
    expect(d.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

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

  it('a #tag matches an existing multi-word journey by its compacted title', async () => {
    const base = { createdAt: 1, deleted: false, status: 'active' as const, order: 0 };
    await db.journeys.bulkPut([
      { ...base, id: 'j-tech', title: 'Tech News', updatedAt: 5 },
      { ...base, id: 'j-old', title: 'Tech antigo', updatedAt: 2 },
      { ...base, id: 'j-arch', title: 'Mudança', status: 'archived', updatedAt: 9 },
      { ...base, id: 'j-del', title: 'Tech', deleted: true, updatedAt: 9 },
    ]);
    const out = (await captureLines('ler artigo #tech\nresumo #technews\nfonte #Tech-News\nlink #tech_news')) as Mission[];
    expect(out.map((m) => m.journeyId)).toEqual(['j-tech', 'j-tech', 'j-tech', 'j-tech']);
    // No match among live, non-archived journeys → a new one.
    const [m] = (await captureLines('pintar quarto #mudança')) as Mission[];
    expect(m!.journeyId).not.toBe('j-arch');
    expect((await db.journeys.get(m!.journeyId!))).toMatchObject({ title: 'mudança', status: 'active' });
    expect(await db.journeys.count()).toBe(5);
  });

  it('an exact compacted title wins over a prefix; among prefixes the most recently updated wins', async () => {
    const base = { createdAt: 1, deleted: false, status: 'active' as const, order: 0 };
    await db.journeys.bulkPut([
      { ...base, id: 'j-a', title: 'Tech News', updatedAt: 5 },
      { ...base, id: 'j-b', title: 'Tech pipeline', updatedAt: 8 },
      { ...base, id: 'j-c', title: 'Tech', updatedAt: 1 },
    ]);
    const [exact] = (await captureLines('x #tech')) as Mission[];
    expect(exact!.journeyId).toBe('j-c');
    await db.journeys.update('j-c', { status: 'archived' });
    const [prefix] = (await captureLines('y #tech')) as Mission[];
    expect(prefix!.journeyId).toBe('j-b');
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

  it('setHardDay sets the day mode (low / normal) and still logs the event', async () => {
    await setHardDay(true);
    expect(await db.dayState.get('2026-11-11')).toMatchObject({ mode: 'low', hardDay: true, startedAt: Date.now() });
    await setHardDay(false);
    expect(await db.dayState.get('2026-11-11')).toMatchObject({ mode: 'normal', hardDay: false });
    expect((await db.events.toArray()).filter((e) => e.type === 'hardDay')).toHaveLength(2);
  });

  it('the hard-day completion bonus follows the day mode, not the old hardDay flag', async () => {
    const base = { createdAt: 1, updatedAt: 1, deleted: false, reviewDone: false };
    await db.dayState.put({ ...base, id: '2026-11-11', hardDay: true, mode: 'normal' });
    const a = await createMission({ title: 'a' });
    expect((await completeMission(a.id)).xp).toBe(8);
    await db.dayState.put({ ...base, id: '2026-11-11', hardDay: false, mode: 'recovery' });
    await db.xpEvents.clear();
    const b = await createMission({ title: 'b' });
    expect((await completeMission(b.id)).xp).toBe(13);
    // A weekend with an old hardDay and no mode is a free day: no bonus.
    vi.setSystemTime(new Date(2026, 10, 14, 10, 0));
    await db.dayState.put({ ...base, id: '2026-11-14', hardDay: true });
    const c = await createMission({ title: 'c' });
    expect((await completeMission(c.id)).xp).toBe(8);
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

  it('concurrent completeMission calls award once and create one next instance', async () => {
    const m = await createMission({ title: 'água', recurrence: { kind: 'daily' }, date: '2026-11-11' });
    const [a, b] = await Promise.all([completeMission(m.id), completeMission(m.id)]);
    expect([a.xp, b.xp].sort((x, y) => x - y)).toEqual([0, 8]);
    const completes = (await db.xpEvents.toArray()).filter((x) => x.reason === 'complete' && !x.deleted);
    expect(completes).toHaveLength(1);
    const next = (await db.missions.toArray()).filter((x) => x.id !== m.id && x.title === 'água');
    expect(next).toHaveLength(1);
  });

  it('completing a done, dropped or deleted mission is a no-op; startMission ignores done/dropped', async () => {
    const m = await createMission({ title: 'a' });
    await completeMission(m.id);
    const again = await completeMission(m.id);
    expect(again).toMatchObject({ xp: 0, leveledUp: false });
    expect(again.newLevel).toBeGreaterThanOrEqual(1);
    expect(await xpTotal()).toBe(8);
    expect(await startMission(m.id)).toEqual({ xp: 0 });
    expect((await db.missions.get(m.id))!.status).toBe('done');

    const d = await createMission({ title: 'd' });
    await dropMission(d.id);
    expect((await completeMission(d.id)).xp).toBe(0);
    expect(await startMission(d.id)).toEqual({ xp: 0 });
    expect((await db.missions.get(d.id))!.status).toBe('dropped');

    const x = await createMission({ title: 'x' });
    await softDelete('missions', x.id);
    expect((await completeMission(x.id)).xp).toBe(0);
    expect(await xpTotal()).toBe(8);
  });

  it('concurrent finishReview awards once', async () => {
    const r = await Promise.all([finishReview(), finishReview()]);
    expect(r.map((x) => x.xp).sort((a, b) => a - b)).toEqual([0, 5]);
    expect((await db.xpEvents.toArray()).filter((x) => x.reason === 'review')).toHaveLength(1);
  });
});

describe('deterministic ids (duplicates from two devices merge)', () => {
  const live = async (missionId: string, reason: string) =>
    (await db.xpEvents.where('missionId').equals(missionId).toArray()).filter((x) => x.reason === reason && !x.deleted);
  const series = async (title: string) => (await db.missions.toArray()).filter((x) => x.title === title);
  const dump = async (tables: SyncTable[]): Promise<SyncChange[]> => {
    const out: SyncChange[] = [];
    for (const table of tables) {
      for (const record of await db.table(table).toArray()) out.push({ table, record });
    }
    return out;
  };

  it('the same mission completed offline on two devices yields one complete XP and one next instance', async () => {
    const m = await createMission({ title: 'água', recurrence: { kind: 'daily' }, date: '2026-11-11' });
    const shared = (await db.missions.get(m.id))!;
    await completeMission(m.id); // device A
    const fromA = await dump(['missions', 'xpEvents']);

    await db.delete(); await db.open(); await ensureSeed(); // device B, same mission, still open
    await db.missions.put(shared);
    vi.setSystemTime(new Date(2026, 10, 11, 10, 5));
    await completeMission(m.id);
    await importRecords(fromA); // A's records arrive

    expect(await live(m.id, 'complete')).toHaveLength(1);
    expect((await db.xpEvents.toArray()).filter((x) => x.reason === 'complete')).toHaveLength(1);
    expect((await series('água')).filter((x) => x.id !== m.id)).toHaveLength(1);
  });

  it('complete → undo → complete revives the same XP and next instance', async () => {
    const m = await createMission({ title: 'água', recurrence: { kind: 'daily' }, date: '2026-11-11' });
    const first = await completeMission(m.id);
    await undoComplete(m.id);
    const second = await completeMission(m.id);
    expect(second.next!.id).toBe(first.next!.id);
    const all = (await db.xpEvents.where('missionId').equals(m.id).toArray()).filter((x) => x.reason === 'complete');
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: `xp-complete-${m.id}`, deleted: false, amount: 8 });
    const nexts = (await series('água')).filter((x) => x.id !== m.id);
    expect(nexts).toHaveLength(1);
    expect(nexts[0]!.deleted).toBe(false);
    // Undoing the revived completion still removes the untouched next instance.
    await undoComplete(m.id);
    expect((await db.missions.get(first.next!.id))!.deleted).toBe(true);
    expect(await xpTotal()).toBe(0);
  });

  it('a hard-day completion uses deterministic complete and resilience ids', async () => {
    await setHardDay(true);
    const m = await createMission({ title: 'a' });
    expect((await completeMission(m.id)).xp).toBe(13);
    expect((await db.xpEvents.get(`xp-complete-${m.id}`))!.amount).toBe(8);
    expect((await db.xpEvents.get(`xp-resilience-${m.id}`))!.amount).toBe(5);
  });

  it('a reactivated journey cannot award its XP twice', async () => {
    const [m] = (await captureLines('x #j')) as Mission[];
    const jid = m!.journeyId!;
    expect((await completeJourney(jid)).xp).toBe(30);
    await patch<Journey>('journeys', jid, { status: 'active' }); // "Reativar jornada"
    expect((await completeJourney(jid)).xp).toBe(0);
    expect((await db.journeys.get(jid))!.status).toBe('done');
    const journeyXp = (await db.xpEvents.toArray()).filter((x) => x.reason === 'journey' && !x.deleted);
    expect(journeyXp.map((x) => x.id)).toEqual([`xp-journey-${jid}`]);
  });

  it('the review XP id is per day', async () => {
    await finishReview();
    expect((await db.xpEvents.get('xp-review-2026-11-11'))).toMatchObject({ amount: 5, reason: 'review' });
  });

  it('the same focus session recorded twice is one session and one XP', async () => {
    const s = { startedAt: 1000, endedAt: 1000 + 25 * 60_000, activeMs: 25 * 60_000, mode: 'free' as const, outcome: 'finished' as const };
    expect((await recordFocus(s)).xp).toBe(4);
    expect((await recordFocus(s)).xp).toBe(0);
    expect(await db.focusSessions.toArray()).toHaveLength(1);
    expect((await db.focusSessions.toArray())[0]!.id).toBe('focus-1000');
    const focusXp = (await db.xpEvents.toArray()).filter((x) => x.reason === 'focus');
    expect(focusXp).toHaveLength(1);
    expect(focusXp[0]).toMatchObject({ id: 'xp-focus-focus-1000', amount: 4 });
  });
});

describe('reorderDay', () => {
  it('orders the day without moving missions planned for a later day', async () => {
    const loose = await createMission({ title: 'sem data' });
    const late = await createMission({ title: 'atrasada', date: '2026-11-10' });
    const future = await createMission({ title: 'em andamento', date: '2026-11-13', status: 'doing' });
    const today = await createMission({ title: 'hoje', date: '2026-11-11' });
    await reorderDay([future.id, loose.id, late.id, today.id], '2026-11-11');
    const got = async (id: string) => { const m = (await db.missions.get(id))!; return [m.date, m.dayOrder]; };
    expect(await got(future.id)).toEqual(['2026-11-13', 0]);
    expect(await got(loose.id)).toEqual(['2026-11-11', 1]);
    expect(await got(late.id)).toEqual(['2026-11-11', 2]);
    expect(await got(today.id)).toEqual(['2026-11-11', 3]);
  });

  it('a mission dropped into the day from a later day moves to it (week view drag)', async () => {
    const friday = await createMission({ title: 'sexta', date: '2026-11-13' });
    const wed = await createMission({ title: 'quarta', date: '2026-11-11' });
    await reorderDay([wed.id, friday.id], '2026-11-11', friday.id);
    expect((await db.missions.get(friday.id))!).toMatchObject({ date: '2026-11-11', dayOrder: 1 });
  });
});
