export type ID = string;
/** Local calendar day, 'YYYY-MM-DD' */
export type DayKey = string;
/** Local time of day, 'HH:mm' */
export type HHmm = string;

export interface BaseRecord {
  id: ID;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}

export type MissionStatus = 'open' | 'doing' | 'done' | 'dropped';
export type Energy = 'light' | 'medium' | 'heavy';
export type EnergyLevel = 'low' | 'medium' | 'high';

export type Recurrence =
  | { kind: 'daily' }
  | { kind: 'weekly'; weekdays: number[] } // 0 = Sunday
  | { kind: 'monthly'; day: number }       // 1..31, clamped to month length
  | { kind: 'afterDays'; days: number };

export interface ChecklistItem { id: ID; text: string; done: boolean }

export interface Mission extends BaseRecord {
  title: string;
  firstStep?: string;
  notes?: string;
  checklist: ChecklistItem[];
  status: MissionStatus;
  durationMin?: number;
  energy?: Energy;
  areaId?: ID;
  journeyId?: ID;
  journeyOrder?: number;
  date?: DayKey;          // planned day (soft)
  dayOrder?: number;      // manual order inside the day list
  deadline?: DayKey;      // hard deadline
  notBefore?: DayKey;
  snoozedUntil?: number;  // epoch ms
  important: boolean;
  shrunk: boolean;
  postponeCount: number;
  recurrence?: Recurrence;
  startedAt?: number;
  completedAt?: number;
  dropReason?: string;
  blockId?: ID;           // explicit block assignment (wins over area/journey link)
}

export type JourneyStatus = 'active' | 'done' | 'archived';
export interface Journey extends BaseRecord {
  title: string;
  outcome?: string;
  areaId?: ID;
  status: JourneyStatus;
  order: number;
}

export interface Commitment extends BaseRecord {
  title: string;
  date: DayKey;          // first (or only) occurrence
  start: HHmm;
  end: HHmm;
  weekdays?: number[];   // weekly recurrence, 0 = Sunday
  untilDate?: DayKey;
  remind: boolean;
}

export interface Area extends BaseRecord {
  name: string;       // e.g. 'Corpo'
  attribute: string;  // e.g. 'Vigor'
  color: string;      // CSS color
  icon: string;       // icon key from art/icons.tsx
  order: number;
  archived: boolean;
}

export type TimerMode = 'free' | 'pomodoro' | 'countdown';
export interface FocusSession extends BaseRecord {
  startedAt: number;
  endedAt: number;
  activeMs: number;
  mode: TimerMode;
  missionId?: ID;
  areaId?: ID;
  outcome: 'finished' | 'interrupted';
  interruptReason?: string;
  notes?: string;
}

export interface EnergyLog extends BaseRecord { at: number; level: EnergyLevel }

export type EventType =
  | 'created' | 'started' | 'completed' | 'uncompleted' | 'skipped' | 'shrunk'
  | 'snoozed' | 'dropped' | 'rescheduled' | 'split' | 'focus' | 'review' | 'hardDay';
export interface LifeEvent extends BaseRecord {
  at: number;
  type: EventType;
  missionId?: ID;
  data?: Record<string, unknown>;
}

export type XpReason = 'complete' | 'start' | 'strategy' | 'focus' | 'review' | 'journey' | 'resilience'
  | 'block' | 'resumption' | 'checkin' | 'objective';
export interface XpEvent extends BaseRecord {
  at: number;
  amount: number;
  areaId?: ID;
  reason: XpReason;
  missionId?: ID;
  dayKey: DayKey;
}

export interface CharacterLook { skin: number; hair: number; hairColor: number; outfit: number }
export interface Profile extends BaseRecord {   // id = 'me'
  name: string;
  look: CharacterLook;
  companionName: string;
  onboarded: boolean;
}
export interface Settings extends BaseRecord {  // id = 'settings'
  dayStartHour: number;
  dayEndHour: number;
  pomodoro: { focusMin: number; breakMin: number };
  companionMuted: boolean;
  commitmentReminderMin: number; // 0 = off
  checkinCard?: boolean;         // absent = true
}
export interface DayState extends BaseRecord {  // id = DayKey
  hardDay: boolean;
  reviewDone: boolean;
  mode?: DayMode;
  startedAt?: number;   // when the day actually started
}

export type DayMode = 'normal' | 'low' | 'recovery' | 'free';
export type BlockKind = 'focus' | 'body' | 'study' | 'light' | 'routine';

export interface Block extends BaseRecord {
  name: string;
  weekdays: number[];          // 0 = Sunday
  order: number;
  targetStart: HHmm;
  durationMin: number;         // normal duration (minutes)
  minimumMin: number;          // minimum version (minutes), <= durationMin
  areaId?: ID;
  journeyId?: ID;
  kind: BlockKind;
  protected: boolean;
  checklist: ChecklistItem[];  // used by 'routine' blocks
  archived: boolean;
}
export interface BlockSession extends BaseRecord {  // id = `bs-${blockId}-${day}`
  blockId: ID;
  day: DayKey;
  startedAt?: number;
  endedAt?: number;
  version: 'normal' | 'minimum';
  nextAction?: string;
}
export interface WeekObjective { id: ID; blockId: ID; text: string; done: boolean }
export interface WeekReview { worked: string; obstacle: string; adjustment: string; answeredAt: number }
export interface Week extends BaseRecord {           // id = Monday DayKey
  objectives: WeekObjective[];
  review?: WeekReview;
  experiment?: string;
}
export interface Checkin extends BaseRecord {
  at: number;
  kind: 'start' | 'escape';
  feelings: string[];
  thought?: string;
  experimentMin?: number;
  outcome?: 'continued' | 'stopped';
  escapedTo?: string;
  missionId?: ID;
  blockId?: ID;
}

export const SYNC_TABLES = [
  'missions', 'journeys', 'commitments', 'areas', 'focusSessions', 'energyLogs',
  'events', 'xpEvents', 'profile', 'settings', 'dayState',
  'blocks', 'blockSessions', 'weeks', 'checkins',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
export const APPEND_ONLY_TABLES: readonly SyncTable[] = ['events', 'xpEvents'];

export interface SyncChange { table: SyncTable; record: BaseRecord & Record<string, unknown> }
export interface SyncRequest { deviceId: string; cursor: number; changes: SyncChange[] }
export interface SyncResponse {
  cursor: number;
  changes: SyncChange[];
  /** The server is behind the device's cursor (restored backup): restart from 0 and resend everything. */
  reset?: boolean;
}
