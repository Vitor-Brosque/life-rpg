import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timestampAt } from '@life/shared';
import { db } from '../src/db/db';
import { readPatternData } from '../src/features/patterns/patternData';
import { planFromData, readDayPlanData } from '../src/db/dayPlan';
import { ensureSeed } from '../src/db/seed';
import { saveBlock, setDayMode, skipBlock, startBlock } from '../src/domain/blockActions';
import { retroBlock } from '../src/domain/dayCloseActions';
import { at, seedBlocks } from './blockFixture';

const DAY = '2026-11-11';
const plans = async () => (await db.dayPlans.toArray()).filter((p) => !p.deleted);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 10, 0));
  await db.delete();
  await db.open();
  await ensureSeed();
  await seedBlocks();
});
afterEach(() => { vi.useRealTimers(); });

describe('the day plan snapshot', () => {
  it('setDayMode takes it once and again when the day type changes', async () => {
    await setDayMode('normal');
    const first = (await db.dayPlans.get(DAY))!;
    expect(first.mode).toBe('normal');
    expect(first.blocks).toHaveLength(5);
    expect(first.commitments.map((c) => c.title)).toEqual(['Aula']);
    vi.setSystemTime(at(11, 10, 5));
    await setDayMode('normal');
    expect((await db.dayPlans.get(DAY))!.updatedAt).toBe(first.updatedAt);
    await setDayMode('low');
    expect((await db.dayPlans.get(DAY))!.mode).toBe('low');
  });

  it('starting a block without a chosen type takes a normal plan, and editing the routine leaves it alone', async () => {
    await startBlock('b1');
    expect((await db.dayPlans.get(DAY))!.mode).toBe('normal');
    await saveBlock({ id: 'b1', durationMin: 60 });
    const plan = (await db.dayPlans.get(DAY))!;
    expect(plan.blocks.find((b) => b.blockId === 'b1')!.durationMin).toBe(180);
  });

  it('skipping a block and registering one later also take it', async () => {
    await skipBlock('b2');
    expect(await plans()).toHaveLength(1);
    await db.dayPlans.clear();
    await db.blockSessions.clear();
    await retroBlock('b4', '09:00', '09:30');
    expect(await plans()).toHaveLength(1);
  });

  it('reading the plan and the pattern data never creates one', async () => {
    const data = await readDayPlanData(DAY);
    planFromData(data!, Date.now());
    await readPatternData(DAY, (await db.settings.get('settings'))!);
    expect(await plans()).toHaveLength(0);
  });

  it('on a Saturday, starting a block records a normal day', async () => {
    vi.setSystemTime(at(14, 10, 0));
    await startBlock('b1');
    expect((await db.dayPlans.get('2026-11-14'))!.mode).toBe('normal');
    expect(timestampAt('2026-11-14', '00:00')).toBeGreaterThan(0);
  });
});
