import type { BaseRecord, DayKey, HHmm, Settings, SleepLog, SleepQuality, SleepSettings, SyncTable } from '@life/shared';
import {
  SLEEP_ISSUE_TEXT, sleepIssue, sleepLogId, sleepMinutes, sleepSettingsOf, sleepTimes, sleepXpId,
} from '@life/shared';
import { db } from '../db/db';
import { newRecord, patch, putAll } from '../db/repo';
import { withLock } from './common';

// Sono (Marco 4, spec §4). Logging a night gives no XP: XP is for effort, never for registering
// data (research B14/D11). Old awards (`xp-sleep-<night>`) are still removed when the night is
// undone, edited to incomplete or deleted, so Desfazer/Apagar stay coherent.

export class SleepValidationError extends Error {}

type Times = Partial<Pick<SleepLog, 'bedAt' | 'wakeAt'>>;

async function liveLog(night: DayKey): Promise<SleepLog | undefined> {
  const l = await db.sleepLogs.get(sleepLogId(night));
  return l && !l.deleted ? l : undefined;
}

/** `base` with `times` applied: a key present with `undefined` removes that time. */
function withTimes(base: SleepLog, times: Times): SleepLog {
  const out: SleepLog = { ...base, ...times };
  if (out.bedAt === undefined) delete out.bedAt;
  if (out.wakeAt === undefined) delete out.wakeAt;
  return out;
}

/** Writes the night (created, or revived, when missing) and its XP in one transaction. */
async function writeNight(night: DayKey, times: Times): Promise<{ log: SleepLog; xp: number }> {
  const prev = await liveLog(night);
  const next = withTimes(prev ?? newRecord<SleepLog>({ id: sleepLogId(night), night }), times);
  const xpId = sleepXpId(night);
  const current = await db.xpEvents.get(xpId);
  const had = !!current && !current.deleted;
  const complete = sleepMinutes(next) !== undefined;
  const entries: Array<{ table: SyncTable; record: BaseRecord }> = [{ table: 'sleepLogs', record: next }];
  // Never awards XP any more; only an old award (from before) is removed when the night stops being complete.
  if (!complete && had) entries.push({ table: 'xpEvents', record: { ...current!, deleted: true } });
  await putAll(entries);
  return { log: (await db.sleepLogs.get(next.id))!, xp: 0 };
}

/** "Deitei": now is the night's bedtime. */
export const logBedtime = (night: DayKey): Promise<TapResult> => tapTime(night, 'bedAt');

/** "Acordei": now is the night's wake time. */
export const logWake = (night: DayKey): Promise<TapResult> => tapTime(night, 'wakeAt');

/** `created: false` = the time was already there (another tab or device): nothing was written. */
export interface TapResult { log: SleepLog; xp: number; created: boolean }

/** A tap never overwrites a time already stored (the sheet is the place to change it). */
const tapTime = (night: DayKey, field: 'bedAt' | 'wakeAt'): Promise<TapResult> => withLock('sleep', async () => {
  const prev = await liveLog(night);
  if (prev && prev[field] !== undefined) return { log: prev, xp: 0, created: false };
  return { ...(await writeNight(night, { [field]: Date.now() })), created: true };
});

/** "Desfazer" after a tap: removes that time again (an old award is removed if the night stops being complete, never restored). */
export const clearSleepTime = (night: DayKey, field: 'bedAt' | 'wakeAt'): Promise<{ log: SleepLog; xp: number }> =>
  withLock('sleep', () => writeNight(night, { [field]: undefined }));

/**
 * The edit sheet: both times as typed (null = no time). Rejects with SleepValidationError (PT-BR
 * message) when the wake time is not after the bedtime or the night is longer than 16 h.
 */
export function saveSleepTimes(night: DayKey, bed: HHmm | null, wake: HHmm | null): Promise<{ log: SleepLog; xp: number }> {
  const t = sleepTimes(night, bed ?? undefined, wake ?? undefined);
  const issue = sleepIssue(t);
  if (issue) return Promise.reject(new SleepValidationError(SLEEP_ISSUE_TEXT[issue]));
  return withLock('sleep', () => writeNight(night, { bedAt: t.bedAt, wakeAt: t.wakeAt }));
}

/** "Apagar noite": soft-deletes the night and its XP. Resolves with what was deleted (for Desfazer). */
export const deleteSleepLog = (night: DayKey): Promise<SleepLog | undefined> => withLock('sleep', async () => {
  const log = await liveLog(night);
  if (!log) return undefined;
  const entries: Array<{ table: SyncTable; record: BaseRecord }> = [{ table: 'sleepLogs', record: { ...log, deleted: true } }];
  const x = await db.xpEvents.get(sleepXpId(night));
  if (x && !x.deleted) entries.push({ table: 'xpEvents', record: { ...x, deleted: true } });
  await putAll(entries);
  return log;
});

/** Desfazer of "Apagar noite": the same times come back (no XP: old awards are removed, never restored). */
export const restoreSleepLog = (log: SleepLog): Promise<{ log: SleepLog; xp: number }> =>
  withLock('sleep', () => writeNight(log.night, { bedAt: log.bedAt, wakeAt: log.wakeAt }));

/** "Como foi o sono?": the perceived quality of an existing night (null removes it). No night, nothing is written. */
export const setSleepQuality = (night: DayKey, quality: SleepQuality | null): Promise<SleepLog | undefined> =>
  withLock('sleep', async () => {
    if (!(await liveLog(night))) return undefined;
    return patch<SleepLog>('sleepLogs', sleepLogId(night), { quality: quality ?? undefined });
  });

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Saves `settings.sleep` (missing fields from the current values); an invalid time keeps the old one. */
export async function saveSleepSettings(changes: Partial<SleepSettings>): Promise<void> {
  await db.transaction('rw', db.settings, db.outbox, async () => {
    const current = await db.settings.get('settings');
    const cur = sleepSettingsOf(current);
    const next: SleepSettings = { ...cur, ...changes };
    if (!HHMM.test(next.windDownAt)) next.windDownAt = cur.windDownAt;
    if (current) await patch<Settings>('settings', 'settings', { sleep: next });
  });
}
