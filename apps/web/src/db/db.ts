import Dexie, { type Table } from 'dexie';
import type {
  Area, Block, BlockSession, Card, Checkin, Commitment, DayState, Deck, EnergyLog, FocusSession, Journey,
  LifeEvent, MediaType, Mission, Note, PracticeSession, Profile, Review, Settings, Sketch, SyncTable, Week, XpEvent,
} from '@life/shared';
import { weekdayOf } from '@life/shared';

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
  }
}

export const db = new LifeDB();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tableOf(name: SyncTable): Table<any, string> {
  return db.table(name);
}
