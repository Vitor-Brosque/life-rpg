import Dexie, { type Table } from 'dexie';
import type {
  Area, Block, BlockSession, Card, Checkin, Commitment, DayPlan, DayState, Deck, DiaryEntry, EnergyLog, FocusSession, Food, FoodLog, FreezerMove,
  Goal, Journey, LifeEvent, MediaType, Menu, Mission, MonthReview, Note, NutritionTarget, PantryItem, PracticeSession, ProblemSet, Profile, Proposal,
  Recipe, Review, Settings, ShoppingList, Sketch, SleepLog, Season, SpeechProgram, SpeechSession, SpeechSituation, Strategy, StudyDoc,
  StudyFile, StudyFileProgress, SubjectNotebook, SubjectTopic, SyncTable, TrainingLog, TrainingPlan, Week, WeighIn, Workout, XpEvent,
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
  strategies!: Table<Strategy, string>;
  goals!: Table<Goal, string>;
  seasons!: Table<Season, string>;
  speechSessions!: Table<SpeechSession, string>;
  speechSituations!: Table<SpeechSituation, string>;
  speechPrograms!: Table<SpeechProgram, string>;
  proposals!: Table<Proposal, string>;
  foods!: Table<Food, string>;
  nutritionTargets!: Table<NutritionTarget, string>;
  foodLogs!: Table<FoodLog, string>;
  pantry!: Table<PantryItem, string>;
  weighIns!: Table<WeighIn, string>;
  subjectNotebooks!: Table<SubjectNotebook, string>;
  studyDocs!: Table<StudyDoc, string>;
  studyFiles!: Table<StudyFile, string>;
  studyFileProgress!: Table<StudyFileProgress, string>;
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

    // v11 (Estratégias e estado do dia): the strategies Vitor tests. No data migration: Week.experiment stays as it
    // is (read only) and the new DayState/Settings fields need none. Same cursor restart as v2–v4 and v6–v10, so
    // strategies a v10 client skipped (unknown table) are pulled again.
    this.version(11).stores({
      strategies: 'id',
    }).upgrade(async (tx) => {
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });

    // v12 (Objetivos e temporadas): the objectives above the journeys and the optional 6–8-week seasons. No data migration:
    // Journey.goalId, WeekReview.goals, the 'investiguei' outcome and the Parcial's `investigated` are optional fields. Same
    // cursor restart as v2–v4 and v6–v11, so goals and seasons a v11 client skipped (unknown tables) are pulled again.
    this.version(12).stores({
      goals: 'id',
      seasons: 'id',
    }).upgrade(async (tx) => {
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });

    // v13 (Comunicação oral): speech sessions, real situations and the 12-week program. No data migration: Settings.speech
    // and the 'speech' XP reason are optional. Same cursor restart as v2–v4 and v6–v12, so speech records a v12 client
    // skipped (unknown tables) are pulled again.
    this.version(13).stores({
      speechSessions: 'id,day',
      speechSituations: 'id,day',
      speechPrograms: 'id',
    }).upgrade(async (tx) => {
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });
    // Assistentes pelo MCP (2026-11-25): proposals written by the server, decided here. The cursor goes back to 0
    // so proposals already on the server arrive (records already here are kept by the merge rule).
    this.version(14).stores({
      proposals: 'id,status',
    }).upgrade(async (tx) => {
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });
    // v15 (Nutrição): foods and recipes, targets with history, the diary by meal, the day's stock and weigh-ins. No data
    // migration: Settings.nutrition is optional. Same cursor restart as v2–v4 and v6–v14, so nutrition records a v14
    // client skipped (unknown tables) are pulled again (last-writer-wins makes the replay harmless).
    this.version(15).stores({
      foods: 'id,name',
      nutritionTargets: 'id,from',
      foodLogs: 'id,day',
      pantry: 'id,foodId',
      weighIns: 'id,day',
    }).upgrade(async (tx) => {
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });
    // v16 (Caderno da disciplina, 2026-11-26): one notebook per subject and the apostilas, both by subject. No data
    // migration: Profile.studyProfile is optional. Same cursor restart as v15, so notebooks and apostilas a v15 client
    // skipped (unknown tables) are pulled again.
    this.version(16).stores({
      subjectNotebooks: 'id,journeyId',
      studyDocs: 'id,journeyId',
    }).upgrade(async (tx) => {
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });
    // v17 (PDFs da aula, 2026-11-26): the PDFs of Materiais, by subject, and where she stopped in each one (a record of
    // its own, id = the PDF's id, so reading never rewrites the PDF's record). No data migration: Note.source is optional.
    // Same cursor restart as v16, so PDFs a v16 client skipped (unknown tables) are pulled again.
    this.version(17).stores({
      studyFiles: 'id,journeyId',
      studyFileProgress: 'id',
    }).upgrade(async (tx) => {
      await tx.table('meta').put({ key: 'cursor', value: 0 });
    });
  }
}

export const db = new LifeDB();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tableOf(name: SyncTable): Table<any, string> {
  return db.table(name);
}
