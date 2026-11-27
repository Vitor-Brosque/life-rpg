import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newSeasonDraft, seasonDraftOf } from '@life/shared';
import { db } from '../src/db/db';
import { put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { SeasonError, endSeason, startSeason, updateSeason } from '../src/domain/seasonActions';
import { at } from './blockFixture';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(23, 10));   // Monday 23/11
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

const draft = (title: string, startDay = '2026-11-23') => ({ ...newSeasonDraft(startDay), title });

describe('season actions', () => {
  it('startSeason: an active season in its stored form; a second active one and a blank name are refused', async () => {
    const s = await startSeason({ ...draft(' Consistência '), focus: [{ text: ' Tech ' }, { text: '' }] });
    expect(s).toMatchObject({ title: 'Consistência', focus: [{ text: 'Tech' }], startDay: '2026-11-23', plannedWeeks: 6, status: 'ativa' });
    expect(await db.outbox.get(`seasons:${s.id}`)).toBeDefined();
    await expect(startSeason(draft('Outra'))).rejects.toThrow('Já há uma temporada em andamento.');
    await expect(startSeason(draft(''))).rejects.toBeInstanceOf(SeasonError);
    expect(await db.seasons.count()).toBe(1);
  });

  it('updateSeason writes only what changed, keeping a newer value of another field', async () => {
    const s = await startSeason(draft('Consistência'));
    const initial = seasonDraftOf(s);
    await put('seasons', { ...(await db.seasons.get(s.id))!, title: 'Consistência no Tech' });   // another device
    expect(await updateSeason(s.id, initial, { ...initial, plannedWeeks: 8 })).toBe(true);
    expect(await db.seasons.get(s.id)).toMatchObject({ title: 'Consistência no Tech', plannedWeeks: 8 });
    expect(await updateSeason(s.id, initial, initial)).toBe(false);
  });

  it('endSeason: ended today with his answers, once; blank answers store no review', async () => {
    const s = await startSeason(draft('Consistência', '2026-11-02'));
    expect(await endSeason(s.id, { progress: ' Todo dia ', obstacle: '', next: '' })).toBe(true);
    expect(await db.seasons.get(s.id)).toMatchObject({
      status: 'encerrada', endedDay: '2026-11-23', review: { progress: 'Todo dia', obstacle: '', next: '', answeredAt: Date.now() },
    });
    expect(await endSeason(s.id, { progress: 'outra', obstacle: '', next: '' })).toBe(false);
    const t = await startSeason(draft('Próxima'));
    expect(await endSeason(t.id, { progress: ' ', obstacle: '', next: '' })).toBe(true);
    expect((await db.seasons.get(t.id))!.review).toBeUndefined();
  });
});
