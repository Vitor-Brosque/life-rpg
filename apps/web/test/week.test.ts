import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { useWeek } from '../src/db/hooks';
import { saveWeekReview, setObjectives, toggleObjective } from '../src/domain/actions';

const WEEK = '2026-11-09';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
  await db.blocks.put({
    id: 'b3', createdAt: 1, updatedAt: 1, deleted: false, name: 'Facul', weekdays: [1, 2, 3, 4, 5], order: 0,
    targetStart: '15:00', durationMin: 90, minimumMin: 30, kind: 'study', protected: true, checklist: [],
    archived: false, areaId: 'area-facul',
  });
});
afterEach(() => { vi.useRealTimers(); });

const liveXp = async () => (await db.xpEvents.toArray()).filter((x) => !x.deleted);

describe('weeks', () => {
  it('setObjectives keeps given ids, creates new ones and drops blank texts', async () => {
    await setObjectives(WEEK, [
      { id: 'o-keep', blockId: 'b3', text: 'Lista 4', done: false },
      { blockId: 'b3', text: '  Resumo cap. 2 ', done: false },
      { blockId: 'b3', text: '   ', done: false },
    ]);
    const w = await db.weeks.get(WEEK);
    expect(w!.objectives).toHaveLength(2);
    expect(w!.objectives[0]).toEqual({ id: 'o-keep', blockId: 'b3', text: 'Lista 4', done: false });
    expect(w!.objectives[1]).toMatchObject({ blockId: 'b3', text: 'Resumo cap. 2', done: false });
    expect(w!.objectives[1]!.id).toBeTruthy();
    expect(await db.outbox.get(`weeks:${WEEK}`)).toBeDefined();
  });

  it('toggleObjective on/off/on leaves one live XP event', async () => {
    await setObjectives(WEEK, [{ id: 'o1', blockId: 'b3', text: 'Lista 4', done: false }]);
    expect(await toggleObjective(WEEK, 'o1')).toEqual({ xp: 10 });
    expect((await db.weeks.get(WEEK))!.objectives[0]!.done).toBe(true);
    expect(await toggleObjective(WEEK, 'o1')).toEqual({ xp: 0 });
    expect((await db.weeks.get(WEEK))!.objectives[0]!.done).toBe(false);
    expect(await liveXp()).toHaveLength(0);
    expect(await toggleObjective(WEEK, 'o1')).toEqual({ xp: 10 });
    const xp = await liveXp();
    expect(xp).toHaveLength(1);
    expect(xp[0]).toMatchObject({ id: 'xp-objective-o1', amount: 10, reason: 'objective', dayKey: '2026-11-11', areaId: 'area-facul' });
    expect(await db.xpEvents.count()).toBe(1);
    expect(await toggleObjective(WEEK, 'missing')).toEqual({ xp: 0 });
  });

  it('saveWeekReview stores the review and the experiment, creating the week when needed', async () => {
    await saveWeekReview(WEEK, { worked: 'começar cedo', obstacle: 'celular', adjustment: ' celular em outro cômodo ' });
    const w = await db.weeks.get(WEEK);
    expect(w).toMatchObject({
      objectives: [],
      review: { worked: 'começar cedo', obstacle: 'celular', adjustment: ' celular em outro cômodo ', answeredAt: Date.now() },
      experiment: 'celular em outro cômodo',
    });
    await setObjectives(WEEK, [{ blockId: 'b3', text: 'Lista 5', done: false }]);
    expect((await db.weeks.get(WEEK))!.experiment).toBe('celular em outro cômodo');
  });

  it('useWeek reads the current week by default', async () => {
    await setObjectives(WEEK, [{ id: 'o1', blockId: 'b3', text: 'Lista 4', done: false }]);
    const { result } = renderHook(() => useWeek());
    await waitFor(() => expect(result.current?.id).toBe(WEEK));
    expect(result.current!.objectives).toHaveLength(1);
    const other = renderHook(() => useWeek('2026-11-02'));
    await waitFor(() => expect(other.result.current).toBeUndefined());
  });
});
