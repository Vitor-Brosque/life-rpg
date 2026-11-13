import type { ID, Sketch, Stroke } from '@life/shared';
import { SKETCH_TITLE_MAX, missionSketchId } from '@life/shared';
import { db } from '../db/db';
import { newRecord, patch, put, softDelete } from '../db/repo';

// Lousas (Marco 3b, spec §6). No XP anywhere here: drawing is not rewarded (spec §8).

const cleanTitle = (title: string): string => title.trim().slice(0, SKETCH_TITLE_MAX);

/** A new standalone lousa. An empty title is fine: lists show an automatic name (sketchTitle). */
export async function createSketch(input: { title?: string; strokes?: Stroke[] } = {}): Promise<Sketch> {
  return put('sketches', newRecord<Sketch>({ title: cleanTitle(input.title ?? ''), strokes: input.strokes ?? [] }));
}

/**
 * The mission's lousa (deterministic id), created, or revived empty, when missing. A live one is
 * returned untouched: no write, so opening it never bumps updatedAt nor queues a sync.
 */
export async function ensureMissionSketch(missionId: ID): Promise<Sketch> {
  const id = missionSketchId(missionId);
  const prev = await db.sketches.get(id);
  if (prev && !prev.deleted) return prev;
  return put('sketches', newRecord<Sketch>({ id, title: '', missionId, strokes: [] }));
}

export const saveSketchStrokes = (id: ID, strokes: Stroke[]): Promise<Sketch> =>
  patch<Sketch>('sketches', id, { strokes });

export const renameSketch = (id: ID, title: string): Promise<Sketch> =>
  patch<Sketch>('sketches', id, { title: cleanTitle(title) });

export const deleteSketch = (id: ID): Promise<void> => softDelete('sketches', id);

export const restoreSketch = (id: ID): Promise<Sketch> => patch<Sketch>('sketches', id, { deleted: false });
