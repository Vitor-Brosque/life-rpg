import { create } from 'zustand';
import { isMediaHash, mediaRefs } from '@life/shared';
import { db } from '../db/db';
import { storeMedia } from '../db/media';
import { getMeta } from '../db/repo';

// Media sync (Marco 3c, spec §5). Files go up through a persistent queue BEFORE the records of each
// sync round, so a device that receives a note finds its files on the server. They come down on
// demand (what is on screen) and in background (everything live notes reference), so reviews work
// offline on the iPhone. Nothing here throws: failures wait for the next round.

export const UPLOAD_ROUND_FILES = 20;
export const UPLOAD_ROUND_BYTES = 8 * 1024 * 1024;
export const PREFETCH_ROUND_FILES = 30;
export const PREFETCH_SCAN_MS = 5 * 60_000;
export const ON_DEMAND_RETRY_MS = 30_000;
/** A file the server could not give (404, bad bytes) is skipped by the background download for this long. */
export const PREFETCH_COOLDOWN_MS = 10 * 60_000;
/** Per file: a stalled connection must not hold the sync round forever. */
export const MEDIA_TIMEOUT_MS = 60_000;
/** Uploads: 60 s plus 10 s per MB, at most 180 s. */
export const uploadTimeoutMs = (bytes: number): number => Math.min(180_000, MEDIA_TIMEOUT_MS + Math.ceil(bytes / (1024 * 1024)) * 10_000);

export type MediaStatus = 'downloading' | 'missing';
/** Download state of files this device lacks (absent key: nothing known yet). */
export const useMediaStatus = create<Record<string, MediaStatus>>(() => ({}));

function mark(hash: string, status: MediaStatus | undefined): void {
  useMediaStatus.setState((cur) => {
    const next = { ...cur };
    if (status) next[hash] = status;
    else delete next[hash];
    return next;
  }, true);
}

const mediaUrl = (hash: string): string => `/api/media/${hash}`;
const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;
const isClosed = (e: unknown): boolean => (e as { name?: string } | null)?.name === 'DatabaseClosedError';

/** Runs `run` with an abort signal that fires after `ms` (own timer: AbortSignal.timeout is missing in older Safari). */
function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return run(ctl.signal).finally(() => clearTimeout(timer));
}

export type UploadOutcome = 'done' | 'more' | 'stopped';

/**
 * Sends queued files, oldest first: 2xx → done; 400/413/415 → the server will never take it, so it
 * leaves the queue (warning); anything else (offline, 401, 404 of a server without media, 5xx) →
 * stop, retry next round. At most UPLOAD_ROUND_FILES files / UPLOAD_ROUND_BYTES per round ('more').
 */
export async function uploadPendingMedia(token: string): Promise<UploadOutcome> {
  try {
    const queue = await db.mediaQueue.orderBy('addedAt').toArray();
    let files = 0;
    let bytes = 0;
    for (const item of queue) {
      if (files >= UPLOAD_ROUND_FILES || bytes >= UPLOAD_ROUND_BYTES) return 'more';
      const data = await db.mediaData.get(item.hash);
      if (!data) {
        await db.mediaQueue.delete(item.hash);
        continue;
      }
      let res: Response;
      try {
        res = await withTimeout(uploadTimeoutMs(data.bytes.byteLength), (signal) => fetch(mediaUrl(item.hash), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}` },
          body: data.bytes,
          signal,
        }));
      } catch (e) {
        // A timeout sends the file to the back of the queue, so a slow one does not hold the others every round.
        if ((e as { name?: string } | null)?.name === 'AbortError') await db.mediaQueue.update(item.hash, { addedAt: Date.now() });
        return 'stopped';
      }
      const refused = res.status === 400 || res.status === 413 || res.status === 415;
      if (!res.ok && !refused) return 'stopped';
      if (refused) console.warn(`media: the server refused ${item.hash} (${res.status})`);
      await db.mediaQueue.delete(item.hash);
      files += 1;
      bytes += data.bytes.byteLength;
    }
    return 'done';
  } catch (e) {
    if (!isClosed(e)) console.error('media upload failed', e);
    return 'stopped';
  }
}

export type DownloadOutcome = 'stored' | 'missing' | 'failed' | 'offline';

/** One file from the server: its bytes must hash to `hash`; kept here, not queued for upload. */
export async function downloadMedia(hash: string, token: string): Promise<DownloadOutcome> {
  let bytes: ArrayBuffer;
  try {
    const got = await withTimeout(MEDIA_TIMEOUT_MS, async (signal) => {
      const res = await fetch(mediaUrl(hash), { headers: { Authorization: `Bearer ${token}` }, signal });
      return { status: res.status, bytes: res.ok ? await res.arrayBuffer() : undefined };
    });
    if (got.status === 404) return 'missing';
    if (!got.bytes) return 'failed';
    bytes = got.bytes;
  } catch {
    return 'offline'; // no network, timeout, or the body stopped arriving
  }
  try {
    await storeMedia(bytes, { upload: false, expectHash: hash });
    return 'stored';
  } catch (e) {
    if (!isClosed(e)) console.warn(`media: could not keep ${hash}`, e);
    return 'failed';
  }
}

const inFlight = new Map<string, Promise<DownloadOutcome>>();
const triedAt = new Map<string, number>();

/** downloadMedia, once at a time per hash, with the status the placeholders show. */
function fetchOnce(hash: string, token: string): Promise<DownloadOutcome> {
  const running = inFlight.get(hash);
  if (running) return running;
  triedAt.set(hash, Date.now());
  mark(hash, 'downloading');
  const p = (async (): Promise<DownloadOutcome> => {
    try {
      if (await db.mediaInfo.get(hash)) return 'stored'; // already here: nothing to fetch
    } catch {
      return 'failed';
    }
    return downloadMedia(hash, token);
  })()
    .then((r) => { mark(hash, r === 'stored' ? undefined : 'missing'); return r; })
    .finally(() => { inFlight.delete(hash); });
  inFlight.set(hash, p);
  return p;
}

/** A media element is on screen without its file: fetch it now (deduplicated, again after 30 s). */
export function requestMedia(hash: string): void {
  if (!isMediaHash(hash) || inFlight.has(hash)) return;
  const last = triedAt.get(hash);
  if (last !== undefined && Date.now() - last < ON_DEMAND_RETRY_MS) return;
  triedAt.set(hash, Date.now());
  void (async () => {
    if (await db.mediaInfo.get(hash)) {
      mark(hash, undefined);
      return;
    }
    const token = await getMeta<string>('syncToken');
    if (!token || isOffline()) {
      mark(hash, 'missing');
      return;
    }
    await fetchOnce(hash, token);
  })().catch(() => mark(hash, 'missing'));
}

/** After a sync round: files that were missing on screen may be asked for again right away. */
export function resetMediaRetries(): void {
  triedAt.clear();
}

/** Hashes referenced by live notes that this device lacks, in note order. */
export async function missingMedia(): Promise<string[]> {
  const notes = (await db.notes.toArray()).filter((n) => !n.deleted);
  const wanted = mediaRefs(notes.flatMap((n) => [n.front, n.back, n.extra]));
  if (wanted.length === 0) return [];
  const have = await db.mediaInfo.bulkGet(wanted);
  return wanted.filter((_, i) => !have[i]);
}

const prefetchTried = new Map<string, number>();
let lastScan = 0;
let prefetching: Promise<void> | undefined;
let again = false;

/**
 * Background download of what live notes reference and this device lacks (spec §5.3): one run at
 * a time, PREFETCH_ROUND_FILES per run, stops when offline. Scans at most every PREFETCH_SCAN_MS
 * unless `force` (the round pulled notes); a forced call during a run runs again afterwards.
 */
export function prefetchMedia(token: string, force = false): Promise<void> {
  if (prefetching) {
    if (force) again = true;
    return prefetching;
  }
  if (!force && Date.now() - lastScan < PREFETCH_SCAN_MS) return Promise.resolve();
  lastScan = Date.now();
  prefetching = (async () => {
    try {
      const now = Date.now();
      // Files the server could not give wait out a cooldown, so they never starve the ones behind them.
      const wanted = (await missingMedia()).filter((h) => now - (prefetchTried.get(h) ?? -Infinity) >= PREFETCH_COOLDOWN_MS);
      let offline = false;
      for (const hash of wanted.slice(0, PREFETCH_ROUND_FILES)) {
        const r = await fetchOnce(hash, token);
        if (r === 'offline') {
          lastScan = 0; // not a real scan: the next unforced one may run as soon as the network is back
          offline = true;
          break;
        }
        if (r !== 'stored') prefetchTried.set(hash, Date.now());
      }
      // More are missing: another run (each file is stored or put on cooldown, so this ends).
      if (!offline && wanted.length > PREFETCH_ROUND_FILES) again = true;
    } catch (e) {
      if (!isClosed(e)) console.warn('media prefetch failed', e);
    }
  })().finally(() => {
    prefetching = undefined;
    if (again) {
      again = false;
      void prefetchMedia(token, true);
    }
  });
  return prefetching;
}

/** Tests only: forget every in-memory state. */
export function resetMediaSyncState(): void {
  inFlight.clear();
  triedAt.clear();
  prefetchTried.clear();
  lastScan = 0;
  prefetching = undefined;
  again = false;
  useMediaStatus.setState({}, true);
}
