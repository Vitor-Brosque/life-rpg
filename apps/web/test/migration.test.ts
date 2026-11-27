import { afterEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { newPracticeFields, type SyncRequest } from '@life/shared';
import { LifeDB, db as appDb } from '../src/db/db';
import { setMeta } from '../src/db/repo';
import { syncNow } from '../src/sync/client';

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
    expect(db.verno).toBe(17);

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
    await v2.table('blocks').put({ ...base, id: 'b1', name: 'Complementos', weekdays: [1], order: 0, targetStart: '16:50', durationMin: 30, minimumMin: 10, kind: 'light', protected: false, checklist: [], archived: false });
    v2.close();
  }

  it('keeps every v2 row, adds the four study tables and restarts the cursor', async () => {
    await createV2();
    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(17);
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
    expect(db.verno).toBe(17);
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
    expect(db.verno).toBe(17);
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
    expect(db.verno).toBe(17);
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
    expect(db.verno).toBe(17);
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
    expect(db.verno).toBe(17);
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

describe('Dexie v8 (Marco 5)', () => {
  it('creates monthReviews empty and usable, and restarts the cursor', async () => {
    await createV1();
    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(17);
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 0 });
    expect(await db.table('monthReviews').count()).toBe(0);
    await db.table('monthReviews').put({ ...base, id: 'month-2026-10', month: '2026-10', observed: {}, answeredAt: 5 });
    expect((await db.table('monthReviews').get('month-2026-10')).month).toBe('2026-10');
  });
});

describe('Dexie v7 → v8 migration (Marco 5)', () => {
  it('keeps every Marco 3–4 row, restarts the cursor and adds monthReviews', async () => {
    const v7 = new Dexie(NAME);
    v7.version(1).stores(V1);
    v7.version(2).stores(V2_ADDED);
    v7.version(3).stores(V3_ADDED);
    v7.version(4).stores(V4_ADDED);
    v7.version(5).stores(V5_ADDED);
    v7.version(6).stores({ practiceSessions: 'id,status,journeyId,updatedAt' });
    v7.version(7).stores({
      sleepLogs: 'id,night',
      recipes: 'id',
      menus: 'id',
      shoppingLists: 'id',
      freezerMoves: 'id,at,recipeId',
      workouts: 'id,day,at',
    });
    await v7.open();
    for (const [table, rows] of Object.entries(V1_ROWS)) await v7.table(table).bulkPut(rows);
    const hash = 'd'.repeat(64);
    const rows = {
      mediaInfo: { hash, mime: 'image/png', size: 3, w: 1, h: 1 },
      mediaQueue: { hash, addedAt: 7 },
      practiceSessions: { ...base, id: 'p1', ...newPracticeFields({ title: 'Treino' }) },
      sleepLogs: { ...base, id: 'sleep-2026-11-13', night: '2026-11-13', bedAt: 5 },
      workouts: { ...base, id: 'w1', at: 5, day: '2026-11-13', kind: 'cardio', minutes: 10 },
      freezerMoves: { ...base, id: 'f1', at: 5, day: '2026-11-13', recipeId: 'r1', delta: 4, kind: 'prep' },
    };
    for (const [table, row] of Object.entries(rows)) await v7.table(table).put(row);
    await v7.table('mediaData').put({ hash, bytes: new Uint8Array([1, 2, 3]) });
    await v7.table('meta').put({ key: 'cursor', value: 42 });
    v7.close();

    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(17);
    expect(await db.mediaInfo.get(hash)).toEqual(rows.mediaInfo);
    expect(await db.mediaData.get(hash)).toMatchObject({ hash });
    expect(await db.mediaQueue.get(hash)).toEqual(rows.mediaQueue);
    expect(await db.practiceSessions.get('p1')).toEqual(rows.practiceSessions);
    expect(await db.sleepLogs.get('sleep-2026-11-13')).toEqual(rows.sleepLogs);
    expect(await db.workouts.get('w1')).toEqual(rows.workouts);
    expect(await db.freezerMoves.get('f1')).toEqual(rows.freezerMoves);
    expect(await db.missions.toArray()).toEqual(V1_ROWS.missions);
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 0 });
    expect(await db.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dev-1' });
    expect(await db.table('monthReviews').count()).toBe(0);
    await db.table('monthReviews').put({ ...base, id: 'month-2026-10', month: '2026-10', observed: {}, answeredAt: 5 });
    expect(await db.table('monthReviews').count()).toBe(1);
  });
});

describe('Dexie v8 → v9 (acompanhamento diário)', () => {
  it('keeps every v8 row, restarts the cursor and adds the five acompanhamento tables', async () => {
    const v8 = new Dexie(NAME);
    v8.version(1).stores(V1);
    v8.version(2).stores(V2_ADDED);
    v8.version(3).stores(V3_ADDED);
    v8.version(4).stores(V4_ADDED);
    v8.version(5).stores(V5_ADDED);
    v8.version(6).stores({ practiceSessions: 'id,status,journeyId,updatedAt' });
    v8.version(7).stores({
      sleepLogs: 'id,night',
      recipes: 'id',
      menus: 'id',
      shoppingLists: 'id',
      freezerMoves: 'id,at,recipeId',
      workouts: 'id,day,at',
    });
    v8.version(8).stores({ monthReviews: 'id' });
    await v8.open();
    for (const [table, rows] of Object.entries(V1_ROWS)) await v8.table(table).bulkPut(rows);
    const rows = {
      monthReviews: { ...base, id: 'month-2026-10', month: '2026-10', observed: {}, answeredAt: 5 },
      workouts: { ...base, id: 'w1', at: 5, day: '2026-11-13', kind: 'cardio', minutes: 10 },
    };
    for (const [table, row] of Object.entries(rows)) await v8.table(table).put(row);
    await v8.table('meta').put({ key: 'cursor', value: 42 });
    v8.close();

    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(17);
    expect(await db.table('monthReviews').get('month-2026-10')).toEqual(rows.monthReviews);
    expect(await db.workouts.get('w1')).toEqual(rows.workouts);
    expect(await db.missions.toArray()).toEqual(V1_ROWS.missions);
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 0 });
    expect(await db.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dev-1' });
    for (const t of [db.trainingPlans, db.trainingLogs, db.dayPlans, db.problemSets, db.subjectTopics]) {
      expect(await t.count()).toBe(0);
    }
    await db.trainingLogs.put({ ...base, id: 'training-2026-11-13', day: '2026-11-13', exercises: [] });
    expect(await db.trainingLogs.where('day').equals('2026-11-13').count()).toBe(1);
    await db.problemSets.put({ ...base, id: 'ps1', journeyId: 'j1', day: '2026-11-13', title: 'Lista 1', done: 3 });
    expect(await db.problemSets.where('journeyId').equals('j1').count()).toBe(1);
    await db.subjectTopics.put({ ...base, id: 'st1', journeyId: 'j1', name: 'Limites', marks: [] });
    expect(await db.subjectTopics.where('journeyId').equals('j1').count()).toBe(1);
  });
});

// Frozen copy of the v9 schema that is already in the user's browser: never edit it.
const V9_ADDED = { trainingPlans: 'id', trainingLogs: 'id,day', dayPlans: 'id', problemSets: 'id,journeyId,day', subjectTopics: 'id,journeyId' };

function v9Schema(d: Dexie): void {
  d.version(1).stores(V1);
  d.version(2).stores(V2_ADDED);
  d.version(3).stores(V3_ADDED);
  d.version(4).stores(V4_ADDED);
  d.version(5).stores(V5_ADDED);
  d.version(6).stores({ practiceSessions: 'id,status,journeyId,updatedAt' });
  d.version(7).stores({ sleepLogs: 'id,night', recipes: 'id', menus: 'id', shoppingLists: 'id', freezerMoves: 'id,at,recipeId', workouts: 'id,day,at' });
  d.version(8).stores({ monthReviews: 'id' });
  d.version(9).stores(V9_ADDED);
}

const t = (day: number, h: number, m = 0): number => new Date(2026, 10, day, h, m).getTime();
/** Day-close notes as v9 wrote them: closed, unclosed, soft-deleted, blank. */
const NOTE_STATES = [
  { id: '2026-11-10', createdAt: t(10, 8), updatedAt: t(10, 23, 6), deleted: false, hardDay: false, reviewDone: false, mode: 'normal', startedAt: t(10, 8), closedAt: t(10, 23, 5), tiredness: 'medio', closeNote: 'Dia corrido, mas a aula rendeu.' },
  { id: '2026-11-11', createdAt: t(11, 8), updatedAt: t(11, 21), deleted: false, hardDay: false, reviewDone: false, closeNote: 'Sem fechar o dia.' },
  { id: '2026-11-12', createdAt: t(12, 8), updatedAt: t(12, 22), deleted: true, hardDay: false, reviewDone: false, closeNote: 'Apagado.' },
  { id: '2026-11-13', createdAt: t(13, 8), updatedAt: t(13, 22), deleted: false, hardDay: false, reviewDone: false, closeNote: '   ' },
];
const CLOSE_10 = {
  id: 'diary-close-2026-11-10', createdAt: t(10, 23, 6), updatedAt: t(10, 23, 6), deleted: false, day: '2026-11-10',
  at: t(10, 23, 5), kind: 'fechamento', text: 'Dia corrido, mas a aula rendeu.', themes: [], links: [], private: false,
};
const CLOSE_11 = {
  id: 'diary-close-2026-11-11', createdAt: t(11, 21), updatedAt: t(11, 21), deleted: false, day: '2026-11-11',
  at: t(11, 22), kind: 'fechamento', text: 'Sem fechar o dia.', themes: [], links: [], private: false,
};

async function createV9(name: string): Promise<void> {
  const v9 = new Dexie(name);
  v9Schema(v9);
  await v9.open();
  for (const [table, rows] of Object.entries(V1_ROWS)) await v9.table(table).bulkPut(rows);
  await v9.table('dayState').bulkPut(NOTE_STATES);
  await v9.table('meta').put({ key: 'cursor', value: 42 });
  v9.close();
}

describe('Dexie v9 → v10 (diário)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('turns each live day-close note into its fechamento entry, queues it for sync and restarts the cursor', async () => {
    await createV9(NAME);
    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(17);
    expect(await db.diaryEntries.toArray()).toEqual([CLOSE_10, CLOSE_11]);
    expect(await db.outbox.toArray()).toEqual([
      { key: 'diaryEntries:diary-close-2026-11-10', table: 'diaryEntries', id: 'diary-close-2026-11-10', updatedAt: t(10, 23, 6) },
      { key: 'diaryEntries:diary-close-2026-11-11', table: 'diaryEntries', id: 'diary-close-2026-11-11', updatedAt: t(11, 21) },
      ...V1_ROWS.outbox!,
    ]);
    expect(await db.dayState.get('2026-11-10')).toEqual(NOTE_STATES[0]);
    expect(await db.missions.toArray()).toEqual(V1_ROWS.missions);
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 0 });
    expect(await db.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dev-1' });
    expect(await db.diaryEntries.where('day').equals('2026-11-11').count()).toBe(1);
    expect(await db.diaryEntries.where('at').above(t(11, 0)).count()).toBe(1);
  });

  it('two devices that migrate at different times write identical records', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await createV9(`${NAME}-a`);
    await createV9(`${NAME}-b`);
    vi.setSystemTime(t(14, 9));
    const a = new LifeDB(`${NAME}-a`);
    await a.open();
    vi.setSystemTime(t(16, 20, 30));
    const b = new LifeDB(`${NAME}-b`);
    await b.open();
    try {
      expect(await a.diaryEntries.toArray()).toEqual(await b.diaryEntries.toArray());
      expect(await b.diaryEntries.toArray()).toEqual([CLOSE_10, CLOSE_11]);
    } finally {
      a.close();
      b.close();
      await Dexie.delete(`${NAME}-a`);
      await Dexie.delete(`${NAME}-b`);
    }
  });

  it('the next sync sends the migrated entries like any write', async () => {
    appDb.close();
    await Dexie.delete('life-rpg');
    await createV9('life-rpg');
    await appDb.open();
    await setMeta('syncToken', 'tok');
    let pushed: SyncRequest | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      pushed = JSON.parse(init.body) as SyncRequest;
      return { ok: true, status: 200, json: async () => ({ cursor: 3, changes: [] }) };
    }));
    try {
      expect(await syncNow()).toBe(true);
      expect(pushed!.cursor).toBe(0);
      expect(pushed!.changes.filter((c) => c.table === 'diaryEntries')).toEqual([
        { table: 'diaryEntries', record: CLOSE_10 }, { table: 'diaryEntries', record: CLOSE_11 },
      ]);
      expect(await appDb.outbox.count()).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      appDb.close();
      await Dexie.delete('life-rpg');
    }
  });
});

// Frozen copy of the v10 schema that is already in the user's browser: never edit it.
const V10_ADDED = { diaryEntries: 'id,day,at' };

describe('Dexie v10 → v11 (estratégias)', () => {
  it('keeps every v10 row, adds the strategies table and restarts the cursor (no data migration)', async () => {
    const v10 = new Dexie(NAME);
    v9Schema(v10);
    v10.version(10).stores(V10_ADDED);
    await v10.open();
    for (const [table, rows] of Object.entries(V1_ROWS)) await v10.table(table).bulkPut(rows);
    const week = { ...base, id: '2026-11-16', objectives: [], experiment: 'Celular longe' };
    await v10.table('weeks').put(week);
    await v10.table('diaryEntries').put(CLOSE_10);
    await v10.table('meta').put({ key: 'cursor', value: 42 });
    v10.close();

    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(17);
    expect(await db.weeks.get('2026-11-16')).toEqual(week);
    expect(await db.diaryEntries.get(CLOSE_10.id)).toEqual(CLOSE_10);
    expect(await db.strategies.count()).toBe(0);
    expect(await db.outbox.toArray()).toEqual(V1_ROWS.outbox);
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 0 });
    expect(await db.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dev-1' });
    await db.strategies.put({ ...base, id: 's1', title: 'Celular longe', source: 'ideia', startDay: '2026-11-23', reviewDay: '2026-12-07', status: 'testando' });
    expect(await db.strategies.get('s1')).toMatchObject({ title: 'Celular longe' });
  });
});

// Frozen copy of the v11 schema that is already in the user's browser: never edit it.
const V11_ADDED = { strategies: 'id' };

describe('Dexie v11 → v12 (objetivos e temporadas)', () => {
  it('keeps every v11 row, adds the goals and seasons tables and restarts the cursor (no data migration)', async () => {
    const v11 = new Dexie(NAME);
    v9Schema(v11);
    v11.version(10).stores(V10_ADDED);
    v11.version(11).stores(V11_ADDED);
    await v11.open();
    for (const [table, rows] of Object.entries(V1_ROWS)) await v11.table(table).bulkPut(rows);
    const strategy = { ...base, id: 's1', title: 'Celular longe', source: 'ideia', startDay: '2026-11-16', reviewDay: '2026-11-30', status: 'testando' };
    await v11.table('strategies').put(strategy);
    await v11.table('meta').put({ key: 'cursor', value: 42 });
    v11.close();

    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(17);
    expect(await db.journeys.get('j1')).toEqual(V1_ROWS.journeys![0]);
    expect(await db.strategies.get('s1')).toEqual(strategy);
    expect(await db.goals.count()).toBe(0);
    expect(await db.seasons.count()).toBe(0);
    expect(await db.outbox.toArray()).toEqual(V1_ROWS.outbox);
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 0 });
    expect(await db.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dev-1' });
    await db.goals.put({ ...base, id: 'g1', title: 'Carreira em Dados', status: 'ativo', order: 0 });
    await db.seasons.put({ ...base, id: 'se1', title: 'Consistência', focus: [], startDay: '2026-11-23', plannedWeeks: 6, status: 'ativa' });
    expect(await db.goals.get('g1')).toMatchObject({ title: 'Carreira em Dados' });
    expect(await db.seasons.get('se1')).toMatchObject({ plannedWeeks: 6 });
  });
});

// Frozen copy of the v12 schema that is already in the user's browser: never edit it.
const V12_ADDED = { goals: 'id', seasons: 'id' };

describe('Dexie v12 → v13 (comunicação oral)', () => {
  it('keeps every v12 row, adds the speech tables and restarts the cursor (no data migration)', async () => {
    const v12 = new Dexie(NAME);
    v9Schema(v12);
    v12.version(10).stores(V10_ADDED);
    v12.version(11).stores(V11_ADDED);
    v12.version(12).stores(V12_ADDED);
    await v12.open();
    for (const [table, rows] of Object.entries(V1_ROWS)) await v12.table(table).bulkPut(rows);
    const goal = { ...base, id: 'g1', title: 'Carreira em Dados', status: 'ativo', order: 0 };
    await v12.table('goals').put(goal);
    await v12.table('meta').put({ key: 'cursor', value: 42 });
    v12.close();

    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(17);
    expect(await db.journeys.get('j1')).toEqual(V1_ROWS.journeys![0]);
    expect(await db.goals.get('g1')).toEqual(goal);
    expect(await db.speechSessions.count()).toBe(0);
    expect(await db.speechSituations.count()).toBe(0);
    expect(await db.speechPrograms.count()).toBe(0);
    expect(await db.outbox.toArray()).toEqual(V1_ROWS.outbox);
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 0 });
    expect(await db.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dev-1' });
    await db.speechSessions.put({ ...base, id: 'sp1', day: '2026-11-23', kind: 'leitura', passage: 'feira', recordings: [], ratings: {} });
    expect((await db.speechSessions.where('day').equals('2026-11-23').toArray()).map((s) => s.id)).toEqual(['sp1']);
  });
});

// Frozen copy of the v13 and v14 schemas that are already in the user's browser: never edit them.
const V13_ADDED = { speechSessions: 'id,day', speechSituations: 'id,day', speechPrograms: 'id' };
const V14_ADDED = { proposals: 'id,status' };

describe('Dexie v14 → v15 (nutrição)', () => {
  it('keeps every v14 row, adds the nutrition tables and restarts the cursor (no data migration)', async () => {
    const v14 = new Dexie(NAME);
    v9Schema(v14);
    v14.version(10).stores(V10_ADDED);
    v14.version(11).stores(V11_ADDED);
    v14.version(12).stores(V12_ADDED);
    v14.version(13).stores(V13_ADDED);
    v14.version(14).stores(V14_ADDED);
    await v14.open();
    for (const [table, rows] of Object.entries(V1_ROWS)) await v14.table(table).bulkPut(rows);
    const proposal = { ...base, id: 'p1', source: 'Claude', payload: { title: 'Rotina', summary: 's' }, status: 'pending' };
    await v14.table('proposals').put(proposal);
    await v14.table('meta').put({ key: 'cursor', value: 42 });
    v14.close();

    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(17);
    expect(await db.proposals.get('p1')).toEqual(proposal);
    expect(await db.settings.get('settings')).toEqual(V1_ROWS.settings![0]);
    for (const t of [db.foods, db.nutritionTargets, db.foodLogs, db.pantry, db.weighIns]) expect(await t.count()).toBe(0);
    expect(await db.outbox.toArray()).toEqual(V1_ROWS.outbox);
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 0 });
    expect(await db.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dev-1' });
    await db.foodLogs.put({ ...base, id: 'fl1', day: '2026-11-25', meal: 'almoco', foodId: 'f1', name: 'Arroz', per100: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 }, basis: 'pronto', estimate: false, grams: 150, status: 'comido', order: 0 });
    expect((await db.foodLogs.where('day').equals('2026-11-25').toArray()).map((l) => l.id)).toEqual(['fl1']);
    await db.weighIns.put({ ...base, id: 'w1', day: '2026-11-25', kg: 72.4 });
    expect(await db.weighIns.where('day').equals('2026-11-25').count()).toBe(1);
    await db.pantry.put({ ...base, id: 'pantry-f1', foodId: 'f1', confirmedDay: '2026-11-25' });
    expect(await db.pantry.where('foodId').equals('f1').count()).toBe(1);
    await db.nutritionTargets.bulkPut([
      { ...base, id: 'ntarget-2026-11-20', from: '2026-11-20', byWeekday: [] },
      { ...base, id: 'ntarget-2026-11-10', from: '2026-11-10', byWeekday: [] },
    ]);
    expect((await db.nutritionTargets.orderBy('from').toArray()).map((t) => t.from)).toEqual(['2026-11-10', '2026-11-20']);
    await db.foods.put({ ...base, id: 'f1', name: 'Arroz', per100: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 }, basis: 'pronto', source: 'tabela', group: 'carboidrato', like: 'normal' });
    expect((await db.foods.orderBy('name').first())!.id).toBe('f1');
  });
});

// Frozen copy of the v15 schema that is already in the user's browser: never edit it.
const V15_ADDED = { foods: 'id,name', nutritionTargets: 'id,from', foodLogs: 'id,day', pantry: 'id,foodId', weighIns: 'id,day' };

describe('Dexie v15 → v16 (caderno da disciplina)', () => {
  it('keeps every v15 row, adds the notebook and apostila tables and restarts the cursor (no data migration)', async () => {
    const v15 = new Dexie(NAME);
    v9Schema(v15);
    v15.version(10).stores(V10_ADDED);
    v15.version(11).stores(V11_ADDED);
    v15.version(12).stores(V12_ADDED);
    v15.version(13).stores(V13_ADDED);
    v15.version(14).stores(V14_ADDED);
    v15.version(15).stores(V15_ADDED);
    await v15.open();
    for (const [table, rows] of Object.entries(V1_ROWS)) await v15.table(table).bulkPut(rows);
    const weigh = { ...base, id: 'w1', day: '2026-11-25', kg: 72.4 };
    await v15.table('weighIns').put(weigh);
    await v15.table('meta').put({ key: 'cursor', value: 42 });
    v15.close();

    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(17);
    expect(await db.weighIns.get('w1')).toEqual(weigh);
    expect(await db.profile.get('me')).toEqual(V1_ROWS.profile![0]);
    expect(await db.subjectNotebooks.count()).toBe(0);
    expect(await db.studyDocs.count()).toBe(0);
    expect(await db.outbox.toArray()).toEqual(V1_ROWS.outbox);
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 0 });
    expect(await db.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dev-1' });
    await db.subjectNotebooks.put({ ...base, id: 'notebook-j1', journeyId: 'j1', plan: 'Ementa', bibliography: [] });
    expect((await db.subjectNotebooks.where('journeyId').equals('j1').toArray()).map((n) => n.id)).toEqual(['notebook-j1']);
    await db.studyDocs.bulkPut([
      { ...base, id: 'doc1', journeyId: 'j1', title: 'Normalização', markdown: '# 1FN', source: 'ChatGPT' },
      { ...base, id: 'doc2', journeyId: 'j2', title: 'Limites', markdown: 'x', source: 'Você' },
    ]);
    expect((await db.studyDocs.where('journeyId').equals('j1').toArray()).map((d) => d.id)).toEqual(['doc1']);
  });
});

// Frozen copy of the v16 schema that is already in the user's browser: never edit it.
const V16_ADDED = { subjectNotebooks: 'id,journeyId', studyDocs: 'id,journeyId' };

describe('Dexie v16 → v17 (PDFs da aula)', () => {
  it('keeps every v16 row, adds the PDF and reading progress tables and restarts the cursor (no data migration)', async () => {
    const v16 = new Dexie(NAME);
    v9Schema(v16);
    v16.version(10).stores(V10_ADDED);
    v16.version(11).stores(V11_ADDED);
    v16.version(12).stores(V12_ADDED);
    v16.version(13).stores(V13_ADDED);
    v16.version(14).stores(V14_ADDED);
    v16.version(15).stores(V15_ADDED);
    v16.version(16).stores(V16_ADDED);
    await v16.open();
    for (const [table, rows] of Object.entries(V1_ROWS)) await v16.table(table).bulkPut(rows);
    const doc = { ...base, id: 'doc1', journeyId: 'j1', title: 'Normalização', markdown: '# 1FN', source: 'ChatGPT' };
    await v16.table('studyDocs').put(doc);
    const media = { hash: 'a'.repeat(64), type: 'image/png', size: 32, addedAt: 5 };
    await v16.table('mediaInfo').put(media);
    await v16.table('meta').put({ key: 'cursor', value: 42 });
    v16.close();

    const db = new LifeDB(NAME);
    open = db;
    await db.open();
    expect(db.verno).toBe(17);
    expect(await db.studyDocs.get('doc1')).toEqual(doc);
    expect(await db.mediaInfo.get('a'.repeat(64))).toEqual(media);
    expect(await db.profile.get('me')).toEqual(V1_ROWS.profile![0]);
    expect(await db.studyFiles.count()).toBe(0);
    expect(await db.outbox.toArray()).toEqual(V1_ROWS.outbox);
    expect(await db.meta.get('cursor')).toEqual({ key: 'cursor', value: 0 });
    expect(await db.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dev-1' });
    await db.studyFiles.bulkPut([
      { ...base, id: 'pdf1', journeyId: 'j1', title: 'Slides', fileHash: 'b'.repeat(64), bytes: 900, pages: 12, hasText: true, textHash: 'c'.repeat(64), textChars: 300 },
      { ...base, id: 'pdf2', title: 'Sem disciplina', fileHash: 'd'.repeat(64), bytes: 900, pages: 3, hasText: false },
    ]);
    expect((await db.studyFiles.where('journeyId').equals('j1').toArray()).map((f) => f.id)).toEqual(['pdf1']);
    // Where she stopped: a record of its own, keyed by the PDF's id.
    expect(await db.studyFileProgress.count()).toBe(0);
    await db.studyFileProgress.put({ ...base, id: 'pdf1', lastPage: 7, lastReadAt: 9 });
    expect(await db.studyFileProgress.get('pdf1')).toMatchObject({ lastPage: 7, lastReadAt: 9 });
  });
});
