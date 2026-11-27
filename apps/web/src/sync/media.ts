import { create } from 'zustand';
import { isMediaHash, mediaRefs } from '@life/shared';
import { db } from '../db/db';
import { storeMedia } from '../db/media';
import { getMeta } from '../db/repo';

// Media sync (Marco 3c, spec §5). Files go up through a persistent queue BEFORE the records of each sync round, so a
// device that receives a note finds its files on the server (PDFs over 8 MB go after the records: no note references
// them). They come down on demand (what is on screen) and in background (everything live notes reference), so reviews
// work offline on the iPhone. Nothing here throws: failures wait for the next round. PDFs da aula (2026-11-26 §2.4): a
// PDF comes down only when the reader opens it (fetchMediaNow), never in background, and its extracted text never does
// (only notes' references are prefetched).

export const UPLOAD_ROUND_FILES = 20;
export const UPLOAD_ROUND_BYTES = 8 * 1024 * 1024;
export const PREFETCH_ROUND_FILES = 30;
export const PREFETCH_SCAN_MS = 5 * 60_000;
export const ON_DEMAND_RETRY_MS = 30_000;
/** A file the server could not give (404, bad bytes) is skipped by the background download for this long. */
export const PREFETCH_COOLDOWN_MS = 10 * 60_000;
/** Per file: a stalled connection must not hold the sync round forever. */
export const MEDIA_TIMEOUT_MS = 60_000;
/** Uploads (and PDF downloads): 60 s plus 10 s per MB, at most 10 minutes (a 50 MB PDF; an 8 MB image gets 140 s). */
export const uploadTimeoutMs = (bytes: number): number => Math.min(600_000, MEDIA_TIMEOUT_MS + Math.ceil(bytes / (1024 * 1024)) * 10_000);

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
 * Which queued files a call sends: 'all'; 'small' (up to UPLOAD_ROUND_BYTES each: images, audio, PDF texts, small PDFs),
 * which goes before the records; 'big' (bigger files, PDFs), which goes after them so a 50 MB PDF never holds the records.
 */
export type UploadPass = 'all' | 'small' | 'big';
const isBig = (size: number): boolean => size > UPLOAD_ROUND_BYTES;

/**
 * Sends queued files, oldest first: 2xx → done; 400/413/415 → the server will never take it, so it
 * leaves the queue (warning); anything else (offline, 401, 404 of a server without media, 5xx) →
 * stop, retry next round. At most UPLOAD_ROUND_FILES files / UPLOAD_ROUND_BYTES per round ('more'); a file bigger than
 * that (a PDF) goes alone in its round. A file that fails by timeout, and a big one that fails in any way, goes to the
 * back of the queue, so it does not hold the others every round.
 */
export async function uploadPendingMedia(token: string, pass: UploadPass = 'all'): Promise<UploadOutcome> {
  try {
    const queue = await db.mediaQueue.orderBy('addedAt').toArray();
    let files = 0;
    let bytes = 0;
    for (const item of queue) {
      // The size from the metadata, so a 50 MB PDF that waits for the next round is not read now.
      const size = (await db.mediaInfo.get(item.hash))?.size ?? 0;
      if ((pass === 'small' && isBig(size)) || (pass === 'big' && !isBig(size))) continue;
      if (files >= UPLOAD_ROUND_FILES) return 'more';
      if (files > 0 && bytes + size > UPLOAD_ROUND_BYTES) return 'more';
      const data = await db.mediaData.get(item.hash);
      if (!data) {
        await db.mediaQueue.delete(item.hash);
        continue;
      }
      const toBack = () => db.mediaQueue.update(item.hash, { addedAt: Date.now() });
      let res: Response;
      try {
        res = await withTimeout(uploadTimeoutMs(data.bytes.byteLength), (signal) => fetch(mediaUrl(item.hash), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}` },
          body: data.bytes,
          signal,
        }));
      } catch (e) {
        // iOS cuts connections in background ("Load failed"): a big file goes to the back on any failure.
        if ((e as { name?: string } | null)?.name === 'AbortError' || isBig(data.bytes.byteLength)) await toBack();
        return 'stopped';
      }
      const refused = res.status === 400 || res.status === 413 || res.status === 415;
      if (!res.ok && !refused) {
        if (isBig(data.bytes.byteLength)) await toBack();
        return 'stopped';
      }
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

let bigUpload: Promise<UploadOutcome> | undefined;

/**
 * The big files (PDFs over UPLOAD_ROUND_BYTES), one at a time, after the records of a round and without holding the
 * next rounds (one run at a time). Stops at the first failure; the next round tries again.
 */
export function uploadBigMedia(token: string): Promise<UploadOutcome> {
  bigUpload ??= (async () => {
    let r: UploadOutcome;
    do r = await uploadPendingMedia(token, 'big'); while (r === 'more');
    return r;
  })().finally(() => { bigUpload = undefined; });
  return bigUpload;
}

/** What the server says about a file: it holds it ('present'), it answered that it lacks it ('missing'), or no answer. */
export type ServerMediaState = 'present' | 'missing' | 'unknown';

/** HEAD of the file on the server: 2xx 'present', 404 'missing'; any other answer, an error or a timeout 'unknown'. Never throws. */
export async function mediaServerState(hash: string, token: string): Promise<ServerMediaState> {
  try {
    return await withTimeout(MEDIA_TIMEOUT_MS, async (signal) => {
      const res = await fetch(mediaUrl(hash), { method: 'HEAD', headers: { Authorization: `Bearer ${token}` }, signal });
      return res.ok ? 'present' : res.status === 404 ? 'missing' : 'unknown';
    });
  } catch {
    return 'unknown';
  }
}

/** True only when the server answers that it holds `hash` (HEAD). Any other answer, an error or a timeout is false; never throws. */
export async function mediaOnServer(hash: string, token: string): Promise<boolean> {
  return (await mediaServerState(hash, token)) === 'present';
}

export type DownloadOutcome = 'stored' | 'missing' | 'failed' | 'offline';

/** One file from the server: its bytes must hash to `hash`; kept here, not queued for upload. */
export async function downloadMedia(hash: string, token: string, timeoutMs: number = MEDIA_TIMEOUT_MS): Promise<DownloadOutcome> {
  let bytes: ArrayBuffer;
  try {
    const got = await withTimeout(timeoutMs, async (signal) => {
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
function fetchOnce(hash: string, token: string, timeoutMs: number = MEDIA_TIMEOUT_MS): Promise<DownloadOutcome> {
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
    return downloadMedia(hash, token, timeoutMs);
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

export type FetchNowOutcome = DownloadOutcome | 'no-sync';

/**
 * A file needed right now (the PDF reader, "Baixar para ler sem internet"): already here → 'stored'; otherwise fetched
 * from the server with a timeout that grows with `bytes` (up to 10 minutes). 'no-sync' without an access code,
 * 'offline' without network. Deduplicated with the other downloads of the same hash; never throws.
 */
export async function fetchMediaNow(hash: string, bytes: number): Promise<FetchNowOutcome> {
  try {
    if (!isMediaHash(hash)) return 'failed';
    if (await db.mediaInfo.get(hash)) return 'stored';
    const token = await getMeta<string>('syncToken');
    if (!token) return 'no-sync';
    if (isOffline()) return 'offline';
    return await fetchOnce(hash, token, uploadTimeoutMs(bytes));
  } catch {
    return 'failed';
  }
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
  bigUpload = undefined;
  useMediaStatus.setState({}, true);
}
