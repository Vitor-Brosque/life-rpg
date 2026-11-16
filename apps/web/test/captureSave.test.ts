import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Journey, Mission } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { newRecord, put } from '../src/db/repo';
import { saveCapture, saveCaptureRequests } from '../src/features/capture/captureSave';

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

describe('saveCaptureRequests', () => {
  const live = async () => (await db.missions.toArray()).filter((m) => !m.deleted);

  it('grava na ordem, com createdAt e ids crescentes, e cria a jornada nova uma vez', async () => {
    const out = await saveCaptureRequests([
      { type: 'mission', fields: { title: 'um', important: false }, newJourneyName: 'Leituras' },
      { type: 'mission', fields: { title: 'dois', important: false }, newJourneyName: 'Leituras' },
      { type: 'mission', fields: { title: 'três', important: false, durationMin: 30 }, newJourneyName: 'leituras' },
    ]);
    const journeys = (await db.journeys.toArray()).filter((j) => !j.deleted && j.title.toLowerCase() === 'leituras');
    expect(journeys).toHaveLength(1);
    const ms = (await live()).sort((a, b) => a.createdAt - b.createdAt);
    expect(ms.map((m) => m.title)).toEqual(['um', 'dois', 'três']);
    expect(ms.every((m) => m.journeyId === journeys[0]!.id)).toBe(true);
    expect(ms[2]!.durationMin).toBe(30);
    expect(ms[0]!.createdAt).toBeLessThan(ms[1]!.createdAt);
    expect(ms[1]!.createdAt).toBeLessThan(ms[2]!.createdAt);
    expect([...ms].sort((a, b) => a.id.localeCompare(b.id)).map((m) => m.title)).toEqual(['um', 'dois', 'três']);
    expect(out.map((r) => r.id)).toEqual(ms.map((m) => m.id));
  });

  it('uma jornada que já existe com o nome é reaproveitada', async () => {
    await put('journeys', newRecord<Journey>({ id: 'j-tech', title: 'Tech News', status: 'active', order: 0 }));
    await saveCaptureRequests([{ type: 'mission', fields: { title: 'ler', important: false }, newJourneyName: 'tech news' }]);
    expect((await db.journeys.toArray()).filter((j) => !j.deleted)).toHaveLength(1);
    expect((await live())[0]!.journeyId).toBe('j-tech');
  });

  it('compromisso, prova e rascunho de card usam as ações que já existem', async () => {
    await put('journeys', newRecord<Journey>({
      id: 'j-calc', title: 'Cálculo II', status: 'active', order: 0, areaId: 'area-facul', subject: true,
    }));
    const [c, a, n] = await saveCaptureRequests([
      { type: 'commitment', fields: { title: 'dentista', date: '2026-11-12', start: '15:00', remind: true } },
      { type: 'assessment', input: { kind: 'prova', journeyId: 'j-calc', date: '2026-12-03', content: 'integrais' } },
      { type: 'card', front: 'o que é idempotência' },
    ]);
    expect(c).toMatchObject({ title: 'dentista', date: '2026-11-12', start: '15:00', end: '16:00', remind: true });
    expect(a).toMatchObject({
      title: 'Prova de Cálculo II', assessment: 'prova', date: '2026-12-03', deadline: '2026-12-03', notes: 'integrais',
      journeyId: 'j-calc', areaId: 'area-facul',
    });
    expect(n).toMatchObject({ type: 'basic', front: 'o que é idempotência', back: '', draft: true });
    expect((n as { deckId?: string }).deckId).toBeUndefined();
  });

  it('uma prova de disciplina que não existe mais falha com a mensagem da validação', async () => {
    await expect(saveCaptureRequests([
      { type: 'assessment', input: { kind: 'prova', journeyId: 'j-nada', date: '2026-12-03' } },
    ])).rejects.toThrow('Escolha a disciplina.');
  });
});
