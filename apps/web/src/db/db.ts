import Dexie, { type Table } from 'dexie';
import type {
  Area, Block, BlockSession, Checkin, Commitment, DayState, EnergyLog, FocusSession, Journey,
  LifeEvent, Mission, Profile, Settings, SyncTable, Week, XpEvent,
} from '@life/shared';

export interface OutboxEntry { key: string; table: SyncTable; id: string; updatedAt: number } // key = `${table}:${id}`
export interface MetaEntry { key: string; value: unknown }

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
    // v2 (Marco 2): routine blocks, lived block sessions, weeks and check-ins. The upgrade only
    // adds `mode` to hard days (same meaning, so updatedAt is kept and nothing is re-synced).
    this.version(2).stores({
      blocks: 'id,order',
      blockSessions: 'id,day,blockId',
      weeks: 'id',
      checkins: 'id,at,kind',
    }).upgrade((tx) => tx.table('dayState').toCollection().modify((d: DayState) => {
      if (d.hardDay && !d.mode) d.mode = 'low';
    }));
  }
}

export const db = new LifeDB();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tableOf(name: SyncTable): Table<any, string> {
  return db.table(name);
}
