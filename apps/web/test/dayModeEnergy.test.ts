import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnergyLevel } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { setDayMode } from '../src/domain/blockActions';
import { setEnergy } from '../src/domain/otherActions';

const logs = async () => (await db.energyLogs.orderBy('at').toArray()).filter((l) => !l.deleted);
const levels = async (): Promise<EnergyLevel[]> => (await logs()).map((l) => l.level);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

describe('day type sets the day energy', () => {
  it('low energy writes low', async () => {
    await setDayMode('low');
    expect(await levels()).toEqual(['low']);
  });

  it('maps each mode', async () => {
    const expected: Record<string, EnergyLevel> = { normal: 'medium', low: 'low', recovery: 'low', free: 'medium' };
    for (const [mode, level] of Object.entries(expected)) {
      await db.energyLogs.clear();
      await setDayMode(mode as 'normal');
      expect(await levels()).toEqual([level]);
    }
  });

  it('choosing the same type twice does not duplicate', async () => {
    await setDayMode('low');
    vi.setSystemTime(new Date(2026, 10, 11, 10, 5));
    await setDayMode('low');
    expect(await levels()).toEqual(['low']);
  });

  it('dois toques seguidos no mesmo tipo escrevem uma só energia', async () => {
    await Promise.all([setDayMode('low'), setDayMode('low'), setDayMode('low')]);
    expect(await levels()).toEqual(['low']);
  });

  it('changing to normal writes medium', async () => {
    await setDayMode('low');
    vi.setSystemTime(new Date(2026, 10, 11, 10, 5));
    await setDayMode('normal');
    expect(await levels()).toEqual(['low', 'medium']);
  });

  it('a manual adjustment afterwards stays', async () => {
    await setDayMode('normal');
    vi.setSystemTime(new Date(2026, 10, 11, 10, 5));
    await setEnergy('high');
    expect(await levels()).toEqual(['medium', 'high']);
  });

  it('choosing a day type after a manual adjustment replaces it', async () => {
    await setDayMode('normal');
    vi.setSystemTime(new Date(2026, 10, 11, 10, 5));
    await setEnergy('high');
    vi.setSystemTime(new Date(2026, 10, 11, 10, 6));
    await setDayMode('normal');
    expect(await levels()).toEqual(['medium', 'high', 'medium']);
  });

  it('yesterday\'s log (before the day start) does not count as today\'s', async () => {
    vi.setSystemTime(new Date(2026, 10, 11, 2, 0)); // logical day is still the 10th
    await setDayMode('normal');
    vi.setSystemTime(new Date(2026, 10, 11, 5, 0)); // new logical day
    await setDayMode('normal');
    expect(await levels()).toEqual(['medium', 'medium']);
  });
});
