import type { MonthAnswers, MonthObserved, MonthReview, Settings, Week, WeekAtypical } from '@life/shared';
import { isValidDayKey, monthReviewId, patternSettingsOf, weekKey } from '@life/shared';
import { db } from '../db/db';
import { newRecord, patch, put, upsert } from '../db/repo';
import { getToday, withLock } from './common';

/** The experiment of the current week (the Agora shows it); blank text does nothing. */
export async function setWeekExperiment(text: string): Promise<void> {
  const experiment = text.trim();
  if (!experiment) return;
  const weekId = weekKey(await getToday());
  await withLock(`week:${weekId}`, () => upsert<Week>('weeks', weekId, { experiment }, { objectives: [] }));
}

export const ATYPICAL_REASON_MAX = 60;

/**
 * Marks week `weekId` (its Monday) as atypical (exams, travel...: kept out of the Padrões
 * comparisons), or with `undefined` removes the mark. Creates the week record when it is missing.
 */
export async function setWeekAtypical(weekId: string, value: WeekAtypical | undefined): Promise<void> {
  const atypical = value && {
    reason: value.reason.trim().slice(0, ATYPICAL_REASON_MAX).trim() || 'Outro',
    ...(value.returnDay && isValidDayKey(value.returnDay) ? { returnDay: value.returnDay } : {}),
  };
  await withLock(`week:${weekId}`, () => upsert<Week>('weeks', weekId, { atypical }, { objectives: [] }));
}

export const WATCH_DISMISSED_MAX = 50;

/** "Está tudo bem assim": that beginning's weeks 5–8 notice never comes back (synced in settings). */
export async function dismissWatch(key: string): Promise<void> {
  await withLock('settings:patterns', async () => {
    const s = await db.settings.get('settings');
    if (!s) return;
    const list = patternSettingsOf(s).watchDismissed.filter((k) => k !== key);
    await patch<Settings>('settings', 'settings', {
      patterns: { watchDismissed: [...list, key].slice(-WATCH_DISMISSED_MAX) },
    });
  });
}

const clean = (a: MonthAnswers): MonthAnswers => ({ progress: a.progress.trim(), obstacle: a.obstacle.trim(), next: a.next.trim() });

/**
 * Saves the month's answers. A new record keeps a copy of the numbers on screen; an existing one
 * (answered or skipped) only gets the answers, so its copy and first date stay.
 */
export async function saveMonthReview(month: string, answers: MonthAnswers, observed: MonthObserved): Promise<void> {
  const id = monthReviewId(month);
  await withLock(`month:${month}`, async () => {
    const prev = await db.monthReviews.get(id);
    if (prev && !prev.deleted) {
      await patch<MonthReview>('monthReviews', id, { answers: clean(answers), skipped: undefined });
      return;
    }
    await put('monthReviews', newRecord<MonthReview>({ id, month, answers: clean(answers), observed, answeredAt: Date.now() }));
  });
}

/** "Pular este mês": a record without answers, so the card does not come back. Never over a live record. */
export async function skipMonthReview(month: string, observed: MonthObserved): Promise<void> {
  const id = monthReviewId(month);
  await withLock(`month:${month}`, async () => {
    const prev = await db.monthReviews.get(id);
    if (prev && !prev.deleted) return;
    await put('monthReviews', newRecord<MonthReview>({ id, month, skipped: true, observed, answeredAt: Date.now() }));
  });
}
