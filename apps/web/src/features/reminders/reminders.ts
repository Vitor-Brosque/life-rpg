import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Commitment, DayKey } from '@life/shared';
import { addDays, occurrencesOn } from '@life/shared';
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

/** Reminders that should exist now: today's and tomorrow's occurrences still ahead. */
export function desiredReminders(
  commitments: Commitment[], today: DayKey, reminderMin: number, now: number,
): ScheduledReminder[] {
  if (reminderMin <= 0) return [];
  const out: ScheduledReminder[] = [];
  for (const day of [today, addDays(today, 1)]) {
    for (const o of occurrencesOn(commitments, day)) {
      const c = o.commitment;
      if (!c.remind) continue;
      const at = o.startTs - reminderMin * MIN;
      if (at <= now) continue;
      out.push({ tag: `commit:${c.id}:${day}`, at, title: TITLE, body: `${c.title} começa às ${c.start}` });
    }
  }
  return out;
}

const same = (a: ScheduledReminder, b: ScheduledReminder) =>
  a.at === b.at && a.title === b.title && a.body === b.body;

async function sync(commitments: Commitment[], today: DayKey, reminderMin: number, now: number): Promise<void> {
  const desired = desiredReminders(commitments, today, reminderMin, now);
  const wanted = new Map(desired.map((r) => [r.tag, r]));
  const prev = (await getMeta<ScheduledReminder[]>(META_KEY)) ?? [];
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
  await setMeta(META_KEY, kept);
}

let queue: Promise<void> = Promise.resolve();

/**
 * Schedules a push `reminderMin` minutes before each of today's and tomorrow's commitments
 * that start in the future (remind = true), tag `commit:${id}:${date}`, and cancels the tags
 * that are no longer valid. Runs one at a time; silently does nothing without a token/offline.
 */
export function syncCommitmentReminders(
  commitments: Commitment[], today: DayKey, reminderMin: number, now: number,
): Promise<void> {
  const run = queue.then(() => sync(commitments, today, reminderMin, now)).catch(() => undefined);
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
  const [tokenTick, setTokenTick] = useState(0);

  useEffect(() => {
    const onToken = () => setTokenTick((n) => n + 1);
    window.addEventListener(TOKEN_EVENT, onToken);
    return () => window.removeEventListener(TOKEN_EVENT, onToken);
  }, []);

  useEffect(() => {
    if (!commitments || reminderMin === undefined || !today) return;
    void syncCommitmentReminders(commitments, today, reminderMin, Date.now());
  }, [commitments, reminderMin, today, tokenTick]);
}
