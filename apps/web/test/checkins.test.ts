import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import {
  completeMission, createMission, logEscape, saveCheckin, setCheckinOutcome,
} from '../src/domain/actions';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

const xpTotal = async () => (await db.xpEvents.toArray()).filter((x) => !x.deleted).reduce((s, x) => s + x.amount, 0);

describe('saveCheckin', () => {
  it('records a start check-in and gives +2 once per mission per day', async () => {
    const m = await createMission({ title: 'relatório', areaId: 'area-oficio', postponeCount: 2 });
    const first = await saveCheckin({ feelings: ['ansiedade', 'tédio'], thought: ' não sei por onde começar ', experimentMin: 10, missionId: m.id, blockId: 'b1' });
    expect(first.xp).toBe(2);
    expect(await db.checkins.get(first.id)).toMatchObject({
      kind: 'start', at: Date.now(), feelings: ['ansiedade', 'tédio'], thought: 'não sei por onde começar',
      experimentMin: 10, missionId: m.id, blockId: 'b1', deleted: false,
    });
    const xp = await db.xpEvents.get(`xp-checkin-${m.id}-2026-11-11`);
    expect(xp).toMatchObject({ amount: 2, reason: 'checkin', missionId: m.id, areaId: 'area-oficio', dayKey: '2026-11-11' });

    const second = await saveCheckin({ feelings: ['cansaço'], missionId: m.id });
    expect(second.xp).toBe(0);
    expect(second.id).not.toBe(first.id);
    expect(await db.checkins.count()).toBe(2);
    expect(await xpTotal()).toBe(2);

    vi.setSystemTime(new Date(2026, 10, 12, 10, 0));
    expect((await saveCheckin({ feelings: [], missionId: m.id })).xp).toBe(2);
    expect(await xpTotal()).toBe(4);
  });

  it('gives no XP without a mission and omits empty optional fields', async () => {
    const r = await saveCheckin({ feelings: ['outro'], thought: '   ' });
    expect(r.xp).toBe(0);
    const c = await db.checkins.get(r.id);
    expect(c).not.toHaveProperty('thought');
    expect(c).not.toHaveProperty('missionId');
    expect(await xpTotal()).toBe(0);
  });

  it('setCheckinOutcome fills the outcome later', async () => {
    const { id } = await saveCheckin({ feelings: ['medo de errar'], experimentMin: 10 });
    await setCheckinOutcome(id, 'stopped');
    expect((await db.checkins.get(id))!.outcome).toBe('stopped');
    expect(await db.outbox.get(`checkins:${id}`)).toBeDefined();
  });
});

describe('logEscape', () => {
  it('records an escape and never changes XP', async () => {
    const m = await createMission({ title: 'estudar' });
    await completeMission(m.id);
    const before = await xpTotal();
    expect(before).toBeGreaterThan(0);
    await logEscape({ escapedTo: 'YouTube', missionId: m.id, blockId: 'b1' });
    await logEscape({ escapedTo: 'Redes' });
    expect(await xpTotal()).toBe(before);
    const escapes = await db.checkins.where('kind').equals('escape').toArray();
    expect(escapes).toHaveLength(2);
    expect(escapes.find((e) => e.escapedTo === 'YouTube')).toMatchObject({ feelings: [], missionId: m.id, blockId: 'b1', at: Date.now() });
  });
});
