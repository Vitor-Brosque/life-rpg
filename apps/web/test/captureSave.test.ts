import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mission } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { saveCapture } from '../src/features/capture/captureSave';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

describe('saveCapture com recorrência', () => {
  it('"Missão" em uma linha com horário e "todo dia 5" mantém o mensal', async () => {
    const [m] = (await saveCapture('contador 10h todo dia 5', { today: '2026-11-11', asMission: true })) as Mission[];
    expect(m!.recurrence).toEqual({ kind: 'monthly', day: 5 });
    expect(m!.date).toBe('2026-12-05');
  });

  it('"Missão" com "todo dia" e horário vira missão diária', async () => {
    const [m] = (await saveCapture('remédio 8h todo dia', { today: '2026-11-11', asMission: true })) as Mission[];
    expect(m!.recurrence).toEqual({ kind: 'daily' });
  });
});
