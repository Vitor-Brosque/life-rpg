import Dexie, { type Table } from 'dexie';
import type {
  Area, Block, BlockSession, Card, Checkin, Commitment, DayPlan, DayState, Deck, DiaryEntry, EnergyLog, FocusSession, FreezerMove, Journey,
  LifeEvent, MediaType, Menu, Mission, MonthReview, Note, PracticeSession, ProblemSet, Profile, Recipe, Review, Settings, ShoppingList, Sketch,
  SleepLog, SubjectTopic, SyncTable, TrainingLog, TrainingPlan, Week, Workout, XpEvent,
} from '@life/shared';
import { closeNoteEntry, weekdayOf } from '@life/shared';

export interface OutboxEntry { key: string; table: SyncTable; id: string; updatedAt: number } // key = `${table}:${id}`
export interface MetaEntry { key: string; value: unknown }
/** Media on this device (Marco 3c): metadata, read without loading the bytes (usage, export). Local only. */
export interface MediaInfo { hash: string; type: MediaType; size: number; addedAt: number }
/** The bytes. ArrayBuffer, not Blob: Safari has lost Blobs kept in IndexedDB. Local only. */
export interface MediaData { hash: string; type: MediaType; bytes: ArrayBuffer }
/** Upload queue: files made or imported here that the server has not confirmed yet. Local only. */
export interface MediaUpload { hash: string; addedAt: number }

export class LifeDB extends Dexie {
  missions!: Table<Mission, string>;
  journeys!: Table<Journey, string>;
  commitments!: Table<Commitment, string>;
  areas!: Table<Area, string>;
  focusSessions!: Table<FocusSession, string>;
  energyLogs!: Table<EnergyLog, string>;
  events!: Table<LifeEvent, string>;
  xpEvents!: Table<XpEvent, string>;
  profile!: Table<Profile, string>;
  settings!: Table<Settings, string>;
  dayState!: Table<DayState, string>;
  blocks!: Table<Block, string>;
  blockSessions!: Table<BlockSession, string>;
  weeks!: Table<Week, string>;
  checkins!: Table<Checkin, string>;
  decks!: Table<Deck, string>;
  notes!: Table<Note, string>;
  cards!: Table<Card, string>;
  reviews!: Table<Review, string>;
  sketches!: Table<Sketch, string>;
  practiceSessions!: Table<PracticeSession, string>;
  sleepLogs!: Table<SleepLog, string>;
  recipes!: Table<Recipe, string>;
  menus!: Table<Menu, string>;
  shoppingLists!: Table<ShoppingList, string>;
  freezerMoves!: Table<FreezerMove, string>;
  workouts!: Table<Workout, string>;
  monthReviews!: Table<MonthReview, string>;
  trainingPlans!: Table<TrainingPlan, string>;
  trainingLogs!: Table<TrainingLog, string>;
  dayPlans!: Table<DayPlan, string>;
  problemSets!: Table<ProblemSet, string>;
  subjectTopics!: Table<SubjectTopic, string>;
  diaryEntries!: Table<DiaryEntry, string>;
  mediaInfo!: Table<MediaInfo, string>;
  mediaData!: Table<MediaData, string>;
  mediaQueue!: Table<MediaUpload, string>;
  outbox!: Table<OutboxEntry, string>;
  meta!: Table<MetaEntry, string>;

  constructor(name = 'life-rpg') {
    super(name);
    // v1 is already in the user's browser: never change it, add a new version instead.
    this.version(1).stores({
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
    });
    // v2 (Marco 2): routine blocks, lived block sessions, weeks and check-ins. The upgrade adds
    // `mode` to weekday hard days (same meaning, so updatedAt is kept and nothing is re-synced;
    // weekends stay free) and restarts the sync cursor: records of the new tables that a v1
    // client could not apply are pulled again (last-writer-wins makes the replay harmless).
    this.version(2).stores({
      blocks: 'id,order',
      blockSessions: 'id,day,blockId',
      weeks: 'id',
      checkins: 'id,at,kind',
    }).upgrade(async (tx) => {
      await tx.table('dayState').toCollection().modify((d: DayState) => {
        const wd = weekdayOf(d.id);
        if (d.hardDay && !d.mode && wd !== 0 && wd !== 6) d.mode = 'low';
      });
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });

    // v3 (Marco 3): spaced repetition. Restart the sync cursor like v2 did, so study records a v2
    // client skipped (unknown tables) are pulled again; last-writer-wins makes the replay harmless.
    this.version(3).stores({
      decks: 'id,order',
      notes: 'id,deckId',
      cards: 'id,noteId,deckId,due',
      reviews: 'id,cardId,day,at',
    }).upgrade(async (tx) => {
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });

    // v4 (Marco 3b): lousas (one record per lousa, every stroke inside). Same cursor restart as v2/v3,
    // so sketches a v3 client skipped (unknown table) are pulled again.
    this.version(4).stores({
      sketches: 'id,updatedAt',
    }).upgrade(async (tx) => {
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });

    // v5 (Marco 3c): media bytes, kept only on this device (never in SYNC_TABLES; files sync through
    // /api/media). No synced table is new, so there is nothing to pull again: the cursor stays.
    this.version(5).stores({
      mediaInfo: 'hash',
      mediaData: 'hash',
      mediaQueue: 'hash,addedAt',
    });

    // v6 (Marco 3d): practice sessions (v5 belongs to Marco 3c; Dexie accepts the gap). Same cursor
    // restart as v2-v4, so sessions a v4/v5 client skipped (unknown table) are pulled again.
    this.version(6).stores({
      practiceSessions: 'id,status,journeyId,updatedAt',
    }).upgrade(async (tx) => {
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });

    // v7 (Marco 4 — corpo e casa; v5 and v6 belong to Marcos 3c and 3d): sleep nights, recipes, weekly
    // menus and shopping lists, freezer moves and workouts. Same cursor restart as v2–v4.
    this.version(7).stores({
      sleepLogs: 'id,night',
      recipes: 'id',
      menus: 'id',
      shoppingLists: 'id',
      freezerMoves: 'id,at,recipeId',
      workouts: 'id,day,at',
    }).upgrade(async (tx) => {
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });

    // v8 (Marco 5): monthly reflections, one record per month reflected upon. Same cursor restart as
    // v2–v4, v6 and v7, so reflections a v7 client skipped (unknown table) are pulled again.
    this.version(8).stores({
      monthReviews: 'id',
    }).upgrade(async (tx) => {
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });

    // v9 (Acompanhamento diário): training plan and day logs, day plans (snapshots), exercise logs and
    // subject topics. Same cursor restart as v2–v4 and v6–v8, so records a v8 client skipped are pulled again.
    this.version(9).stores({
      trainingPlans: 'id',
      trainingLogs: 'id,day',
      dayPlans: 'id',
      problemSets: 'id,journeyId,day',
      subjectTopics: 'id,journeyId',
    }).upgrade(async (tx) => {
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });

    // v10 (Diário): free-text diary entries. Each live day-close note (DayState.closeNote) becomes that day's
    // `fechamento` entry, built from the DayState alone (closeNoteEntry: same id, text and timestamps on every
    // device, so two devices that migrate write identical records), and is queued in the outbox exactly like a
    // repo write (key `${table}:${id}`, the record's own updatedAt), so the next sync sends it. closeNote stays in
    // the old records, unused. Same cursor restart as v2–v4 and v6–v9.
    this.version(10).stores({
      diaryEntries: 'id,day,at',
    }).upgrade(async (tx) => {
      const states = (await tx.table('dayState').toArray()) as DayState[];
      for (const state of states) {
        const entry = closeNoteEntry(state);
        if (!entry) continue;
        await tx.table('diaryEntries').put(entry);
        await tx.table('outbox').put({ key: `diaryEntries:${entry.id}`, table: 'diaryEntries', id: entry.id, updatedAt: entry.updatedAt });
      }
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });
  }
}

export const db = new LifeDB();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tableOf(name: SyncTable): Table<any, string> {
  return db.table(name);
}
