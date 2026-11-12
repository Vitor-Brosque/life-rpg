import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Area, Commitment, Journey } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { applyRoutine, defaultRoutine } from '../src/domain/actions';

const TODAY = '2026-11-11';
const base = { createdAt: 1, updatedAt: 1, deleted: false };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

async function ctx(over: Partial<Parameters<typeof defaultRoutine>[1]> = {}) {
  return {
    journeys: [] as Journey[], areas: await db.areas.toArray(), commitments: [] as Commitment[],
    dayEndHour: 23, today: TODAY, ...over,
  };
}
const aula: Commitment = {
  ...base, id: 'aula', title: 'Aula', date: '2026-11-02', start: '19:30', end: '22:30',
  weekdays: [1, 2, 3, 4, 5], remind: true,
};

describe('defaultRoutine', () => {
  it('builds the 7 blocks of the suggested routine for a start at 08:00', async () => {
    const p = defaultRoutine('08:00', await ctx());
    expect(p.blocks.map((b) => [b.name, b.targetStart, b.durationMin, b.minimumMin, b.kind, b.protected])).toEqual([
      ['Início do dia', '08:00', 30, 15, 'routine', false],
      ['Bloco 1 · Tech News', '08:30', 120, 40, 'focus', false],
      ['Treino', '11:00', 60, 30, 'body', false],
      ['Bloco 2 · Faculdade', '14:00', 90, 30, 'study', true],
      ['Bloco 3 · Estudo técnico', '16:00', 60, 25, 'study', false],
      ['Complementos', '17:30', 30, 10, 'light', false],
      ['Desaceleração', '22:45', 30, 15, 'routine', false],
    ]);
    for (const [i, b] of p.blocks.entries()) {
      expect(b).toMatchObject({ weekdays: [1, 2, 3, 4, 5], order: i, archived: false });
    }
    const [inicio, tech, treino, facul, tecnico, compl, desac] = p.blocks;
    expect(inicio!.checklist.map((c) => c.text)).toEqual(['Beber água', 'Café da manhã', 'Separar o material']);
    expect(desac!.checklist.map((c) => c.text)).toEqual(['Jantar leve', 'Arrumar a mochila', 'Leitura tranquila']);
    expect(new Set([...inicio!.checklist, ...desac!.checklist].map((c) => c.id)).size).toBe(6);
    expect(tech!.checklist).toEqual([]);
    expect(tech!.journeyId).toBe(p.createJourney!.id);
    expect(p.createJourney!.title).toBe('Tech News');
    expect(treino!.areaId).toBe('area-vigor');
    expect(facul!.areaId).toBe('area-facul');
    expect(tecnico!.areaId).toBe('area-intelecto');
    expect(compl!.areaId).toBeUndefined();
    expect(compl!.journeyId).toBeUndefined();
    expect(p.createArea).toMatchObject({ id: 'area-facul', name: 'Faculdade', attribute: 'Sabedoria', icon: 'book' });
    expect(p.createArea!.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(p.createCommitment).toEqual({ title: 'Aula', start: '19:30', end: '22:30', weekdays: [1, 2, 3, 4, 5] });
    expect(p.dayEndHour).toBe(0);
    expect(p.warnings).toEqual([]);
  });

  it('reuses an existing journey, area and commitment (case/accent-insensitive)', async () => {
    const journey: Journey = { ...base, id: 'j-tech', title: '  téch NEWS ', status: 'active', order: 0 };
    const facul: Area = { ...base, id: 'a-fac', name: 'faculdade', attribute: 'Saber', color: '#000000', icon: 'book', order: 9, archived: false };
    const p = defaultRoutine('08:00', await ctx({
      journeys: [journey], areas: [...(await db.areas.toArray()), facul], commitments: [aula], dayEndHour: 0,
    }));
    expect(p.createJourney).toBeUndefined();
    expect(p.createArea).toBeUndefined();
    expect(p.createCommitment).toBeUndefined();
    expect(p.dayEndHour).toBeUndefined();
    expect(p.blocks[1]!.journeyId).toBe('j-tech');
    expect(p.blocks[3]!.areaId).toBe('a-fac');
  });

  it('reuses a journey whose compacted title starts with "tech" (TechNews, Tech-news pipeline)', async () => {
    for (const title of ['TechNews', 'Tech-news pipeline', 'tech']) {
      const journey: Journey = { ...base, id: 'j-x', title, status: 'active', order: 0 };
      const p = defaultRoutine('08:00', await ctx({ journeys: [journey] }));
      expect(p.createJourney, title).toBeUndefined();
      expect(p.blocks[1]!.journeyId, title).toBe('j-x');
    }
    const other: Journey = { ...base, id: 'j-y', title: 'Mudança', status: 'active', order: 0 };
    expect(defaultRoutine('08:00', await ctx({ journeys: [other] })).createJourney).toBeDefined();
  });

  it('any weekly commitment overlapping the class window on a weekday counts as class time', async () => {
    const weekly = (p: Partial<Commitment>): Commitment => ({ ...aula, id: 'c', title: 'Faculdade', ...p });
    const noAula = async (c: Commitment) => (defaultRoutine('08:00', await ctx({ commitments: [c] }))).createCommitment;
    expect(await noAula(weekly({ start: '19:30', end: '22:30', weekdays: [1, 2, 3, 4] }))).toBeUndefined();
    expect(await noAula(weekly({ start: '20:00', end: '21:00', weekdays: [2] }))).toBeUndefined();
    expect(await noAula(weekly({ start: '18:00', end: '20:00', weekdays: [1, 3] }))).toBeUndefined();
    // Not class time: weekend only, outside the evening, expired, or a one-off event.
    expect(await noAula(weekly({ weekdays: [6] }))).toBeDefined();
    expect(await noAula(weekly({ start: '14:00', end: '18:00', weekdays: [1, 2, 3, 4, 5] }))).toBeDefined();
    expect(await noAula(weekly({ untilDate: '2026-11-01' }))).toBeDefined();
    expect(await noAula(weekly({ weekdays: undefined, date: '2026-11-12', start: '19:30', end: '21:00' }))).toBeDefined();
    // applyRoutine re-checks the database the same way.
    await db.commitments.put(weekly({ start: '19:30', end: '22:30', weekdays: [1, 2, 3, 4] }));
    await applyRoutine(defaultRoutine('08:00', await ctx()));
    expect(await db.commitments.count()).toBe(1);
  });

  it('ignores a finished journey and a deleted commitment', async () => {
    const done: Journey = { ...base, id: 'j-old', title: 'Tech News', status: 'done', order: 0 };
    const p = defaultRoutine('08:00', await ctx({ journeys: [done], commitments: [{ ...aula, deleted: true }] }));
    expect(p.createJourney).toBeDefined();
    expect(p.createJourney!.id).not.toBe('j-old');
    expect(p.createCommitment).toBeDefined();
  });

  it('shifts only blocks that start before the class and warns about it', async () => {
    const p = defaultRoutine('11:00', await ctx());
    const at = (name: string) => p.blocks.find((b) => b.name === name)!.targetStart;
    expect(at('Início do dia')).toBe('11:00');
    expect(at('Bloco 1 · Tech News')).toBe('11:30');
    expect(at('Treino')).toBe('14:00');
    expect(at('Complementos')).toBe('20:30');
    expect(at('Desaceleração')).toBe('22:45');
    expect(p.warnings).toContain('Complementos não cabe antes da aula — encurte ou mova');
    expect(p.warnings).toContain('Bloco 3 · Estudo técnico não cabe antes da aula — encurte ou mova');
    expect(p.warnings.some((w) => w.startsWith('Treino'))).toBe(false);
  });

  it('shifts earlier starts too', async () => {
    const p = defaultRoutine('07:00', await ctx());
    expect(p.blocks.map((b) => b.targetStart)).toEqual(['07:00', '07:30', '10:00', '13:00', '15:00', '16:30', '22:45']);
    expect(p.warnings).toEqual([]);
  });

  it('keeps a day end that already reaches past the last block', async () => {
    expect(defaultRoutine('08:00', await ctx({ dayEndHour: 2 })).dayEndHour).toBeUndefined();
    expect(defaultRoutine('08:00', await ctx({ dayEndHour: 22 })).dayEndHour).toBe(0);
    // An end hour equal to the start hour is the next morning, past every block.
    expect(defaultRoutine('08:00', await ctx({ dayEndHour: 4, dayStartHour: 4 })).dayEndHour).toBeUndefined();
  });
});

describe('applyRoutine', () => {
  it('creates journey, area, commitment and blocks, and moves the day end to midnight', async () => {
    const p = defaultRoutine('08:00', await ctx());
    await applyRoutine(p);
    const blocks = (await db.blocks.toArray()).sort((a, b) => a.order - b.order);
    expect(blocks).toHaveLength(7);
    expect(blocks.every((b) => !b.deleted && b.createdAt > 1)).toBe(true);
    const journey = await db.journeys.get(p.createJourney!.id);
    expect(journey).toMatchObject({ title: 'Tech News', status: 'active', deleted: false });
    expect(blocks[1]!.journeyId).toBe(journey!.id);
    expect(await db.areas.get('area-facul')).toMatchObject({
      name: 'Faculdade', attribute: 'Sabedoria', icon: 'book', archived: false, deleted: false,
    });
    const commitments = await db.commitments.toArray();
    expect(commitments).toHaveLength(1);
    expect(commitments[0]).toMatchObject({ title: 'Aula', start: '19:30', end: '22:30', weekdays: [1, 2, 3, 4, 5], date: TODAY });
    expect((await db.settings.get('settings'))!.dayEndHour).toBe(0);
    expect(await db.outbox.where('key').startsWith('blocks:').count()).toBe(7);
  });

  it('does not duplicate anything when applied again', async () => {
    const first = defaultRoutine('08:00', await ctx());
    await applyRoutine(first);
    await applyRoutine(first); // double tap with the same preview
    const again = defaultRoutine('08:00', await ctx({
      journeys: await db.journeys.toArray(), areas: await db.areas.toArray(),
      commitments: await db.commitments.toArray(), dayEndHour: 0,
    }));
    expect(again.createJourney).toBeUndefined();
    expect(again.createArea).toBeUndefined();
    expect(again.createCommitment).toBeUndefined();
    await applyRoutine(again);
    expect(await db.blocks.count()).toBe(7);
    expect(await db.journeys.count()).toBe(1);
    expect(await db.commitments.count()).toBe(1);
    expect((await db.areas.toArray()).filter((a) => a.name === 'Faculdade')).toHaveLength(1);
  });

  it('links to an existing "TechNews" journey instead of creating another', async () => {
    const p = defaultRoutine('08:00', await ctx());
    await db.journeys.put({ ...base, id: 'j-compact', title: 'TechNews', status: 'active', order: 0 });
    await applyRoutine(p);
    expect(await db.journeys.count()).toBe(1);
    expect((await db.blocks.toArray()).find((b) => b.name === 'Bloco 1 · Tech News')!.journeyId).toBe('j-compact');
  });

  it('links to a Tech News journey created after the preview instead of making a second one', async () => {
    const p = defaultRoutine('08:00', await ctx());
    await db.journeys.put({ ...base, id: 'j-late', title: 'Tech news', status: 'active', order: 0 });
    await applyRoutine(p);
    expect(await db.journeys.count()).toBe(1);
    expect((await db.blocks.toArray()).find((b) => b.name === 'Bloco 1 · Tech News')!.journeyId).toBe('j-late');
  });
});
