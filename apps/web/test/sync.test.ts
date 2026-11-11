import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mission, SyncRequest } from '@life/shared';
import { db } from '../src/db/db';
import { getMeta, newRecord, patch, put, setMeta } from '../src/db/repo';
import { setSyncToken, syncNow } from '../src/sync/client';
import { useSyncStatus } from '../src/sync/status';

beforeEach(async () => {
  await db.delete(); await db.open();
  useSyncStatus.setState({ state: 'disabled', pending: 0, error: undefined });
});
afterEach(() => { vi.unstubAllGlobals(); });

const mk = (title = 'x') => newRecord<Mission>({ title, checklist: [], status: 'open', important: false, shrunk: false, postponeCount: 0 });
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('sync client', () => {
  it('is disabled without a token', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    await syncNow();
    expect(f).not.toHaveBeenCalled();
    expect(useSyncStatus.getState().state).toBe('disabled');
  });

  it('pushes outbox, applies remote, stores cursor, clears outbox', async () => {
    await setMeta('syncToken', 'tok');
    const local = await put('missions', mk('local'));
    const remote = { ...mk('remote'), id: 'remote1', updatedAt: 5000, createdAt: 5000 };
    const f = vi.fn(async (_url: string, init: { body: string; headers: Record<string, string> }) => {
      const body = JSON.parse(init.body) as SyncRequest;
      expect(init.headers.Authorization).toBe('Bearer tok');
      expect(body.cursor).toBe(0);
      expect(body.changes.map((c) => c.record.id)).toEqual([local.id]);
      return json({ cursor: 7, changes: [{ table: 'missions', record: remote }] });
    });
    vi.stubGlobal('fetch', f);
    await syncNow();
    expect(f).toHaveBeenCalledWith('/api/sync', expect.anything());
    expect(await db.outbox.count()).toBe(0);
    expect((await db.missions.get('remote1'))!.title).toBe('remote');
    expect(await getMeta('cursor')).toBe(7);
    expect(await getMeta('deviceId')).toBeTruthy();
    const st = useSyncStatus.getState();
    expect(st.state).toBe('idle');
    expect(st.pending).toBe(0);
    expect(st.lastSync).toBeDefined();
  });

  it('keeps a record edited during the request pending', async () => {
    await setMeta('syncToken', 'tok');
    const local = await put('missions', mk('a'));
    vi.stubGlobal('fetch', vi.fn(async () => {
      await patch<Mission>('missions', local.id, { title: 'b' });
      return json({ cursor: 1, changes: [] });
    }));
    await syncNow();
    expect(await db.outbox.count()).toBe(1);
    expect(useSyncStatus.getState().pending).toBe(1);
  });

  it('loops while a page is full', async () => {
    await setMeta('syncToken', 'tok');
    const page = (tag: string, n: number) => Array.from({ length: n }, (_, i) => ({
      table: 'missions', record: { ...mk(), id: `${tag}-${i}`, updatedAt: 10 },
    }));
    const f = vi.fn()
      .mockResolvedValueOnce(json({ cursor: 1, changes: page('a', 5000) }))
      .mockResolvedValueOnce(json({ cursor: 2, changes: page('b', 3) }));
    vi.stubGlobal('fetch', f);
    await syncNow();
    expect(f).toHaveBeenCalledTimes(2);
    expect(await db.missions.count()).toBe(5003);
    expect(await getMeta('cursor')).toBe(2);
  }, 60000);

  it('401 sets error status; network failure sets offline', async () => {
    await setMeta('syncToken', 'bad');
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
    await syncNow();
    expect(useSyncStatus.getState()).toMatchObject({ state: 'error', error: 'Código de acesso inválido' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    await syncNow();
    expect(useSyncStatus.getState().state).toBe('offline');
  });

  it('setSyncToken validates before storing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
    expect(await setSyncToken('nope')).toBe(false);
    expect(await getMeta('syncToken')).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => json({ cursor: 0, changes: [] })));
    expect(await setSyncToken('good')).toBe(true);
    expect(await getMeta('syncToken')).toBe('good');
  });
});
