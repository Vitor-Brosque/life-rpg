import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoalDraft, Journey } from '@life/shared';
import { goalDraftOf, newGoalDraft } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { GoalError, createGoal, setJourneyGoal, updateGoal } from '../src/domain/goalActions';
import { at } from './blockFixture';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(23, 10));   // Monday 23/11
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

const draft = (title: string, p: Partial<GoalDraft> = {}): GoalDraft => ({ ...newGoalDraft(), title, ...p });
const five = async (): Promise<void> => {
  for (const t of ['A', 'B', 'C', 'D', 'E']) await createGoal(draft(t));
};

describe('goal actions', () => {
  it('createGoal: an active goal in its stored form, in creation order, queued for sync; a blank title is refused', async () => {
    const r = await createGoal(draft(' Carreira  em Dados ', { why: ' Gosto de dados ', horizon: '2027' }));
    expect(r).toMatchObject({ saved: true, keptPaused: false });
    expect(r.goal).toMatchObject({ title: 'Carreira em Dados', why: 'Gosto de dados', horizon: '2027', status: 'ativo', order: 0 });
    expect((await createGoal(draft('Saúde'))).goal.order).toBe(1);
    expect(await db.outbox.get(`goals:${r.goal.id}`)).toBeDefined();
    await expect(createGoal(draft('  '))).rejects.toBeInstanceOf(GoalError);
    expect(await db.goals.count()).toBe(2);
  });

  it('a sixth active goal pauses the chosen one, or starts paused; never refused', async () => {
    await five();
    const a = (await db.goals.toArray()).find((g) => g.title === 'A')!;
    const r1 = await createGoal(draft('F'), a.id);
    expect(r1).toMatchObject({ paused: 'A', keptPaused: false, goal: { status: 'ativo' } });
    expect((await db.goals.get(a.id))!.status).toBe('pausado');
    const r2 = await createGoal(draft('G'));
    expect(r2).toMatchObject({ keptPaused: true, goal: { status: 'pausado' } });
    expect(r2.paused).toBeUndefined();
    expect((await db.goals.toArray()).filter((g) => g.status === 'ativo')).toHaveLength(5);
  });

  it('updateGoal writes only what changed, keeping a newer value of another field', async () => {
    const { goal } = await createGoal(draft('Carreira', { why: 'Dados' }));
    const initial = goalDraftOf(goal);
    await put('goals', { ...(await db.goals.get(goal.id))!, horizon: '2027' });   // another device, meanwhile
    expect(await updateGoal(goal.id, initial, { ...initial, why: 'Pipelines' })).toEqual({ saved: true, keptPaused: false });
    expect(await db.goals.get(goal.id)).toMatchObject({ why: 'Pipelines', horizon: '2027' });
    expect(await updateGoal(goal.id, initial, { ...initial })).toEqual({ saved: false, keptPaused: false });
  });

  it('activating a paused goal beyond the limit keeps it paused, or pauses the chosen one', async () => {
    await five();
    const { goal } = await createGoal(draft('Inglês', { status: 'pausado' }));
    const initial = goalDraftOf(goal);
    expect(await updateGoal(goal.id, initial, { ...initial, status: 'ativo' })).toEqual({ saved: false, keptPaused: true });
    expect((await db.goals.get(goal.id))!.status).toBe('pausado');
    const b = (await db.goals.toArray()).find((g) => g.title === 'B')!;
    expect(await updateGoal(goal.id, initial, { ...initial, status: 'ativo' }, b.id)).toEqual({ saved: true, paused: 'B', keptPaused: false });
    expect((await db.goals.get(goal.id))!.status).toBe('ativo');
    expect((await db.goals.get(b.id))!.status).toBe('pausado');
  });

  it('setJourneyGoal links and unlinks a journey', async () => {
    const { goal } = await createGoal(draft('Carreira'));
    const j = await put('journeys', newRecord<Journey>({ title: 'Tech News', status: 'active', order: 0 }));
    await setJourneyGoal(j.id, goal.id);
    expect((await db.journeys.get(j.id))!.goalId).toBe(goal.id);
    await setJourneyGoal(j.id, undefined);
    expect((await db.journeys.get(j.id))!.goalId).toBeUndefined();
  });
});
