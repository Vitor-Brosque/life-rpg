import type {
  Block, BlockSession, Checkin, DayKey, LifeEvent, Mission, PracticeSession, Review, SleepLog, Week, Workout, XpEvent,
} from '../src/types';
import { addDays, timestampAt } from '../src/dates';
import { newPracticeFields } from '../src/practice';
import type { PatternData } from '../src/trends';

// Shared fixture of the Marco 5 tests: PatternData builders. Today is Friday 2026-11-13.

export const TODAY = '2026-11-13';
export const base = { createdAt: 1, updatedAt: 1, deleted: false };
let seq = 0;
const id = (p: string): string => `${p}${++seq}`;

export function emptyData(p: Partial<PatternData> = {}): PatternData {
  return {
    today: TODAY, dayStartHour: 4, dayEndHour: 0,
    dayStates: [], blocks: [], commitments: [], sessions: [], xpEvents: [], events: [], missions: [],
    areas: [], checkins: [], reviews: [], practice: [], sleepLogs: [], workouts: [], weeks: [], watchDismissed: [],
    ...p,
  };
}

export const block = (p: Partial<Block> & Pick<Block, 'id'>): Block => ({
  ...base, name: p.id, weekdays: [1, 2, 3, 4, 5], order: 0, targetStart: '09:00', durationMin: 120, minimumMin: 30,
  kind: 'focus', protected: false, checklist: [], archived: false, ...p,
});

/** A session started at `start` and ended an hour later (version normal unless told). */
export const session = (blockId: string, day: DayKey, start = '09:00', version: 'normal' | 'minimum' = 'normal'): BlockSession => ({
  ...base, id: `bs-${blockId}-${day}`, blockId, day, version,
  startedAt: timestampAt(day, start), endedAt: timestampAt(day, start) + 3_600_000,
});

export const xp = (dayKey: DayKey, p: Partial<XpEvent> = {}): XpEvent => ({
  ...base, id: id('xp'), at: timestampAt(dayKey, '10:00'), amount: 5, reason: 'block', dayKey, ...p,
});

const SCHED = { due: 0, stability: 1, difficulty: 5, reps: 1, lapses: 0, learningSteps: 0, scheduledDays: 1 };
export const review = (day: DayKey, rating: 1 | 2 | 3 | 4, p: Partial<Review> = {}, state: 'new' | 'review' = 'review'): Review => ({
  ...base, id: id('rv'), cardId: 'c', noteId: 'n', at: timestampAt(day, '10:00'), day, rating, durationMs: 5000,
  wrote: false, before: { ...SCHED, state }, after: { ...SCHED, state: 'review' }, ...p,
});

export const practice = (p: Partial<PracticeSession>): PracticeSession => ({
  ...base, id: id('ps'), ...newPracticeFields({ title: 'Sessão' }), status: 'done', ratings: {}, ...p,
});

/** A night that starts on `night` at `bed` (HH:mm, before noon = the next morning) and lasts `minutes`. */
export function night(nightKey: DayKey, bed: string, minutes?: number): SleepLog {
  const [h] = bed.split(':').map(Number);
  const bedAt = timestampAt(h! < 12 ? addDays(nightKey, 1) : nightKey, bed);
  return { ...base, id: `sleep-${nightKey}`, night: nightKey, bedAt, ...(minutes !== undefined ? { wakeAt: bedAt + minutes * 60_000 } : {}) };
}

export const workout = (day: DayKey, kind: Workout['kind'], minutes: number, p: Partial<Workout> = {}): Workout => ({
  ...base, id: id('wo'), at: timestampAt(day, '13:00'), day, kind, minutes, ...p,
});

export const checkin = (day: DayKey, time: string, p: Partial<Checkin> & Pick<Checkin, 'kind'>): Checkin => ({
  ...base, id: id('ck'), at: timestampAt(day, time), feelings: [], ...p,
});

export const mission = (p: Partial<Mission> & Pick<Mission, 'id' | 'title'>): Mission => ({
  ...base, checklist: [], status: 'open', important: false, shrunk: false, postponeCount: 0, ...p,
});

export const event = (type: LifeEvent['type'], missionId: string, day: DayKey, time: string, data?: Record<string, unknown>): LifeEvent => ({
  ...base, id: id('ev'), at: timestampAt(day, time), type, missionId, ...(data ? { data } : {}),
});

/** A week record (id = Monday) marked as atypical. */
export const atypicalWeek = (monday: DayKey, reason = 'Provas', p: Partial<Week> = {}): Week => ({
  ...base, id: monday, objectives: [], atypical: { reason }, ...p,
});
