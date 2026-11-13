import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@life/shared';
import { sha256Hex } from '@life/shared';
import { db } from '../src/db/db';
import { MediaInputError, hashBytes, mediaUsage, saveMediaBlob, storeMedia } from '../src/db/media';
import { setMeta } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { rateCard, saveDeck, saveNote } from '../src/domain/studyActions';
import { syncNow } from '../src/sync/client';
import {
  ON_DEMAND_RETRY_MS, UPLOAD_ROUND_FILES, downloadMedia, missingMedia, prefetchMedia, requestMedia, resetMediaSyncState,
  uploadPendingMedia, useMediaStatus,
} from '../src/sync/media';
import { useSyncStatus } from '../src/sync/status';
import { PNG_BYTES } from './fakeMedia';

const png = (seed = 0, size = 32) => { const b = new Uint8Array(size).fill(seed); b.set(PNG_BYTES.subarray(0, 8)); return b; };
const res = (status: number, body?: Uint8Array) => ({
  ok: status >= 200 && status < 300, status, arrayBuffer: async () => (body ?? new Uint8Array()).slice().buffer,
});
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const note = (id: string, front: string, deleted = false) =>
  ({ id, createdAt: 5, updatedAt: 5, deleted, type: 'basic', front, back: 'y', draft: false }) as Note;

beforeEach(async () => {
  await db.delete(); await db.open();
  resetMediaSyncState();
  useSyncStatus.setState({ state: 'disabled', pending: 0, error: undefined });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('storeMedia', () => {
  it('hashes like the plain version, keeps one copy and queues uploads', async () => {
    const b = png(1);
    expect(await hashBytes(b)).toBe(sha256Hex(b));
    expect(await hashBytes(b.buffer)).toBe(sha256Hex(b));
    const big = new Uint8Array(100); big.set(b, 10);
    expect(await hashBytes(big.subarray(10, 42))).toBe(sha256Hex(b));
    const first = await storeMedia(b, { upload: true });
    expect(first.created).toBe(true);
    expect(first.info).toMatchObject({ hash: sha256Hex(b), type: 'image/png', size: 32 });
    expect((await storeMedia(b.buffer, { upload: false })).created).toBe(false);
    expect((await storeMedia(big.subarray(10, 42), { upload: false })).created).toBe(false);
    expect((await db.mediaData.get(sha256Hex(b)))!.bytes.byteLength).toBe(32);
    expect(await mediaUsage()).toEqual({ count: 1, bytes: 32, pending: 1 });
  });
  it('refuses empty, unknown and oversized input; a wrong expected hash is a plain error', async () => {
    await expect(storeMedia(new Uint8Array(), { upload: true })).rejects.toThrow('O arquivo está vazio.');
    await expect(storeMedia(new TextEncoder().encode('<html>hello world</html>'), { upload: true })).rejects.toBeInstanceOf(MediaInputError);
    await expect(storeMedia(new Uint8Array(8 * 1024 * 1024 + 1), { upload: true })).rejects.toThrow('Arquivo grande demais (máximo 8 MB).');
    await expect(storeMedia(png(2), { upload: false, expectHash: 'a'.repeat(64) })).rejects.not.toBeInstanceOf(MediaInputError);
    expect(await db.mediaInfo.count()).toBe(0);
  });
  it('saveMediaBlob stores a Blob and queues it', async () => {
    const info = await saveMediaBlob(new Blob([png(3)], { type: 'image/png' }));
    expect(info.hash).toBe(sha256Hex(png(3)));
    expect(await db.mediaQueue.get(info.hash)).toBeTruthy();
  });
});

describe('uploadPendingMedia', () => {
  it('PUTs the bytes with the token, oldest first, and empties the queue', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000); const a = await saveMediaBlob(new Blob([png(1)]));
    vi.setSystemTime(2000); const b = await saveMediaBlob(new Blob([png(2)]));
    const f = vi.fn(async (_u: string, _i: RequestInit) => res(204));
    vi.stubGlobal('fetch', f);
    expect(await uploadPendingMedia('tok')).toBe('done');
    expect(f.mock.calls.map((c) => c[0])).toEqual([`/api/media/${a.hash}`, `/api/media/${b.hash}`]);
    const init = f.mock.calls[0]![1];
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'Content-Type': 'application/octet-stream', Authorization: 'Bearer tok' });
    expect((init.body as ArrayBuffer).byteLength).toBe(32);
    expect(await db.mediaQueue.count()).toBe(0);
  });
  it('stops on network errors, 500, 401 and 404; drops what the server refuses', async () => {
    const a = await saveMediaBlob(new Blob([png(1)]));
    for (const fail of [() => { throw new TypeError('net'); }, () => res(500), () => res(401), () => res(404)]) {
      vi.stubGlobal('fetch', vi.fn(async () => fail()));
      expect(await uploadPendingMedia('tok')).toBe('stopped');
      expect(await db.mediaQueue.get(a.hash)).toBeTruthy();
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => res(415)));
    expect(await uploadPendingMedia('tok')).toBe('done');
    expect(await db.mediaQueue.count()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('sends at most UPLOAD_ROUND_FILES per round', async () => {
    for (let i = 0; i < UPLOAD_ROUND_FILES + 2; i++) await saveMediaBlob(new Blob([png(i + 1)]));
    const f = vi.fn(async () => res(204)); vi.stubGlobal('fetch', f);
    expect(await uploadPendingMedia('tok')).toBe('more');
    expect(f).toHaveBeenCalledTimes(UPLOAD_ROUND_FILES);
    expect(await uploadPendingMedia('tok')).toBe('done');
    expect(await db.mediaQueue.count()).toBe(0);
  });
});

describe('downloads', () => {
  it('keeps a verified file without queueing it; 404 is missing; bad bytes fail; no network is offline', async () => {
    const b = png(5); const h = sha256Hex(b);
    vi.stubGlobal('fetch', vi.fn(async (u: string, i: RequestInit) => {
      expect(u).toBe(`/api/media/${h}`);
      expect(i.headers).toEqual({ Authorization: 'Bearer tok' });
      return res(200, b);
    }));
    expect(await downloadMedia(h, 'tok')).toBe('stored');
    expect((await db.mediaInfo.get(h))!.type).toBe('image/png');
    expect(await db.mediaQueue.count()).toBe(0);
    vi.stubGlobal('fetch', vi.fn(async () => res(404)));
    expect(await downloadMedia('c'.repeat(64), 'tok')).toBe('missing');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => res(200, png(6))));
    expect(await downloadMedia('d'.repeat(64), 'tok')).toBe('failed');
    expect(await db.mediaInfo.get('d'.repeat(64))).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('x'); }));
    expect(await downloadMedia('d'.repeat(64), 'tok')).toBe('offline');
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('requestMedia: missing without a token; with one it downloads once and waits 30 s between tries', async () => {
    const b = png(7); const h = sha256Hex(b);
    const f = vi.fn(async () => res(200, b)); vi.stubGlobal('fetch', f);
    requestMedia(h);
    await vi.waitFor(() => expect(useMediaStatus.getState()[h]).toBe('missing'));
    expect(f).not.toHaveBeenCalled();
    await setMeta('syncToken', 'tok');
    requestMedia(h); // within 30 s: nothing
    await new Promise((r) => setTimeout(r, 20));
    expect(f).not.toHaveBeenCalled();
    const real = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementation(() => real() + ON_DEMAND_RETRY_MS + 1);
    requestMedia(h); requestMedia(h);
    await vi.waitFor(async () => expect(await db.mediaInfo.get(h)).toBeTruthy());
    await vi.waitFor(() => expect(useMediaStatus.getState()[h]).toBeUndefined());
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('prefetch fetches only what live notes reference and this device lacks, at most every 5 min unless forced', async () => {
    const have = png(8); const want = png(9); const gone = png(10);
    await storeMedia(have, { upload: false });
    const H = sha256Hex(have); const W = sha256Hex(want); const G = sha256Hex(gone);
    await db.notes.bulkPut([note('n1', `![a](media:${H}) [b](media:${W})`), note('n2', `![c](media:${G})`, true)]);
    expect(await missingMedia()).toEqual([W]);
    const f = vi.fn(async (u: string) => res(200, u.endsWith(W) ? want : gone)); vi.stubGlobal('fetch', f);
    await prefetchMedia('tok');
    expect(f).toHaveBeenCalledTimes(1);
    expect(await db.mediaInfo.get(W)).toBeTruthy();
    await db.notes.put(note('n3', `![c](media:${G})`));
    await prefetchMedia('tok');
    expect(f).toHaveBeenCalledTimes(1);
    await prefetchMedia('tok', true);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('sync rounds', () => {
  it('sends queued media before the records', async () => {
    await setMeta('syncToken', 'tok');
    const info = await saveMediaBlob(new Blob([png(4)]));
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return url === '/api/sync' ? json({ cursor: 1, changes: [] }) : res(204);
    }));
    expect(await syncNow()).toBe(true);
    expect(calls.slice(0, 2)).toEqual([`/api/media/${info.hash}`, '/api/sync']);
    expect(await db.mediaQueue.count()).toBe(0);
    expect(useSyncStatus.getState().state).toBe('idle');
  });
  it('a round that pulls a note downloads the media it references in background', async () => {
    await setMeta('syncToken', 'tok');
    const b = png(11); const h = sha256Hex(b);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/sync'
      ? json({ cursor: 3, changes: [{ table: 'notes', record: note('n9', `![x](media:${h})`) }] })
      : res(200, b))));
    expect(await syncNow()).toBe(true);
    await vi.waitFor(async () => expect(await db.mediaInfo.get(h)).toBeTruthy());
  });
});

describe('study fields', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
    await ensureSeed();
  });
  it('rateCard saves spoke only when true; saveDeck keeps and clears speechLang', async () => {
    const d = await saveDeck({ name: 'Inglês', speechLang: 'en-US' });
    expect((await db.decks.get(d.id))!.speechLang).toBe('en-US');
    const n = await saveNote({ deckId: d.id, type: 'basic', front: 'apple', back: 'maçã' });
    const card = (await db.cards.where('noteId').equals(n.id).toArray())[0]!;
    const r1 = await rateCard(card.id, 3, { durationMs: 1000, wrote: false, spoke: true });
    expect((await db.reviews.get(r1.reviewId))!.spoke).toBe(true);
    const r2 = await rateCard(card.id, 3, { durationMs: 1000, wrote: false, spoke: false });
    expect('spoke' in (await db.reviews.get(r2.reviewId))!).toBe(false);
    await saveDeck({ id: d.id, name: 'Inglês', speechLang: '' });
    expect((await db.decks.get(d.id))!.speechLang).toBeUndefined();
  });
});
