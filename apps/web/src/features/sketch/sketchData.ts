import { useLiveQuery } from 'dexie-react-hooks';
import type { Mission, Sketch } from '@life/shared';
import { normalize, sketchTitle } from '@life/shared';
import { db } from '../../db/db';
import { plural, relativeTime } from '../../ui/format';

// Lists of lousas (spec §6.1). They read whole records: fine up to hundreds of lousas.

/** Listed: live, and either standalone or a mission/practice lousa that has strokes (an empty one stays reachable from its owner). */
export const isListed = (s: Sketch): boolean =>
  !s.deleted && ((!s.missionId && !s.practiceId) || (Array.isArray(s.strokes) && s.strokes.length > 0));

/** The `limit` most recently edited listed lousas; undefined while loading. */
export function useRecentSketches(limit: number): Sketch[] | undefined {
  return useLiveQuery(() => db.sketches.orderBy('updatedAt').reverse().filter(isListed).limit(limit).toArray(), [limit]);
}

/** Every listed lousa, most recently edited first; undefined while loading. */
export function useAllSketches(): Sketch[] | undefined {
  return useLiveQuery(() => db.sketches.orderBy('updatedAt').reverse().filter(isListed).toArray());
}

/** The name shown for `s`, with the live mission's title for a mission lousa. */
export function nameOf(s: Sketch, missions: readonly Mission[]): string {
  return sketchTitle(s, s.missionId ? missions.find((m) => m.id === s.missionId)?.title : undefined);
}

/** "Missão · 12 traços · há 3 h" / "vazia · agora". */
export function sketchMeta(s: Sketch, now: number): string {
  const n = Array.isArray(s.strokes) ? s.strokes.length : 0;
  return [s.missionId ? 'Missão' : s.practiceId ? 'Prática' : undefined, n === 0 ? 'vazia' : plural(n, 'traço', 'traços'), relativeTime(s.updatedAt, now)]
    .filter(Boolean).join(' · ');
}

export const matchesSketch = (name: string, query: string): boolean => {
  const key = normalize(query.trim());
  return !key || normalize(name).includes(key);
};

/** `?voltar=` only when it is an internal path ("/…" but not "//…"); else the list. */
export function safeBack(v: string | null): string {
  return v && v.startsWith('/') && !v.startsWith('//') ? v : '/estudo/lousas';
}
