import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block, BlockSession, MonthObserved, Settings, Week, XpEvent } from '@life/shared';
import { timestampAt } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, patch } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { saveWeekReview } from '../src/domain/actions';
import {
  WATCH_DISMISSED_MAX, dismissWatch, saveMonthReview, setWeekExperiment, skipMonthReview,
} from '../src/domain/patternActions';
import { buildPatternsView, readPatternData, usePatternData } from '../src/features/patterns/patternData';
import { useWeekCycle } from '../src/features/week/weekCycle';

const TODAY = '2026-11-13';
const base = { createdAt: 1, updatedAt: 1, deleted: false };
const block: Block = {
  ...base, id: 'b1', name: 'Tech', weekdays: [1, 2, 3, 4, 5], order: 0, targetStart: '09:00', durationMin: 120,
  minimumMin: 30, kind: 'focus', protected: false, checklist: [], archived: false,
};
const session = (day: string): BlockSession => ({
  ...base, id: `bs-b1-${day}`, blockId: 'b1', day, version: 'normal',
  startedAt: timestampAt(day, '09:00'), endedAt: timestampAt(day, '10:00'),
});
const xp = (dayKey: string, p: Partial<XpEvent> = {}): XpEvent => newRecord<XpEvent>({
  at: timestampAt(dayKey, '10:00'), amount: 5, reason: 'block', dayKey, ...p,
});
const OBSERVED: MonthObserved = {
  workdays: 22, activeWorkdays: 2, blocksPlanned: 22, blocksStarted: 3, minimumUsed: 1, resumptions: 0,
  reviews: 28, accuracy: 0.8, practiceClosed: 1, workouts: 1, escapes: 1,
};
const settings = async () => (await db.settings.get('settings'))!;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

describe('readPatternData and buildPatternsView', () => {
  it('reads the window without deleted records and builds the view', async () => {
    await db.blocks.bulkPut([block, { ...block, id: 'old', name: 'Velho', archived: true }]);
    await db.blockSessions.bulkPut([session('2026-10-26'), session('2026-11-02'), session('2026-11-03'), session('2025-09-01')]);
    await db.xpEvents.bulkPut([xp('2026-10-26'), xp('2026-11-02', { areaId: 'area-x' }), { ...xp('2026-11-03'), deleted: true }]);
    await db.weeks.bulkPut([
      { ...base, id: '2026-10-26', objectives: [], experiment: 'Começar pelo primeiro passo' } satisfies Week,
      { ...base, id: '2026-11-02', objectives: [], experiment: '  ' } satisfies Week,
    ]);
    await patch<Settings>('settings', 'settings', { dayEndHour: 0, patterns: { watchDismissed: ['k1'] } });

    const data = await readPatternData(TODAY, await settings());
    expect(data.blocks.map((b) => b.id).sort()).toEqual(['b1', 'old']);
    expect(data.sessions.map((s) => s.day)).not.toContain('2025-09-01');
    expect(data.xpEvents).toHaveLength(2);
    expect(data.watchDismissed).toEqual(['k1']);
    expect([data.dayStartHour, data.dayEndHour]).toEqual([4, 0]);

    const v = buildPatternsView(data, 'week');
    expect(v.hasData).toBe(true);
    expect(v.points.map((p) => [p.period.key, p.blocksStarted, p.blocksPlanned])).toEqual([['2026-10-26', 1, 5], ['2026-11-02', 2, 5]]);
    expect(v.balance.map((b) => [b.name, b.xp])).toEqual([['Outra área', 5], ['Sem área', 5]]);
    expect(v.pastExperiments).toEqual([
      { week: '2026-10-26', label: '26/10', experiment: 'Começar pelo primeiro passo', started: 1, planned: 5 },
    ]);
    expect(v.sleepBlocks).toEqual({ pairs: 0, enough: false, reason: 'poucos' });
    expect(buildPatternsView(data, 'month').points.map((p) => p.period.key)).toEqual(['2026-10']);
  });

  it('no XP at all: nothing to show', async () => {
    const v = buildPatternsView(await readPatternData(TODAY, await settings()), 'week');
    expect(v.hasData).toBe(false);
    expect(v.points).toEqual([]);
  });

  it('usePatternData(false) reads nothing', async () => {
    const off = renderHook(() => usePatternData(false));
    const on = renderHook(() => usePatternData());
    await waitFor(() => expect(on.result.current?.today).toBe(TODAY));
    expect(off.result.current).toBeUndefined();
  });
});

describe('planned × executed in the view', () => {
  it('reads plans, focus sessions and journeys, and counts only days with a plan', async () => {
    await db.blocks.put(block);
    await db.blockSessions.bulkPut([session('2026-11-02'), session('2026-11-03')]);
    await db.xpEvents.put(xp('2026-10-26'));
    await db.dayPlans.bulkPut([
      { ...base, id: '2026-11-03', day: '2026-11-03', mode: 'normal', takenAt: 1, commitments: [], blocks: [{
        blockId: 'b1', name: 'Tech', kind: 'focus', targetStart: '09:00', durationMin: 120, minimumMin: 30,
        protected: false, order: 0, createdAt: 1,
      }] },
      { ...base, id: '2026-11-04', day: '2026-11-04', mode: 'normal', takenAt: 1, commitments: [], blocks: [], deleted: true },
    ]);
    await db.focusSessions.put({ ...base, id: 'f1', startedAt: timestampAt('2026-11-03', '14:00'), endedAt: timestampAt('2026-11-03', '14:30'),
      activeMs: 30 * 60_000, mode: 'free', outcome: 'finished' } as never);
    const data = await readPatternData(TODAY, await settings());
    expect(data.dayPlans).toHaveLength(1);
    expect(data.focusSessions).toHaveLength(1);
    expect(data.journeys!.length).toBeGreaterThanOrEqual(0);
    const v = buildPatternsView(data, 'week');
    expect(v.planVsDone.map((p) => [p.period.key, p.daysWithPlan])).toEqual([['2026-10-26', 0], ['2026-11-02', 1]]);
  });
});

describe('week experiment', () => {
  const WEEK = '2026-11-09';
  it('setWeekExperiment creates the week, replaces the text and ignores blanks', async () => {
    await setWeekExperiment('  Começar pelo primeiro passo ');
    expect(await db.weeks.get(WEEK)).toMatchObject({ objectives: [], experiment: 'Começar pelo primeiro passo' });
    await setWeekExperiment('   ');
    expect((await db.weeks.get(WEEK))!.experiment).toBe('Começar pelo primeiro passo');
    await setWeekExperiment('Celular em outro cômodo');
    expect((await db.weeks.get(WEEK))!.experiment).toBe('Celular em outro cômodo');
  });
  it('the weekly review keeps the chosen experiment when its adjustment is empty', async () => {
    await setWeekExperiment('Versão mínima do Bloco 1');
    await saveWeekReview(WEEK, { worked: '', obstacle: '', adjustment: '  ' });
    expect((await db.weeks.get(WEEK))!.experiment).toBe('Versão mínima do Bloco 1');
    await saveWeekReview(WEEK, { worked: '', obstacle: '', adjustment: 'Outro ajuste' });
    expect((await db.weeks.get(WEEK))!.experiment).toBe('Outro ajuste');
  });
  it('a week that only has an experiment still gets the "Nova semana" card', async () => {
    vi.setSystemTime(new Date(2026, 10, 9, 10, 0));   // Monday
    await setWeekExperiment('Versão mínima do Bloco 1');
    const { result } = renderHook(() => useWeekCycle(WEEK, { asked: true, mode: 'normal' }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.showCard).toBe(true);
  });
});

describe('dismissWatch', () => {
  it('adds once and keeps the newest 50', async () => {
    await dismissWatch('block:tech:2026-09-28');
    await dismissWatch('block:tech:2026-09-28');
    expect((await settings()).patterns).toEqual({ watchDismissed: ['block:tech:2026-09-28'] });
    for (let i = 0; i < WATCH_DISMISSED_MAX; i++) await dismissWatch(`k${i}`);
    const list = (await settings()).patterns!.watchDismissed;
    expect(list).toHaveLength(50);
    expect(list[0]).toBe('k0');
    expect(list[49]).toBe('k49');
  });
});

describe('month reflection', () => {
  const answers = { progress: ' Fiz 3 sessões ', obstacle: 'Sono', next: 'Deitar 23h30' };
  it('saveMonthReview creates the record with the observed copy; editing keeps the copy', async () => {
    await saveMonthReview('2026-10', answers, OBSERVED);
    const first = (await db.monthReviews.get('month-2026-10'))!;
    expect(first).toMatchObject({
      month: '2026-10', observed: OBSERVED, answeredAt: Date.now(),
      answers: { progress: 'Fiz 3 sessões', obstacle: 'Sono', next: 'Deitar 23h30' },
    });
    expect(await db.outbox.get('monthReviews:month-2026-10')).toBeDefined();
    vi.setSystemTime(new Date(2026, 10, 14, 10, 0));
    await saveMonthReview('2026-10', { ...answers, next: 'Deitar 23h' }, { ...OBSERVED, workdays: 1 });
    const edited = (await db.monthReviews.get('month-2026-10'))!;
    expect(edited.observed).toEqual(OBSERVED);
    expect(edited.answeredAt).toBe(first.answeredAt);
    expect(edited.answers!.next).toBe('Deitar 23h');
  });
  it('skipping writes a record without answers, never over an answered one; answering later clears it', async () => {
    await skipMonthReview('2026-09', OBSERVED);
    expect(await db.monthReviews.get('month-2026-09')).toMatchObject({ skipped: true, observed: OBSERVED });
    expect((await db.monthReviews.get('month-2026-09'))!.answers).toBeUndefined();
    await saveMonthReview('2026-09', answers, OBSERVED);
    expect((await db.monthReviews.get('month-2026-09'))!.skipped).toBeUndefined();
    await skipMonthReview('2026-09', OBSERVED);
    expect((await db.monthReviews.get('month-2026-09'))!.answers).toBeDefined();
  });
});
