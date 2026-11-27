import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Strategy } from '@life/shared';
import { newStrategyDraft, strategyDraftOf } from '@life/shared';
import { db } from '../src/db/db';
import { patch } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import {
  StrategyError, createStrategy, postponeStrategy, purgeStrategy, restoreStrategy, testStrategy, trashStrategy, updateStrategy,
} from '../src/domain/strategyActions';
import { at } from './blockFixture';

const TODAY = '2026-11-23';
const TECH_MIN = 'Nesta semana, a meta de Tech é só a versão mínima (40 min).';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(23, 10));   // Monday 23/11
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

describe('strategy actions', () => {
  it('createStrategy: a testing strategy in its stored form, queued for sync; a draft with an issue is refused', async () => {
    const s = await createStrategy(newStrategyDraft(TODAY, { title: ' Celular  longe ', source: 'ia', sourceNote: 'Claude', why: 'Menos escapes' }));
    expect(await db.strategies.get(s.id)).toMatchObject({
      title: 'Celular longe', source: 'ia', sourceNote: 'Claude', why: 'Menos escapes', startDay: TODAY, reviewDay: '2026-12-07',
      status: 'testando', deleted: false,
    });
    expect(await db.outbox.get(`strategies:${s.id}`)).toBeDefined();
    await expect(createStrategy(newStrategyDraft(TODAY))).rejects.toThrow(new StrategyError('Escreva o que vai testar.'));
    await expect(createStrategy(newStrategyDraft(TODAY, { title: 'x', startDay: '2026-11-24' }))).rejects.toThrow('Escolha um dia de início até hoje.');
    expect(await db.strategies.count()).toBe(1);
  });

  it('testStrategy: one tap from today; the same title already in test is reused; blank does nothing; a trashed one is not reused', async () => {
    const a = await testStrategy(TECH_MIN, 'padroes');
    expect(a).toMatchObject({ title: TECH_MIN, source: 'padroes', startDay: TODAY, reviewDay: '2026-12-07', status: 'testando' });
    const b = await testStrategy('nesta semana, a meta de tech e so a versao minima (40 min).', 'ideia');
    expect(b!.id).toBe(a!.id);
    expect(await db.strategies.count()).toBe(1);
    expect(await testStrategy('   ', 'ideia')).toBeUndefined();
    await trashStrategy(a!.id);
    const c = await testStrategy(TECH_MIN, 'padroes');
    expect(c!.id).not.toBe(a!.id);
  });

  it('updateStrategy writes only what changed, keeping a newer value of another field; no change writes nothing', async () => {
    const s = await createStrategy(newStrategyDraft(TODAY, { title: 'Celular longe', why: 'Menos escapes' }));
    const initial = strategyDraftOf(s);
    await patch<Strategy>('strategies', s.id, { observe: 'Escapes' });   // another device, while the sheet is open
    expect(await updateStrategy(s.id, initial, { ...initial, status: 'mantida', decisionNote: 'Deu certo' })).toBe(true);
    expect(await db.strategies.get(s.id)).toMatchObject({
      why: 'Menos escapes', observe: 'Escapes', status: 'mantida', decidedDay: TODAY, decisionNote: 'Deu certo',
    });
    const stamp = (await db.strategies.get(s.id))!.updatedAt;
    expect(await updateStrategy(s.id, initial, initial)).toBe(false);
    expect((await db.strategies.get(s.id))!.updatedAt).toBe(stamp);
    await expect(updateStrategy(s.id, initial, { ...initial, title: ' ' })).rejects.toThrow('Escreva o que vai testar.');
  });

  it('postponeStrategy: a week after today when due; nothing for a decided strategy', async () => {
    const s = await createStrategy(newStrategyDraft('2026-11-01', { title: 'Biblioteca' }));   // decide on 15/11: due
    expect(await postponeStrategy(s.id)).toBe('2026-11-30');
    expect((await db.strategies.get(s.id))!.reviewDay).toBe('2026-11-30');
    await patch<Strategy>('strategies', s.id, { status: 'descartada', decidedDay: TODAY });
    expect(await postponeStrategy(s.id)).toBeUndefined();
  });

  it('Apagar → Restaurar → Apagar de vez (texts emptied, deleted); nothing twice', async () => {
    const s = await createStrategy(newStrategyDraft(TODAY, { title: 'Celular longe', why: 'x', observe: 'y', link: { kind: 'block', id: 'b1' } }));
    await trashStrategy(s.id);
    expect((await db.strategies.get(s.id))!.trashedAt).toBe(at(23, 10));
    await restoreStrategy(s.id);
    expect((await db.strategies.get(s.id))!.trashedAt).toBeUndefined();
    await trashStrategy(s.id);
    await purgeStrategy(s.id);
    const gone = (await db.strategies.get(s.id))!;
    expect(gone).toMatchObject({ deleted: true, title: '' });
    expect([gone.why, gone.observe, gone.link, gone.decisionNote, gone.sourceNote]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    const stamp = gone.updatedAt;
    await purgeStrategy(s.id);
    await restoreStrategy(s.id);
    expect((await db.strategies.get(s.id))!.updatedAt).toBe(stamp);
  });
});
