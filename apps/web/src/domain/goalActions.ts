import type { Goal, GoalDraft, ID, Journey } from '@life/shared';
import { GOAL_ISSUE_TEXT, goalChanges, goalFields, goalIssue, goalSave, nextGoalOrder } from '@life/shared';
import { db } from '../db/db';
import { mutate, newRecord, put } from '../db/repo';
import { withLock } from './common';

// Objetivos: every write. Nothing here gives XP or notifies. The app never deletes a goal: it is put away by archiving.

const LOCK = 'goals';

/** A save refused by the rules of the sheet (the message is the issue's text). */
export class GoalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoalError';
  }
}

export interface GoalSaved {
  /** False when nothing changed or the goal is gone. */
  saved: boolean;
  /** The title of the active goal paused to make room. */
  paused?: string;
  /** He chose Ativo with five others active and paused none: the goal is, or stays, paused. */
  keptPaused: boolean;
}

/** Pauses `id` when it is still an active goal; resolves with its title. */
async function pauseOther(id: ID | undefined): Promise<string | undefined> {
  const g = id !== undefined ? await db.goals.get(id) : undefined;
  if (!g || g.deleted || g.status !== 'ativo') return undefined;
  await mutate<Goal>('goals', g.id, () => ({ status: 'pausado' }));
  return g.title;
}

/** "Criar objetivo": a new goal after every other one; Ativo beyond the limit pauses `pauseId` or starts paused. */
export const createGoal = (draft: GoalDraft, pauseId?: ID): Promise<GoalSaved & { goal: Goal }> => withLock(LOCK, async () => {
  if (goalIssue(draft)) throw new GoalError(GOAL_ISSUE_TEXT.title);
  const list = await db.goals.toArray();
  const plan = goalSave(list, draft.status, { pauseId });
  const paused = await pauseOther(plan.pause);
  const goal = await put('goals', newRecord<Goal>({ ...goalFields({ ...draft, status: plan.status }), order: nextGoalOrder(list) }));
  return { goal, saved: true, ...(paused ? { paused } : {}), keptPaused: draft.status === 'ativo' && plan.status === 'pausado' };
});

/**
 * "Salvar": only the fields that differ from `initial` (the sheet when it opened), on the stored record, so a newer value
 * of a field he did not touch is kept. Ativo for a goal that was not active, with five others active, pauses `pauseId`
 * or keeps the goal paused.
 */
export const updateGoal = (id: ID, initial: GoalDraft, draft: GoalDraft, pauseId?: ID): Promise<GoalSaved> => withLock(LOCK, async () => {
  if (goalIssue(draft)) throw new GoalError(GOAL_ISSUE_TEXT.title);
  const stored = await db.goals.get(id);
  if (!stored || stored.deleted) return { saved: false, keptPaused: false };
  const changes = goalChanges(initial, draft);
  let paused: string | undefined;
  let keptPaused = false;
  if (changes.status === 'ativo') {
    const plan = goalSave(await db.goals.toArray(), 'ativo', { id, wasActive: stored.status === 'ativo', pauseId });
    paused = await pauseOther(plan.pause);
    if (plan.status === 'pausado') {
      keptPaused = true;
      if (stored.status === 'pausado') delete changes.status;
      else changes.status = 'pausado';
    }
  }
  if (Object.keys(changes).length === 0) return { saved: false, ...(paused ? { paused } : {}), keptPaused };
  await mutate<Goal>('goals', id, (prev) => (prev.deleted ? undefined : changes));
  return { saved: true, ...(paused ? { paused } : {}), keptPaused };
});

/** The journey's "Objetivo", one tap (undefined = Sem objetivo): only `goalId` is written, on the stored record. */
export const setJourneyGoal = (journeyId: ID, goalId: ID | undefined): Promise<unknown> =>
  mutate<Journey>('journeys', journeyId, (prev) => (prev.goalId === goalId ? undefined : { goalId }));
