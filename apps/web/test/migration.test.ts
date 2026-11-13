import { afterEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { newPracticeFields } from '@life/shared';
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
    expect(db.verno).toBe(7);

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

// Frozen copy of the v2 additions that are already in the user's browser: never edit it.
const V2_ADDED = {
  blocks: 'id,order',
  blockSessions: 'id,day,blockId',
  weeks: 'id',
  checkins: 'id,at,kind',
};

describe('Dexie v2 → v3 migration', () => {
  async function createV2(): Promise<void> {
    const v2 = new Dexie(NAME);
    v2.version(1).stores(V1);
    v2.version(2).stores(V2_ADDED);
    await v2.open();
    for (const [table, rows] of Object.entries(V1_ROWS)) await v2.table(table).bulkPut(rows);
    await v2.table('blocks').put({ ...base, id: 'b1', name: 'Complementos', weekdays: [1], order: 0, targetStart: '18:00', durationMin: 40, minimumMin: 10, kind: 'light', protected: false, checklist: [], archived: false });
    v2.close();
  }

  it('keeps every v2 row, adds the four study tables and restarts the cursor', async () => {
    await createV2();
    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(7);
    expect(await db.blocks.get('b1')).toMatchObject({ name: 'Complementos', kind: 'light' });
    expect(await db.missions.toArray()).toEqual(V1_ROWS.missions);
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 0 });
    expect(await db.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dev-1' });
    for (const t of ['decks', 'notes', 'cards', 'reviews']) expect(await db.table(t).count(), t).toBe(0);
    await db.cards.put({ ...base, id: 'n1-0', noteId: 'n1', deckId: 'd1', ord: 0, suspended: false, state: 'new', due: 5, stability: 0, difficulty: 0, reps: 0, lapses: 0, learningSteps: 0, scheduledDays: 0 });
    expect(await db.cards.where('noteId').equals('n1').count()).toBe(1);
    expect(await db.cards.where('due').below(10).count()).toBe(1);
    await db.reviews.put({ ...base, id: 'r1', cardId: 'n1-0', noteId: 'n1', at: 5, day: '2026-11-12', rating: 3, durationMs: 1000, wrote: false, before: {} as never, after: {} as never });
    expect(await db.reviews.where('day').equals('2026-11-12').count()).toBe(1);
  });
});

// Frozen copy of the v3 additions that are already in the user's browser: never edit it.
const V3_ADDED = {
  decks: 'id,order',
  notes: 'id,deckId',
  cards: 'id,noteId,deckId,due',
  reviews: 'id,cardId,day,at',
};

describe('Dexie v3 → v4 migration', () => {
  it('keeps every v3 row, adds the sketches table and restarts the cursor', async () => {
    const v3 = new Dexie(NAME);
    v3.version(1).stores(V1);
    v3.version(2).stores(V2_ADDED);
    v3.version(3).stores(V3_ADDED);
    await v3.open();
    for (const [table, rows] of Object.entries(V1_ROWS)) await v3.table(table).bulkPut(rows);
    await v3.table('decks').put({ ...base, id: 'd1', name: 'SQL', order: 0, archived: false });
    v3.close();

    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(7);
    expect(await db.decks.get('d1')).toMatchObject({ name: 'SQL' });
    expect(await db.missions.toArray()).toEqual(V1_ROWS.missions);
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 0 });
    expect(await db.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dev-1' });
    expect(await db.sketches.count()).toBe(0);
    await db.sketches.put({ ...base, id: 's1', title: '', strokes: [{ c: 0, w: 0, p: [1, 2] }] });
    expect(await db.sketches.orderBy('updatedAt').first()).toMatchObject({ id: 's1' });
  });
});

// Frozen copy of the v4 additions that are already in the user's browser: never edit it.
const V4_ADDED = { sketches: 'id,updatedAt' };

describe('Dexie v4 → v5 migration', () => {
  it('keeps every v4 row and the sync cursor, and adds the local media stores', async () => {
    const v4 = new Dexie(NAME);
    v4.version(1).stores(V1);
    v4.version(2).stores(V2_ADDED);
    v4.version(3).stores(V3_ADDED);
    v4.version(4).stores(V4_ADDED);
    await v4.open();
    for (const [table, rows] of Object.entries(V1_ROWS)) await v4.table(table).bulkPut(rows);
    await v4.table('sketches').put({ ...base, id: 's1', title: 'conta', strokes: [] });
    v4.close();

    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(7);
    expect(await db.sketches.get('s1')).toMatchObject({ title: 'conta' });
    expect(await db.missions.toArray()).toEqual(V1_ROWS.missions);
    // v5 alone keeps the cursor (no synced table), but a v4 database also goes through v6, which restarts it.
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 0 });
    for (const t of ['mediaInfo', 'mediaData', 'mediaQueue']) expect(await db.table(t).count(), t).toBe(0);
    await db.mediaQueue.bulkPut([{ hash: 'b'.repeat(64), addedAt: 2 }, { hash: 'a'.repeat(64), addedAt: 1 }]);
    expect((await db.mediaQueue.orderBy('addedAt').first())!.hash).toBe('a'.repeat(64));
  });
});

describe('Dexie v4 → v6 migration', () => {
  it('keeps every v4 row, adds practiceSessions and restarts the cursor', async () => {
    const v4 = new Dexie(NAME);
    v4.version(1).stores(V1);
    v4.version(2).stores(V2_ADDED);
    v4.version(3).stores(V3_ADDED);
    v4.version(4).stores(V4_ADDED);
    await v4.open();
    for (const [table, rows] of Object.entries(V1_ROWS)) await v4.table(table).bulkPut(rows);
    await v4.table('sketches').put({ ...base, id: 's1', title: 'Lista 3', strokes: [] });
    v4.close();

    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(7);
    expect(await db.sketches.get('s1')).toMatchObject({ title: 'Lista 3' });
    expect(await db.missions.toArray()).toEqual(V1_ROWS.missions);
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 0 });
    expect(await db.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dev-1' });
    expect(await db.practiceSessions.count()).toBe(0);
    await db.practiceSessions.put({ ...base, id: 'p1', ...newPracticeFields({ title: 'Dedup' }) });
    expect(await db.practiceSessions.where('status').equals('open').count()).toBe(1);
  });
});

// Frozen copy of the v5 additions that are already in the user's browser: never edit it.
const V5_ADDED = { mediaInfo: 'hash', mediaData: 'hash', mediaQueue: 'hash,addedAt' };

describe('Dexie v5 → v6 migration', () => {
  it('keeps the media rows, restarts the cursor and adds practiceSessions', async () => {
    const v5 = new Dexie(NAME);
    v5.version(1).stores(V1);
    v5.version(2).stores(V2_ADDED);
    v5.version(3).stores(V3_ADDED);
    v5.version(4).stores(V4_ADDED);
    v5.version(5).stores(V5_ADDED);
    await v5.open();
    for (const [table, rows] of Object.entries(V1_ROWS)) await v5.table(table).bulkPut(rows);
    const hash = 'c'.repeat(64);
    await v5.table('mediaInfo').put({ hash, mime: 'image/png', size: 3, w: 1, h: 1 });
    await v5.table('mediaData').put({ hash, bytes: new Uint8Array([1, 2, 3]) });
    await v5.table('mediaQueue').put({ hash, addedAt: 7 });
    await v5.table('meta').put({ key: 'cursor', value: 42 });
    v5.close();

    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(7);
    expect(await db.mediaInfo.get(hash)).toMatchObject({ mime: 'image/png', size: 3 });
    expect(await db.mediaData.get(hash)).toMatchObject({ hash });
    expect(await db.mediaQueue.get(hash)).toEqual({ hash, addedAt: 7 });
    expect(await db.missions.toArray()).toEqual(V1_ROWS.missions);
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 0 });
    expect(await db.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dev-1' });
    expect(await db.practiceSessions.count()).toBe(0);
    await db.practiceSessions.put({ ...base, id: 'p1', ...newPracticeFields({ title: 'Dedup' }) });
    expect(await db.practiceSessions.where('status').equals('open').count()).toBe(1);
  });
});

describe('Dexie v4 → v7 migration (Marco 4)', () => {
  it('keeps every v4 row, adds the corpo e casa tables and restarts the cursor', async () => {
    const v4 = new Dexie(NAME);
    v4.version(1).stores(V1);
    v4.version(2).stores(V2_ADDED);
    v4.version(3).stores(V3_ADDED);
    v4.version(4).stores(V4_ADDED);
    await v4.open();
    for (const [table, rows] of Object.entries(V1_ROWS)) await v4.table(table).bulkPut(rows);
    await v4.table('sketches').put({ ...base, id: 's1', title: 'Lista', strokes: [] });
    v4.close();

    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(7);
    expect(await db.sketches.get('s1')).toMatchObject({ title: 'Lista' });
    expect(await db.missions.toArray()).toEqual(V1_ROWS.missions);
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 0 });
    expect(await db.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dev-1' });
    for (const t of [db.sleepLogs, db.recipes, db.menus, db.shoppingLists, db.freezerMoves, db.workouts]) {
      expect(await t.count()).toBe(0);
    }
    await db.sleepLogs.put({ ...base, id: 'sleep-2026-11-13', night: '2026-11-13', bedAt: 5 });
    expect(await db.sleepLogs.where('night').equals('2026-11-13').count()).toBe(1);
    await db.freezerMoves.put({ ...base, id: 'f1', at: 5, day: '2026-11-13', recipeId: 'r1', delta: 4, kind: 'prep' });
    expect(await db.freezerMoves.where('recipeId').equals('r1').count()).toBe(1);
    await db.workouts.put({ ...base, id: 'w1', at: 5, day: '2026-11-13', kind: 'cardio', minutes: 10 });
    expect(await db.workouts.where('day').equals('2026-11-13').count()).toBe(1);
  });
});
