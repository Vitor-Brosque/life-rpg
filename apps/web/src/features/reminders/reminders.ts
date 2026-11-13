import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Commitment, DayKey, SleepLog, SleepSettings } from '@life/shared';
import { addDays, logicalTimestamp, occurrencesOn, sleepNightOf, sleepSettingsOf, weekdayOf } from '@life/shared';
import { db } from '../../db/db';
import { useSettings, useToday } from '../../db/hooks';
import { getMeta, setMeta } from '../../db/repo';
import { cancelPush, schedulePush } from '../../timer/push';

// Commitment reminders are server pushes (they must arrive with the app closed). The device
// keeps the list it scheduled in meta 'scheduledReminders' and only sends what changed.

export interface ScheduledReminder { tag: string; at: number; title: string; body: string }

const META_KEY = 'scheduledReminders';
const TITLE = 'LIFE RPG';
const MIN = 60_000;
/** Dispatched by the sync client when a token is saved (see sync/client.ts). */
const TOKEN_EVENT = 'life-rpg:token';

/** The server accepts push bodies up to 300 characters (and titles up to 120; TITLE is short). */
const MAX_BODY = 300;

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;

function reminderBody(title: string, start: string): string {
  const suffix = ` começa às ${start}`;
  return `${clip(title, MAX_BODY - suffix.length)}${suffix}`;
}

/**
 * Reminders that should exist now: today's and tomorrow's occurrences still ahead. A start time
 * earlier than `dayStartHour` is on the next calendar morning of its day (§4).
 */
export function desiredReminders(
  commitments: Commitment[], today: DayKey, reminderMin: number, now: number, dayStartHour = 4,
): ScheduledReminder[] {
  if (reminderMin <= 0) return [];
  const out: ScheduledReminder[] = [];
  for (const day of [today, addDays(today, 1)]) {
    for (const o of occurrencesOn(commitments, day, dayStartHour)) {
      const c = o.commitment;
      if (!c.remind) continue;
      const at = o.startTs - reminderMin * MIN;
      if (at <= now) continue;
      out.push({ tag: `commit:${c.id}:${day}`, at, title: TITLE, body: reminderBody(c.title, c.start) });
    }
  }
  return out;
}

const same = (a: ScheduledReminder, b: ScheduledReminder) =>
  a.at === b.at && a.title === b.title && a.body === b.body;

/**
 * Brings the pushes scheduled under `metaKey` in line with `desired`: cancels the tags no longer
 * wanted (retrying failed cancels next time) and schedules the new or changed ones.
 */
async function syncScheduled(metaKey: string, desired: ScheduledReminder[], now: number): Promise<void> {
  const wanted = new Map(desired.map((r) => [r.tag, r]));
  const prev = (await getMeta<ScheduledReminder[]>(metaKey)) ?? [];
  const prevByTag = new Map(prev.map((r) => [r.tag, r]));
  const kept: ScheduledReminder[] = [];

  for (const old of prev) {
    if (wanted.has(old.tag) || old.at <= now) continue; // still wanted, or already delivered
    if (!(await cancelPush(old.tag))) kept.push(old); // retry the cancel next time
  }
  for (const r of desired) {
    const old = prevByTag.get(r.tag);
    if (old && same(old, r)) kept.push(r);
    else if (await schedulePush(r.tag, r.at, r.title, r.body)) kept.push(r);
  }
  await setMeta(metaKey, kept);
}

let queue: Promise<void> = Promise.resolve();

/**
 * Schedules a push `reminderMin` minutes before each of today's and tomorrow's commitments
 * that start in the future (remind = true), tag `commit:${id}:${date}`, and cancels the tags
 * that are no longer valid. Runs one at a time; silently does nothing without a token/offline.
 */
export function syncCommitmentReminders(
  commitments: Commitment[], today: DayKey, reminderMin: number, now: number, dayStartHour = 4,
): Promise<void> {
  return enqueue(() => syncScheduled(META_KEY, desiredReminders(commitments, today, reminderMin, now, dayStartHour), now));
}

/** Every reminder sync runs one at a time, so two quick changes never reach the server out of order. */
function enqueue(task: () => Promise<void>): Promise<void> {
  const run = queue.then(task).catch(() => undefined);
  queue = run;
  return run;
}

/** Layout effect: keeps reminders in sync with commitments, settings, the day and the sync token. */
export function useCommitmentReminders(): void {
  // undefined while loading, so the first render never "cancels everything".
  const commitments = useLiveQuery(() => db.commitments.toArray());
  const settings = useSettings();
  const today = useToday();
  const reminderMin = settings?.commitmentReminderMin;
  const dayStartHour = settings?.dayStartHour ?? 4;
  const [tokenTick, setTokenTick] = useState(0);

  useEffect(() => {
    const onToken = () => setTokenTick((n) => n + 1);
    window.addEventListener(TOKEN_EVENT, onToken);
    return () => window.removeEventListener(TOKEN_EVENT, onToken);
  }, []);

  useEffect(() => {
    if (!commitments || reminderMin === undefined || !today) return;
    void syncCommitmentReminders(commitments, today, reminderMin, Date.now(), dayStartHour);
  }, [commitments, reminderMin, today, tokenTick, dayStartHour]);
}

// ------------------------------------------------------------------ wind-down (Marco 4)

const WIND_DOWN_META = 'scheduledWindDown';
export const WIND_DOWN_BODY = 'Hora de desacelerar: comer, banho e algo tranquilo antes de dormir.';

/**
 * Wind-down pushes that should exist now: today's and tomorrow's, Monday to Friday (the class
 * nights), at `windDownAt` (earlier than `dayStartHour` = the next calendar morning), still ahead,
 * and not for a night whose "Deitei" is already logged. Tag `winddown:${day}`.
 */
export function desiredWindDown(
  sleep: SleepSettings, today: DayKey, now: number, logs: readonly SleepLog[], dayStartHour = 4,
): ScheduledReminder[] {
  if (!sleep.windDownReminder) return [];
  const out: ScheduledReminder[] = [];
  for (const day of [today, addDays(today, 1)]) {
    const wd = weekdayOf(day);
    if (wd === 0 || wd === 6) continue;
    const at = logicalTimestamp(day, sleep.windDownAt, dayStartHour);
    if (at <= now) continue;
    const night = sleepNightOf(at);
    if (logs.some((l) => !l.deleted && l.night === night && l.bedAt !== undefined)) continue;
    out.push({ tag: `winddown:${day}`, at, title: TITLE, body: WIND_DOWN_BODY });
  }
  return out;
}

export function syncWindDownReminders(
  sleep: SleepSettings, today: DayKey, now: number, logs: readonly SleepLog[], dayStartHour = 4,
): Promise<void> {
  return enqueue(() => syncScheduled(WIND_DOWN_META, desiredWindDown(sleep, today, now, logs, dayStartHour), now));
}

/** Layout effect: keeps the wind-down push in sync with the setting, the day, the nights and the token. */
export function useWindDownReminders(): void {
  const logs = useLiveQuery(() => db.sleepLogs.toArray());
  const settings = useSettings();
  const today = useToday();
  const [tokenTick, setTokenTick] = useState(0);
  const sleep = settings ? sleepSettingsOf(settings) : undefined;
  const on = sleep?.windDownReminder;
  const time = sleep?.windDownAt;
  const dayStartHour = settings?.dayStartHour ?? 4;

  useEffect(() => {
    const onToken = () => setTokenTick((n) => n + 1);
    window.addEventListener(TOKEN_EVENT, onToken);
    return () => window.removeEventListener(TOKEN_EVENT, onToken);
  }, []);

  useEffect(() => {
    if (!logs || on === undefined || time === undefined || !today) return;
    const s = sleepSettingsOf({ sleep: { windDownReminder: on, windDownAt: time } });
    void syncWindDownReminders(s, today, Date.now(), logs, dayStartHour);
  }, [logs, on, time, today, tokenTick, dayStartHour]);
}
