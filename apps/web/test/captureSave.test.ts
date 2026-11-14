import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Journey, Mission } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { newRecord, put } from '../src/db/repo';
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

describe('saveCapture de avaliações', () => {
  const subject = (subj: boolean) => put('journeys', newRecord<Journey>({
    id: 'j-calc', title: 'Cálculo II', status: 'active', order: 0, areaId: 'area-facul', ...(subj ? { subject: true } : {}),
  }));

  it('"prova #calculo dia 3/12" vira "Prova de Cálculo II"', async () => {
    await subject(true);
    const [m] = (await saveCapture('prova #calculo dia 3/12', { today: '2026-11-14' })) as Mission[];
    expect(m).toMatchObject({ title: 'Prova de Cálculo II', assessment: 'prova', date: '2026-12-03', deadline: '2026-12-03', areaId: 'area-facul', journeyId: 'j-calc' });
  });

  it('sem data é missão comum', async () => {
    await subject(true);
    const [m] = (await saveCapture('prova #calculo', { today: '2026-11-14' })) as Mission[];
    expect(m!.title).toBe('prova');
    expect(m!.assessment).toBeUndefined();
  });

  it('"estudar para prova" é missão comum', async () => {
    await subject(true);
    const [m] = (await saveCapture('estudar para prova #calculo dia 3/12', { today: '2026-11-14' })) as Mission[];
    expect(m!.assessment).toBeUndefined();
    expect(m!.deadline).toBeUndefined();
  });

  it('jornada que não é disciplina: missão comum', async () => {
    await subject(false);
    const [m] = (await saveCapture('prova #calculo dia 3/12', { today: '2026-11-14' })) as Mission[];
    expect(m!.assessment).toBeUndefined();
    expect(m!.title).toBe('prova');
  });
});
