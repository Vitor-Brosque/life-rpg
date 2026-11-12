import { afterEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { LifeDB } from '../src/db/db';

// Frozen copy of the v1 schema that is already in the user's browser: never edit it.
const V1 = {
  missions: 'id,status,date,journeyId,areaId,updatedAt',
  journeys: 'id,status',
  commitments: 'id,date',
  areas: 'id,order',
  focusSessions: 'id,startedAt',
  energyLogs: 'id,at',
  events: 'id,at,missionId',
  xpEvents: 'id,at,dayKey,missionId',
  profile: 'id',
  settings: 'id',
  dayState: 'id',
  outbox: 'key',
  meta: 'key',
};

const NAME = 'life-rpg-migration-test';
const base = { createdAt: 1, updatedAt: 2, deleted: false };

const V1_ROWS: Record<string, Array<Record<string, unknown>>> = {
  missions: [{
    ...base, id: 'm1', title: 'ler', checklist: [{ id: 'c1', text: 'cap 1', done: false }], status: 'open',
    important: true, shrunk: false, postponeCount: 2, date: '2026-11-10', areaId: 'area-intelecto',
  }],
  journeys: [{ ...base, id: 'j1', title: 'Mudança', status: 'active', order: 0 }],
  commitments: [{ ...base, id: 'c1', title: 'Aula', date: '2026-11-02', start: '19:00', end: '23:00', weekdays: [1, 2, 3, 4, 5], remind: true }],
  areas: [{ ...base, id: 'area-vigor', name: 'Corpo', attribute: 'Vigor', color: '#e5675d', icon: 'heart', order: 0, archived: false }],
  focusSessions: [{ ...base, id: 'f1', startedAt: 10, endedAt: 20, activeMs: 10, mode: 'free', outcome: 'finished' }],
  energyLogs: [{ ...base, id: 'e1', at: 5, level: 'low' }],
  events: [{ ...base, id: 'ev1', at: 5, type: 'created', missionId: 'm1' }],
  xpEvents: [{ ...base, id: 'xp-complete-m0', at: 5, amount: 8, reason: 'complete', dayKey: '2026-11-09' }],
  profile: [{ ...base, id: 'me', name: 'Vitor', look: { skin: 1, hair: 2, hairColor: 0, outfit: 1 }, companionName: 'Faísca', onboarded: true }],
  settings: [{ ...base, id: 'settings', dayStartHour: 4, dayEndHour: 23, pomodoro: { focusMin: 25, breakMin: 5 }, companionMuted: false, commitmentReminderMin: 10 }],
  dayState: [
    { ...base, id: '2026-11-09', hardDay: true, reviewDone: true },
    { ...base, id: '2026-11-10', hardDay: false, reviewDone: false },
  ],
  outbox: [{ key: 'missions:m1', table: 'missions', id: 'm1', updatedAt: 2 }],
  meta: [{ key: 'cursor', value: 42 }, { key: 'deviceId', value: 'dev-1' }],
};

let open: Dexie | undefined;
afterEach(async () => {
  open?.close();
  open = undefined;
  await Dexie.delete(NAME);
});

async function createV1(extraDayStates: Array<Record<string, unknown>> = []): Promise<void> {
  const v1 = new Dexie(NAME);
  v1.version(1).stores(V1);
  await v1.open();
  for (const [table, rows] of Object.entries(V1_ROWS)) await v1.table(table).bulkPut(rows);
  if (extraDayStates.length) await v1.table('dayState').bulkPut(extraDayStates);
  v1.close();
}

describe('Dexie v1 → v2 migration', () => {
  it('turns hardDay into mode low and keeps every v1 row intact', async () => {
    await createV1();
    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(2);

    const hard = await db.dayState.get('2026-11-09');
    expect(hard).toMatchObject({ hardDay: true, reviewDone: true, mode: 'low', updatedAt: 2 });
    const easy = await db.dayState.get('2026-11-10');
    expect(easy).toEqual(V1_ROWS.dayState![1]);
    expect(easy).not.toHaveProperty('mode');

    for (const [table, rows] of Object.entries(V1_ROWS)) {
      if (table === 'dayState' || table === 'meta') continue;
      expect(await db.table(table).toArray(), table).toEqual(rows);
    }
  });

  it('restarts the sync cursor so records a v1 client could not apply are pulled again', async () => {
    await createV1();
    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 0 });
    expect(await db.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dev-1' });
  });

  it('leaves a weekend hard day without a mode (weekends stay free)', async () => {
    await createV1([
      { ...base, id: '2026-11-14', hardDay: true, reviewDone: false },
      { ...base, id: '2026-11-15', hardDay: true, reviewDone: false },
    ]);
    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(await db.dayState.get('2026-11-14')).not.toHaveProperty('mode');
    expect(await db.dayState.get('2026-11-15')).not.toHaveProperty('mode');
    expect((await db.dayState.get('2026-11-09'))!.mode).toBe('low');
  });

  it('keeps a mode that is already set', async () => {
    await createV1([{ ...base, id: '2026-11-08', hardDay: true, reviewDone: false, mode: 'recovery' }]);
    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect((await db.dayState.get('2026-11-08'))!.mode).toBe('recovery');
  });

  it('creates the four new tables empty and usable', async () => {
    await createV1();
    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    for (const t of ['blocks', 'blockSessions', 'weeks', 'checkins']) {
      expect(await db.table(t).count(), t).toBe(0);
    }
    await db.blockSessions.put({ ...base, id: 'bs-b1-2026-11-11', blockId: 'b1', day: '2026-11-11', version: 'normal' });
    expect(await db.blockSessions.where('day').equals('2026-11-11').count()).toBe(1);
    expect(await db.checkins.where('kind').equals('escape').count()).toBe(0);
  });
});
