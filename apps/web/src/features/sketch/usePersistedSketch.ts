import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Sketch, Stroke } from '@life/shared';
import { normalizeStrokes } from '@life/shared';
import { db } from '../../db/db';
import { saveSketchStrokes } from '../../domain/sketchActions';
import { FAILURE_TOAST } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';

export interface PersistedSketch {
  status: 'loading' | 'missing' | 'ready';
  sketch?: Sketch;
  /** Key for the SketchPad: it changes when a newer version from elsewhere replaces the strokes. */
  padKey: number;
  initial: Stroke[];
  onChange(strokes: Stroke[]): void;
  onGestureChange(active: boolean): void;
}

/**
 * Binds a SketchPad to the stored lousa `id` (spec §6.2): every change is written at once, and a
 * newer version written elsewhere (another device through sync) is adopted while this screen is
 * idle: no own write in flight, no gesture going on. Last writer wins otherwise.
 */
export function usePersistedSketch(id: string): PersistedSketch {
  // Tagged with the id: right after `id` changes, useLiveQuery still holds the previous result.
  const record = useLiveQuery(async () => ({ id, sketch: (await db.sketches.get(id)) ?? null }), [id]);
  const [shown, setShown] = useState<{ padKey: number; initial: Stroke[] } | null>(null);
  /** updatedAt of the version the pad shows: loaded, adopted or written here. */
  const known = useRef(0);
  const pending = useRef(0);
  const gesture = useRef(false);
  const sketch = record && record.id === id ? record.sketch ?? undefined : undefined;
  const live = !!sketch && !sketch.deleted;

  useEffect(() => {
    if (!sketch || sketch.deleted) return;
    if (shown === null) {
      known.current = sketch.updatedAt;
      setShown({ padKey: 0, initial: normalizeStrokes(sketch.strokes) });
    } else if (sketch.updatedAt > known.current && pending.current === 0 && !gesture.current) {
      known.current = sketch.updatedAt;
      setShown({ padKey: shown.padKey + 1, initial: normalizeStrokes(sketch.strokes) });
    }
  }, [sketch, shown]);

  const onChange = useCallback((strokes: Stroke[]): void => {
    pending.current += 1;
    saveSketchStrokes(id, strokes)
      .then((saved) => { known.current = Math.max(known.current, saved.updatedAt); })
      .catch((e: unknown) => {
        console.error('save sketch failed', e);
        useToast.getState().show(FAILURE_TOAST);
      })
      .finally(() => { pending.current -= 1; });
  }, [id]);
  const onGestureChange = useCallback((active: boolean): void => { gesture.current = active; }, []);

  const loading = record === undefined || record.id !== id;
  const status = loading ? 'loading' : !live ? 'missing' : shown === null ? 'loading' : 'ready';
  return {
    status, sketch: live ? sketch : undefined, padKey: shown?.padKey ?? 0, initial: shown?.initial ?? [], onChange, onGestureChange,
  };
}
