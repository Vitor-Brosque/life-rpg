import type { BaseRecord, SyncChange, SyncRequest, SyncResponse } from '@life/shared';
import { SYNC_TABLES, ulid } from '@life/shared';
import { db, tableOf, type OutboxEntry } from '../db/db';
import { applyRemote, getMeta, onLocalChange, setMeta } from '../db/repo';
import { useSyncStatus } from './status';

const PAGE_LIMIT = 5000;
/** Outbox entries pushed per request (the server accepts at most 2000 changes per request). */
const PUSH_LIMIT = 1000;
const MAX_PAGES = 20;
/** "Start over" answers accepted in one round (after one, the cursor is 0 and the server cannot be behind). */
const MAX_RESETS = 2;
const BACKOFF_START = 2000;
const BACKOFF_MAX = 5 * 60_000;

const TOKEN_EVENT = 'life-rpg:token';

class NetworkError extends Error {}

class HttpError extends Error {
  constructor(public status: number) { super(`HTTP ${status}`); }
}

const setStatus = useSyncStatus.setState;

async function refreshPending(): Promise<void> {
  setStatus({ pending: await db.outbox.count() });
}

async function getDeviceId(): Promise<string> {
  let id = await getMeta<string>('deviceId');
  if (!id) {
    id = ulid();
    await setMeta('deviceId', id);
  }
  return id;
}

async function post(token: string, body: SyncRequest): Promise<SyncResponse> {
  let res: Response;
  try {
    res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e instanceof TypeError) throw new NetworkError('network');
    throw e;
  }
  if (!res.ok) throw new HttpError(res.status);
  return (await res.json()) as SyncResponse;
}

/** The first `limit` outbox entries with their current records (entries whose record is gone are dropped). */
async function takeBatch(limit: number): Promise<{ snapshot: OutboxEntry[]; changes: SyncChange[] }> {
  const snapshot = await db.outbox.limit(limit).toArray();
  const changes: SyncChange[] = [];
  const stale: string[] = [];
  for (const entry of snapshot) {
    const record = await tableOf(entry.table).get(entry.id);
    if (record) changes.push({ table: entry.table, record });
    else stale.push(entry.key);
  }
  if (stale.length) await db.outbox.bulkDelete(stale);
  return { snapshot, changes };
}

/**
 * The server lost revisions this device already has (restored backup): queue every local
 * record again, keeping its own updatedAt, so the next round resends all of them from cursor 0.
 */
async function requeueEverything(): Promise<void> {
  const tables = SYNC_TABLES.map(tableOf);
  await db.transaction('rw', [...tables, db.outbox, db.meta], async () => {
    for (const table of SYNC_TABLES) {
      const records = (await tableOf(table).toArray()) as BaseRecord[];
      await db.outbox.bulkPut(records.map((r) => ({
        key: `${table}:${r.id}`, table, id: r.id, updatedAt: r.updatedAt,
      })));
    }
    await db.meta.put({ key: 'cursor', value: 0 });
  });
}

/** One push + pull round. Resolves true when the outbox had more entries than one request carries. */
async function performSync(token: string): Promise<boolean> {
  const deviceId = await getDeviceId();
  let limit = PUSH_LIMIT; // halved on 413 for this round only
  let resets = 0;
  for (;;) {
    let cursor = (await getMeta<number>('cursor')) ?? 0;
    const { snapshot, changes } = await takeBatch(limit);
    let res: SyncResponse;
    try {
      res = await post(token, { deviceId, cursor, changes });
    } catch (e) {
      if (e instanceof HttpError && e.status === 413 && snapshot.length > 1) {
        limit = Math.max(1, Math.floor(snapshot.length / 2));
        continue;
      }
      throw e;
    }
    if (res.reset) {
      if (++resets > MAX_RESETS) throw new Error('sync: the server keeps asking for a reset');
      await requeueEverything();
      continue;
    }

    // Delete only rows that were not edited while the request was in flight.
    await db.transaction('rw', db.outbox, async () => {
      for (const entry of snapshot) {
        const cur = await db.outbox.get(entry.key);
        if (cur && cur.updatedAt === entry.updatedAt) await db.outbox.delete(entry.key);
      }
    });
    for (let page = 1; ; page++) {
      for (const change of res.changes) await applyRemote(change);
      cursor = res.cursor;
      await setMeta('cursor', cursor);
      if (res.changes.length < PAGE_LIMIT || page >= MAX_PAGES) break;
      res = await post(token, { deviceId, cursor, changes: [] });
      if (res.reset) return true; // the server was rolled back meanwhile: run another round
    }
    return snapshot.length === limit;
  }
}

let running: Promise<boolean> | undefined;
let rerun = false;

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** One sync attempt with status reporting; resolves true when it finished without error (or sync is disabled). */
async function syncOnce(): Promise<boolean> {
  try {
    const token = await getMeta<string>('syncToken');
    if (!token) {
      setStatus({ state: 'disabled', error: undefined });
      return true;
    }
    setStatus({ state: 'syncing' });
    // A big outbox (e.g. after "Importar JSON") goes out over several rounds of the runSync loop.
    if (await performSync(token)) rerun = true;
    setStatus({ state: 'idle', lastSync: Date.now(), error: undefined });
    return true;
  } catch (e) {
    if (e instanceof NetworkError || isOffline()) {
      setStatus({ state: 'offline', error: undefined });
    } else if (e instanceof HttpError && e.status === 401) {
      setStatus({ state: 'error', error: 'Código de acesso inválido' });
    } else {
      console.error('sync failed', e);
      setStatus({
        state: 'error',
        error: e instanceof HttpError ? `Erro do servidor (${e.status})` : 'Falha na sincronização',
      });
    }
    return false;
  }
}

/** Runs one sync; resolves true when it finished without error (or sync is disabled). */
function runSync(): Promise<boolean> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    let ok = true;
    try {
      for (;;) {
        rerun = false;
        ok = await syncOnce();
        try { await refreshPending(); } catch (e) { console.error('refreshPending failed', e); }
        // The exit check and the `finally` below run in the same synchronous step, so a trigger
        // either sets `rerun` before this check (joins the loop) or sees `running` cleared.
        if (!ok || !rerun) break;
      }
    } finally {
      running = undefined;
      rerun = false;
    }
    return ok;
  })();
  return running;
}

/** Syncs now; resolves true when it finished without error (or sync is disabled), false otherwise. */
export function syncNow(): Promise<boolean> {
  return runSync();
}

export type TokenResult = 'ok' | 'invalid' | 'offline';

export async function setSyncToken(token: string): Promise<TokenResult> {
  try {
    const deviceId = await getDeviceId();
    const cursor = (await getMeta<number>('cursor')) ?? 0;
    await post(token, { deviceId, cursor, changes: [] });
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) return 'invalid';
    if (!(e instanceof NetworkError)) console.error('token check failed', e);
    return 'offline';
  }
  await setMeta('syncToken', token);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TOKEN_EVENT));
  void syncNow();
  return 'ok';
}

export function startSync(): () => void {
  if (typeof window === 'undefined') return () => {};
  let stopped = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = BACKOFF_START;
  let stream: EventSource | undefined;
  let streamToken: string | undefined;
  let streamRetry: ReturnType<typeof setTimeout> | undefined;

  // Only a failed retry escalates the delay; ordinary triggers never do.
  const trigger = async (isRetry = false): Promise<void> => {
    if (stopped) return;
    const ok = await runSync();
    if (stopped) return;
    if (ok) {
      delay = BACKOFF_START;
      void ensureStream();
    } else {
      if (isRetry) delay = Math.min(delay * 2, BACKOFF_MAX);
      clearTimeout(retry);
      retry = setTimeout(() => { void trigger(true); }, delay);
    }
  };

  const ensureStream = async (): Promise<void> => {
    if (typeof EventSource === 'undefined' || stopped) return;
    const token = await getMeta<string>('syncToken');
    if (stopped || token === streamToken) return;
    stream?.close();
    stream = undefined;
    streamToken = token;
    if (!token) return;
    const es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
    stream = es;
    es.addEventListener('changed', () => { void trigger(); });
    es.addEventListener('error', () => {
      if (es.readyState !== 2 /* EventSource.CLOSED */ || stream !== es || stopped) return;
      stream = undefined;
      streamToken = undefined;
      clearTimeout(streamRetry);
      streamRetry = setTimeout(() => { void ensureStream(); }, delay);
    });
  };

  const onLocal = (): void => {
    void refreshPending();
    clearTimeout(debounce);
    debounce = setTimeout(() => { void trigger(); }, 1000);
  };
  const onToken = (): void => { void ensureStream(); };
  const onOnline = (): void => { void trigger(); };
  const onVisible = (): void => { if (document.visibilityState === 'visible') void trigger(); };

  const offLocal = onLocalChange(onLocal);
  window.addEventListener('online', onOnline);
  window.addEventListener(TOKEN_EVENT, onToken);
  document.addEventListener('visibilitychange', onVisible);
  const interval = setInterval(() => { void trigger(); }, 60_000);
  void refreshPending();
  void trigger();

  return () => {
    stopped = true;
    offLocal();
    window.removeEventListener('online', onOnline);
    window.removeEventListener(TOKEN_EVENT, onToken);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(interval);
    clearTimeout(debounce);
    clearTimeout(retry);
    clearTimeout(streamRetry);
    stream?.close();
  };
}
