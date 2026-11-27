import type { DayKey, ID, Strategy, StrategyDraft, StrategySource } from '@life/shared';
import {
  STRATEGY_ISSUE_TEXT, STRATEGY_NOTE_MAX, postponedReview, quickStrategy, strategyChanges, strategyFields, strategyIssue, strategyKey,
  strategyTrashed, strategyVisible,
} from '@life/shared';
import { db } from '../db/db';
import { mutate, newRecord, put } from '../db/repo';
import { getToday, withLock } from './common';

// Estratégias: every write. Nothing here gives XP. A strategy exists only because Vitor created it (the sheet, a tap
// in Padrões, a line of the Nova semana adjustment); nothing comes from an AI. "Apagar" moves it to "Apagadas
// recentemente" (trashedAt); "Apagar de vez" empties it and marks it deleted, so the sync carries only the marker.

const LOCK = 'strategies';

/** A save refused by the rules of the sheet (the message is the issue's text). */
export class StrategyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrategyError';
  }
}

async function check(draft: StrategyDraft): Promise<DayKey> {
  const today = await getToday();
  const issue = strategyIssue(draft, today);
  if (issue) throw new StrategyError(STRATEGY_ISSUE_TEXT[issue]);
  return today;
}

/** "Começar a testar": a new testing strategy from the sheet's draft (in its stored form). */
export const createStrategy = (draft: StrategyDraft): Promise<Strategy> => withLock(LOCK, async () => {
  await check(draft);
  return put('strategies', newRecord<Strategy>(strategyFields({ ...draft, status: 'testando', decisionNote: '' })));
});

/**
 * One tap (Padrões, a line of the Nova semana adjustment): a testing strategy from today, decided in two weeks —
 * unless a visible strategy with the same title is being tested (then that one, unchanged). Undefined for a blank text.
 */
export const testStrategy = (text: string, source: StrategySource): Promise<Strategy | undefined> => withLock(LOCK, async () => {
  const fields = quickStrategy(text, source, await getToday());
  if (!fields) return undefined;
  const key = strategyKey(fields.title);
  const same = (await db.strategies.toArray())
    .find((s) => strategyVisible(s) && s.status === 'testando' && strategyKey(s.title) === key);
  return same ?? put('strategies', newRecord<Strategy>(fields));
});

/**
 * "Salvar": only the fields that differ from `initial` (the sheet's values when it opened), on the stored record, so a
 * newer value of a field he did not touch is kept. Resolves false when nothing changed or the strategy is gone.
 */
export const updateStrategy = (
  id: ID, initial: StrategyDraft, draft: StrategyDraft, options: { keepStatus?: boolean } = {},
): Promise<boolean> => withLock(LOCK, async () => {
  const today = await check(draft);
  // "Decidir depois" saves his words without deciding: the status stays, and a typed decision note waits for the decision.
  const effective = options.keepStatus ? { ...draft, status: initial.status } : draft;
  const changes = strategyChanges(initial, effective, today);
  if (options.keepStatus && effective.status === 'testando') {
    const note = draft.decisionNote.trim().slice(0, STRATEGY_NOTE_MAX).trim();
    if (note !== initial.decisionNote.trim().slice(0, STRATEGY_NOTE_MAX).trim()) Object.assign(changes, { decisionNote: note || undefined });
  }
  const stored = await db.strategies.get(id);
  if (Object.keys(changes).length === 0 || !stored || stored.deleted) return false;
  await mutate<Strategy>('strategies', id, (prev) => (prev.deleted ? undefined : changes));
  return true;
});

/** "Decidir depois": a testing strategy's decision a week later. Resolves with the new day (undefined when not testing). */
export const postponeStrategy = (id: ID): Promise<DayKey | undefined> => withLock(LOCK, async () => {
  const s = await db.strategies.get(id);
  if (!s || !strategyVisible(s) || s.status !== 'testando') return undefined;
  const reviewDay = postponedReview(s, await getToday());
  await mutate<Strategy>('strategies', id, () => ({ reviewDay }));
  return reviewDay;
});

/** "Apagar": to "Apagadas recentemente" (out of the list, the lines and the reports). */
export const trashStrategy = (id: ID): Promise<void> => withLock(LOCK, async () => {
  const s = await db.strategies.get(id);
  if (s && strategyVisible(s)) await mutate<Strategy>('strategies', id, () => ({ trashedAt: Date.now() }));
});

/** "Restaurar": back as it was. */
export const restoreStrategy = (id: ID): Promise<void> => withLock(LOCK, async () => {
  const s = await db.strategies.get(id);
  if (s && strategyTrashed(s)) await mutate<Strategy>('strategies', id, () => ({ trashedAt: undefined }));
});

const EMPTIED: Partial<Strategy> = {
  deleted: true, title: '', sourceNote: undefined, why: undefined, observe: undefined, link: undefined, decisionNote: undefined,
};

/** "Apagar de vez": texts and link go, the record is marked deleted. Nothing for a missing or deleted strategy. */
export const purgeStrategy = (id: ID): Promise<void> => withLock(LOCK, async () => {
  const s = await db.strategies.get(id);
  if (s && !s.deleted) await mutate<Strategy>('strategies', id, () => EMPTIED);
});
