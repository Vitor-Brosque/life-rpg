import Dexie, { type Table } from 'dexie';
import type {
  Area, Commitment, DayState, EnergyLog, FocusSession, Journey, LifeEvent, Mission,
  Profile, Settings, SyncTable, XpEvent,
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
  outbox!: Table<OutboxEntry, string>;
  meta!: Table<MetaEntry, string>;

  constructor(name = 'life-rpg') {
    super(name);
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
  }
}

export const db = new LifeDB();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tableOf(name: SyncTable): Table<any, string> {
  return db.table(name);
}
