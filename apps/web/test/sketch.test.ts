import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stroke } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import {
  createSketch, deleteSketch, ensureMissionSketch, renameSketch, restoreSketch, saveSketchStrokes,
} from '../src/domain/sketchActions';
import { rateCard, saveDeck, saveNote } from '../src/domain/studyActions';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 12, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

const dot: Stroke = { c: 0, w: 0, p: [5, 5] };

describe('sketch actions', () => {
  it('createSketch trims the title, starts empty and queues the record for sync', async () => {
    const s = await createSketch({ title: '  Lista 3 de Cálculo  ' });
    expect(s).toMatchObject({ title: 'Lista 3 de Cálculo', strokes: [], deleted: false });
    expect(s.missionId).toBeUndefined();
    expect(await db.outbox.get(`sketches:${s.id}`)).toBeDefined();
    expect((await createSketch({ title: 'x'.repeat(100) })).title).toHaveLength(80);
  });

  it('ensureMissionSketch makes one record per mission and leaves a live one untouched', async () => {
    const a = await ensureMissionSketch('m1');
    expect(a).toMatchObject({ id: 'sketch-m-m1', missionId: 'm1', title: '', strokes: [] });
    await saveSketchStrokes(a.id, [dot]);
    const before = (await db.sketches.get(a.id))!;
    vi.setSystemTime(new Date(2026, 10, 12, 11, 0));
    const again = await ensureMissionSketch('m1');
    expect(again.updatedAt).toBe(before.updatedAt);
    expect(again.strokes).toEqual([dot]);
    expect(await db.sketches.count()).toBe(1);
  });

  it('a deleted mission lousa comes back empty', async () => {
    const a = await ensureMissionSketch('m1');
    await saveSketchStrokes(a.id, [dot]);
    await deleteSketch(a.id);
    expect(await ensureMissionSketch('m1')).toMatchObject({ id: 'sketch-m-m1', deleted: false, strokes: [] });
  });

  it('save, rename, delete and restore', async () => {
    const s = await createSketch();
    await saveSketchStrokes(s.id, [dot]);
    await renameSketch(s.id, '  Derivadas ');
    expect(await db.sketches.get(s.id)).toMatchObject({ strokes: [dot], title: 'Derivadas' });
    await deleteSketch(s.id);
    expect((await db.sketches.get(s.id))!.deleted).toBe(true);
    await restoreSketch(s.id);
    expect(await db.sketches.get(s.id)).toMatchObject({ deleted: false, strokes: [dot], title: 'Derivadas' });
  });
});

describe('rateCard drew', () => {
  it('saves drew: true only when there was a drawing', async () => {
    const d = await saveDeck({ name: 'Cálculo' });
    await saveNote({ deckId: d.id, type: 'basic', front: 'a', back: 'b' });
    await saveNote({ deckId: d.id, type: 'basic', front: 'c', back: 'd' });
    const [c1, c2] = (await db.cards.toArray()).filter((c) => !c.deleted);
    await rateCard(c1!.id, 3, { durationMs: 5000, wrote: false, drew: true });
    await rateCard(c2!.id, 3, { durationMs: 5000, wrote: false });
    const reviews = await db.reviews.toArray();
    expect(reviews.find((r) => r.cardId === c1!.id)).toMatchObject({ drew: true });
    expect(reviews.find((r) => r.cardId === c2!.id)).not.toHaveProperty('drew');
  });
});
