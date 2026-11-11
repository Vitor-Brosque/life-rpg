import type { SyncChange, SyncRequest, SyncResponse } from '@life/shared';
import { ulid } from '@life/shared';
import { db, tableOf } from '../db/db';
import { applyRemote, getMeta, onLocalChange, setMeta } from '../db/repo';
import { useSyncStatus } from './status';

const PAGE_LIMIT = 5000;
const MAX_PAGES = 20;
const BACKOFF_START = 2000;
const BACKOFF_MAX = 5 * 60_000;

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
  const res = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new HttpError(res.status);
  return (await res.json()) as SyncResponse;
}

async function performSync(token: string): Promise<void> {
  const deviceId = await getDeviceId();
  let cursor = (await getMeta<number>('cursor')) ?? 0;

  const snapshot = await db.outbox.toArray();
  const changes: SyncChange[] = [];
  const stale: string[] = [];
  for (const entry of snapshot) {
    const record = await tableOf(entry.table).get(entry.id);
    if (record) changes.push({ table: entry.table, record });
    else stale.push(entry.key);
  }
  if (stale.length) await db.outbox.bulkDelete(stale);

  let outgoing = changes;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await post(token, { deviceId, cursor, changes: outgoing });
    if (page === 0) {
      // Delete only rows that were not edited while the request was in flight.
      await db.transaction('rw', db.outbox, async () => {
        for (const entry of snapshot) {
          const cur = await db.outbox.get(entry.key);
          if (cur && cur.updatedAt === entry.updatedAt) await db.outbox.delete(entry.key);
        }
      });
    }
    for (const change of res.changes) await applyRemote(change);
    cursor = res.cursor;
    await setMeta('cursor', cursor);
    outgoing = [];
    if (res.changes.length < PAGE_LIMIT) break;
  }
}

let running: Promise<boolean> | undefined;
let rerun = false;

/** Runs one sync; resolves true when it finished without error (or sync is disabled). */
async function runSync(): Promise<boolean> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    let ok = true;
    do {
      rerun = false;
      const token = await getMeta<string>('syncToken');
      if (!token) {
        setStatus({ state: 'disabled', error: undefined });
        await refreshPending();
        return true;
      }
      setStatus({ state: 'syncing' });
      try {
        await performSync(token);
        setStatus({ state: 'idle', lastSync: Date.now(), error: undefined });
        ok = true;
      } catch (e) {
        ok = false;
        if (e instanceof HttpError && e.status === 401) {
          setStatus({ state: 'error', error: 'Código de acesso inválido' });
        } else if (e instanceof HttpError) {
          setStatus({ state: 'error', error: `Erro do servidor (${e.status})` });
        } else {
          setStatus({ state: 'offline', error: undefined });
        }
        break;
      }
    } while (rerun);
    await refreshPending();
    return ok;
  })().finally(() => { running = undefined; });
  return running;
}

export async function syncNow(): Promise<void> {
  await runSync();
}

export async function setSyncToken(token: string): Promise<boolean> {
  try {
    const deviceId = await getDeviceId();
    const cursor = (await getMeta<number>('cursor')) ?? 0;
    await post(token, { deviceId, cursor, changes: [] });
  } catch {
    return false;
  }
  await setMeta('syncToken', token);
  return true;
}

export function startSync(): () => void {
  if (typeof window === 'undefined') return () => {};
  let stopped = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = BACKOFF_START;
  let stream: EventSource | undefined;
  let streamToken: string | undefined;

  const trigger = async (): Promise<void> => {
    if (stopped) return;
    const ok = await runSync();
    if (stopped) return;
    if (ok) {
      delay = BACKOFF_START;
      void ensureStream();
    } else {
      clearTimeout(retry);
      retry = setTimeout(() => { void trigger(); }, delay);
      delay = Math.min(delay * 2, BACKOFF_MAX);
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
    stream = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
    stream.addEventListener('changed', () => { void trigger(); });
  };

  const onLocal = (): void => {
    void refreshPending();
    clearTimeout(debounce);
    debounce = setTimeout(() => { void trigger(); }, 1000);
  };
  const onOnline = (): void => { void trigger(); };
  const onVisible = (): void => { if (document.visibilityState === 'visible') void trigger(); };

  const offLocal = onLocalChange(onLocal);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  const interval = setInterval(() => { void trigger(); }, 60_000);
  void refreshPending();
  void trigger();

  return () => {
    stopped = true;
    offLocal();
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(interval);
    clearTimeout(debounce);
    clearTimeout(retry);
    stream?.close();
  };
}
