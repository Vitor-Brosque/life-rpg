import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Area, ID, WorldNews, XpEvent } from '@life/shared';
import { activeNews, normalizeSeen, worldProgress, worldSnapshot } from '@life/shared';
import { db } from '../../db/db';
import { useNow } from '../../db/hooks';
import { getMeta, setMeta } from '../../db/repo';
import { useCompanion } from '../companion/store';
import { celebrationText } from './worldText';

// Territory stage-ups and outfit unlocks (spec §7). Mounted once in App: it watches areas and XP,
// whatever screen earned the XP, and lets the companion celebrate. Memory is per device (meta 'world'),
// so only XP this device wrote (still in its outbox) is celebrated: XP that arrives by sync was
// already celebrated on the device that earned it, and here it only updates the memory.

export const WORLD_META_KEY = 'world';
/** After the action's own feedback (toast, companion phrase), so the celebration is not overwritten. */
export const CELEBRATE_DELAY_MS = 1500;
export const CELEBRATE_SHOW_MS = 8000;
/** Outbox keys are `${table}:${id}`. */
const OUTBOX_XP = 'xpEvents:';

let chain: Promise<unknown> = Promise.resolve();

/**
 * Compares the world with what this device already showed, stores it and returns what to celebrate.
 * Serialized. `earnedHere`: ids of the XP written on this device (all of it when omitted).
 */
export function checkWorld(
  areas: readonly Area[], xp: readonly XpEvent[], now = Date.now(), earnedHere?: ReadonlySet<ID>,
): Promise<WorldNews[]> {
  const run = chain.then(async () => {
    // A missing, empty or unrecognised memory is a first run (silent baseline), never "everything is new".
    const stored = normalizeSeen(await getMeta<unknown>(WORLD_META_KEY));
    const prev = stored && Object.keys(stored.stages).length > 0 ? stored : undefined;
    const r = worldProgress(prev, worldSnapshot(areas, xp, earnedHere), now);
    if (r.changed) await setMeta(WORLD_META_KEY, r.seen);
    return r.celebrate;
  });
  chain = run.catch(() => undefined);
  return run;
}

let watchers = 0;
let pending: string[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

/** Joins celebrations that arrive within the delay; nothing is said once no watcher is mounted. */
function scheduleCelebration(text: string): void {
  if (watchers === 0) return;
  pending.push(text);
  clearTimeout(timer);
  timer = setTimeout(() => {
    const message = pending.join(' ');
    pending = [];
    if (watchers > 0) void useCompanion.getState().announce(message, CELEBRATE_SHOW_MS);
  }, CELEBRATE_DELAY_MS);
}

export function WorldWatcher(): null {
  const data = useLiveQuery(async () => {
    // XP written here gets its outbox entry in the same transaction (kept until it is sent);
    // a record applied from sync never gets one.
    const [areas, xp, pending] = await Promise.all([
      db.areas.toArray(), db.xpEvents.toArray(), db.outbox.where('key').startsWith(OUTBOX_XP).primaryKeys(),
    ]);
    return {
      areas: areas.filter((a) => !a.deleted && !a.archived),
      xp: xp.filter((x) => !x.deleted),
      earnedHere: new Set<ID>(pending.map((k) => k.slice(OUTBOX_XP.length))),
    };
  });
  useEffect(() => {
    watchers += 1;
    return () => {
      watchers -= 1;
      if (watchers === 0) {
        clearTimeout(timer);
        pending = [];
      }
    };
  }, []);
  useEffect(() => {
    if (!data) return;
    checkWorld(data.areas, data.xp, Date.now(), data.earnedHere).then((news) => {
      const text = celebrationText(news, data.areas);
      if (text) scheduleCelebration(text);
    }, (e: unknown) => { console.error('world check failed', e); });
  }, [data]);
  return null;
}

/** News of the last 3 days, newest first (Personagem card). */
export function useWorldNews(): WorldNews[] {
  const now = useNow();
  const raw = useLiveQuery(() => getMeta<unknown>(WORLD_META_KEY), []);
  return activeNews(normalizeSeen(raw), now);
}
