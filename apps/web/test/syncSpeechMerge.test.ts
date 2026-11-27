import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, SpeechRecording, SpeechSession, SyncRequest } from '@life/shared';
import { db } from '../src/db/db';
import { applyRemote, setMeta } from '../src/db/repo';
import { syncNow } from '../src/sync/client';
import { useSyncStatus } from '../src/sync/status';

// I2: a speech session's recordings are a grow-only set merged by hash when a remote version meets a local one.

const NOW = 1_800_000_000_000;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await db.delete(); await db.open();
  useSyncStatus.setState({ state: 'disabled', pending: 0, error: undefined });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const rec = (hash: string, at: number, p: Partial<SpeechRecording> = {}): SpeechRecording => ({ hash, durationMs: 60_000, at, ...p });
/** A session as it travels in a sync change (records are plain objects there). */
type Synced = SpeechSession & Record<string, unknown>;
const sess = (p: Partial<SpeechSession> = {}): Synced => ({
  id: 's1', createdAt: 1000, updatedAt: 1000, deleted: false,
  day: '2026-11-23', kind: 'explicacao', recordings: [], ratings: {}, ...p,
}) as Synced;
/** Stores `s` as the local copy (no outbox entry, as after an earlier sync). */
const seedLocal = (s: Synced) => db.speechSessions.put(s);
const stored = async () => (await db.speechSessions.get('s1'))! as Synced;
const outbox = () => db.outbox.toArray();

describe('applyRemote: speech session recordings across devices', () => {
  it('remote wins and the local copy has an extra recording: both are kept, queued, newer than the remote', async () => {
    await seedLocal(sess({ updatedAt: 2000, recordings: [rec('a', 10), rec('iphone', 30)] }));
    const remote = sess({ updatedAt: 5000, notes: 'do PC', recordings: [rec('a', 10)] });
    expect(await applyRemote({ table: 'speechSessions', record: remote })).toBe(true);
    const s = await stored();
    expect(s.notes).toBe('do PC');
    expect(s.recordings.map((r) => r.hash)).toEqual(['a', 'iphone']);
    expect(s.updatedAt).toBeGreaterThan(5000);
    expect(s.updatedAt).toBe(NOW);
    expect(await outbox()).toEqual([{ key: 'speechSessions:s1', table: 'speechSessions', id: 's1', updatedAt: s.updatedAt }]);
  });

  it('the bump stays above the remote even when the clock is behind it', async () => {
    await seedLocal(sess({ updatedAt: 2000, recordings: [rec('iphone', 30)] }));
    const remote = sess({ updatedAt: NOW + 60_000, recordings: [rec('a', 10)] });
    await applyRemote({ table: 'speechSessions', record: remote });
    expect((await stored()).updatedAt).toBe(NOW + 60_001);
  });

  it('local wins (a pending local change) and the remote has an extra recording: the local copy gains it and is queued', async () => {
    await seedLocal(sess({ updatedAt: 6000, notes: 'minha', recordings: [rec('a', 10)] }));
    await db.outbox.put({ key: 'speechSessions:s1', table: 'speechSessions', id: 's1', updatedAt: 6000 });
    const remote = sess({ updatedAt: 5000, notes: 'antiga', recordings: [rec('a', 10), rec('pc', 20)] });
    expect(await applyRemote({ table: 'speechSessions', record: remote })).toBe(false);
    const s = await stored();
    expect(s.notes).toBe('minha');
    expect(s.recordings.map((r) => r.hash)).toEqual(['a', 'pc']);
    expect(s.updatedAt).toBe(NOW);
    expect(await outbox()).toEqual([{ key: 'speechSessions:s1', table: 'speechSessions', id: 's1', updatedAt: NOW }]);
  });

  it('local wins without a pending change (an echo of an older version): extra recordings come in too', async () => {
    await seedLocal(sess({ updatedAt: 6000, recordings: [] }));
    await applyRemote({ table: 'speechSessions', record: sess({ updatedAt: 6000, recordings: [rec('pc', 20)] }) });
    expect((await stored()).recordings.map((r) => r.hash)).toEqual(['pc']);
    expect((await outbox()).length).toBe(1);
  });

  it('identical lists write nothing back, either way', async () => {
    await seedLocal(sess({ updatedAt: 2000, recordings: [rec('a', 10), rec('b', 20)] }));
    const remote = sess({ updatedAt: 5000, notes: 'nova', recordings: [rec('b', 20), rec('a', 10)] });
    expect(await applyRemote({ table: 'speechSessions', record: remote })).toBe(true);
    expect(await stored()).toEqual(remote);
    expect(await outbox()).toEqual([]);

    expect(await applyRemote({ table: 'speechSessions', record: sess({ updatedAt: 4000, recordings: [rec('a', 10)] }) })).toBe(false);
    expect(await stored()).toEqual(remote);
    expect(await outbox()).toEqual([]);
  });

  it('Guardar follows the version that wins: turning it off is not undone by the other device', async () => {
    // This device still has Guardar on; the newer remote version turned it off.
    await seedLocal(sess({ updatedAt: 2000, recordings: [rec('a', 10, { keep: true })] }));
    const off = sess({ updatedAt: 5000, recordings: [rec('a', 10)] });
    expect(await applyRemote({ table: 'speechSessions', record: off })).toBe(true);
    expect(await stored()).toEqual(off);
    expect(await outbox()).toEqual([]);

    // The local version is newer and has Guardar off; an older remote copy with it on changes nothing.
    const mine = sess({ updatedAt: 9000, recordings: [rec('a', 10)] });
    await seedLocal(mine);
    expect(await applyRemote({ table: 'speechSessions', record: sess({ updatedAt: 8000, recordings: [rec('a', 10, { keep: true })] }) })).toBe(false);
    expect(await stored()).toEqual(mine);
    expect(await outbox()).toEqual([]);
  });

  it('a deleted side is plain last-write-wins', async () => {
    await seedLocal(sess({ updatedAt: 2000, recordings: [rec('iphone', 30)] }));
    const gone = sess({ updatedAt: 5000, deleted: true, recordings: [] });
    expect(await applyRemote({ table: 'speechSessions', record: gone })).toBe(true);
    expect(await stored()).toEqual(gone);
    expect(await outbox()).toEqual([]);

    await seedLocal(sess({ updatedAt: 9000, deleted: true, recordings: [] }));
    expect(await applyRemote({ table: 'speechSessions', record: sess({ updatedAt: 6000, recordings: [rec('pc', 20)] }) })).toBe(false);
    expect((await stored()).recordings).toEqual([]);

    await seedLocal(sess({ updatedAt: 2000, deleted: true, recordings: [rec('old', 5)] }));
    const back = sess({ updatedAt: 7000, recordings: [rec('pc', 20)] });
    expect(await applyRemote({ table: 'speechSessions', record: back })).toBe(true);
    expect(await stored()).toEqual(back);
    expect(await outbox()).toEqual([]);
  });

  it('a session this device never had is stored as it came', async () => {
    const remote = sess({ updatedAt: 5000, recordings: [rec('pc', 20)] });
    expect(await applyRemote({ table: 'speechSessions', record: remote })).toBe(true);
    expect(await stored()).toEqual(remote);
    expect(await outbox()).toEqual([]);
  });

  it('converges after one round trip: both devices hold the same list and nothing is written again', async () => {
    // Device A (iPhone): recorded offline.
    await seedLocal(sess({ updatedAt: 2000, recordings: [rec('a', 10), rec('iphone', 30)] }));
    const fromPc = sess({ updatedAt: 5000, notes: 'do PC', recordings: [rec('a', 10), rec('pc', 20)] });
    await applyRemote({ table: 'speechSessions', record: fromPc });
    const union = await stored();
    expect(union.recordings.map((r) => r.hash)).toEqual(['a', 'pc', 'iphone']);
    // The server echoes A's own union back: nothing changes.
    await db.outbox.clear();
    expect(await applyRemote({ table: 'speechSessions', record: union })).toBe(false);
    expect(await stored()).toEqual(union);
    expect(await outbox()).toEqual([]);

    // Device B (PC) receives A's union over its own version: stored untouched, nothing queued.
    await db.speechSessions.clear();
    await seedLocal(fromPc);
    expect(await applyRemote({ table: 'speechSessions', record: union })).toBe(true);
    expect(await stored()).toEqual(union);
    expect(await outbox()).toEqual([]);
  });

  it('another table is unchanged: whole-record last-write-wins, nothing queued', async () => {
    const note = (p: Partial<Note>) => ({
      id: 'n1', createdAt: 1000, updatedAt: 1000, deleted: false, type: 'basic', front: 'f', back: 'b', draft: false, ...p,
    }) as Note & Record<string, unknown>;
    await db.notes.put(note({ updatedAt: 2000, extra: 'local' }));
    const remote = note({ updatedAt: 5000, front: 'remota' });
    expect(await applyRemote({ table: 'notes', record: remote })).toBe(true);
    expect(await db.notes.get('n1')).toEqual(remote);
    expect(await applyRemote({ table: 'notes', record: note({ updatedAt: 4000, front: 'velha' }) })).toBe(false);
    expect(await db.notes.get('n1')).toEqual(remote);
    expect(await outbox()).toEqual([]);
  });
});

describe('sync client: the merged session reaches the server in the same sync', () => {
  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

  it('pushes the union right away, then stops (no ping-pong)', async () => {
    await setMeta('syncToken', 'tok');
    await seedLocal(sess({ updatedAt: 2000, recordings: [rec('iphone', 30)] }));
    const fromPc = sess({ updatedAt: 5000, notes: 'do PC', recordings: [rec('pc', 20)] });
    const bodies: SyncRequest[] = [];
    let cursor = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      if (url !== '/api/sync') return { ok: false, status: 404, json: async () => ({}) };
      const body = JSON.parse(init.body) as SyncRequest;
      bodies.push(body);
      cursor += 1;
      // First round: the PC's version arrives. Later rounds: the server echoes what this device pushed.
      return json({ cursor, changes: cursor === 1 ? [{ table: 'speechSessions', record: fromPc }] : body.changes });
    }));
    expect(await syncNow()).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.changes).toEqual([]);
    expect(bodies[1]!.changes).toHaveLength(1);
    const pushed = bodies[1]!.changes[0]!.record as unknown as SpeechSession;
    expect(pushed.recordings.map((r) => r.hash)).toEqual(['pc', 'iphone']);
    expect(pushed.notes).toBe('do PC');
    expect(await db.outbox.count()).toBe(0);
    expect(await syncNow()).toBe(true);
    expect(bodies).toHaveLength(3);
    expect(bodies[2]!.changes).toEqual([]);
  });
});
