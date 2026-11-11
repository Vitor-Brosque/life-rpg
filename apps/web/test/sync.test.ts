import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mission, SyncRequest } from '@life/shared';
import { db } from '../src/db/db';
import { getMeta, newRecord, patch, put, setMeta } from '../src/db/repo';
import { setSyncToken, startSync, syncNow } from '../src/sync/client';
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

  it('classifies a JSON parse failure as error, not offline', async () => {
    await setMeta('syncToken', 'tok');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } })));
    await syncNow();
    expect(useSyncStatus.getState()).toMatchObject({ state: 'error', error: 'Falha na sincronização' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('a non-401 HTTP failure is an error', async () => {
    await setMeta('syncToken', 'tok');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 500)));
    await syncNow();
    expect(useSyncStatus.getState()).toMatchObject({ state: 'error', error: 'Erro do servidor (500)' });
    spy.mockRestore();
  });

  it('a trigger during an in-flight request causes a second POST', async () => {
    await setMeta('syncToken', 'tok');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const f = vi.fn(async () => { if (f.mock.calls.length === 1) await gate; return json({ cursor: 1, changes: [] }); });
    vi.stubGlobal('fetch', f);
    const first = syncNow();
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    const second = syncNow();
    release();
    await Promise.all([first, second]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a trigger during the final refreshPending is not lost', async () => {
    await setMeta('syncToken', 'tok');
    const f = vi.fn(async () => json({ cursor: 1, changes: [] }));
    vi.stubGlobal('fetch', f);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const realCount = db.outbox.count.bind(db.outbox);
    let n = 0;
    const spy = vi.spyOn(db.outbox, 'count').mockImplementation((async () => {
      if (n++ === 0) await gate;
      return realCount();
    }) as typeof db.outbox.count);
    const first = syncNow();
    await vi.waitFor(() => expect(n).toBe(1)); // run is parked inside refreshPending
    const second = syncNow();
    release();
    await Promise.all([first, second]);
    expect(f).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('offline when navigator.onLine is false', async () => {
    await setMeta('syncToken', 'tok');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await syncNow();
    expect(useSyncStatus.getState().state).toBe('offline');
    vi.restoreAllMocks();
    spy.mockRestore();
  });

  it('setSyncToken returns invalid / offline / ok and stores only on ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
    expect(await setSyncToken('nope')).toBe('invalid');
    expect(await getMeta('syncToken')).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    expect(await setSyncToken('nope')).toBe('offline');
    expect(await getMeta('syncToken')).toBeUndefined();
    const f = vi.fn(async () => json({ cursor: 0, changes: [] }));
    vi.stubGlobal('fetch', f);
    const heard = vi.fn();
    window.addEventListener('life-rpg:token', heard);
    expect(await setSyncToken('good')).toBe('ok');
    window.removeEventListener('life-rpg:token', heard);
    expect(await getMeta('syncToken')).toBe('good');
    expect(heard).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(f.mock.calls.length).toBeGreaterThanOrEqual(2)); // validation + syncNow
  });
});

class FakeES {
  static instances: FakeES[] = [];
  readyState = 1;
  closed = false;
  listeners = new Map<string, Array<() => void>>();
  constructor(public url: string) { FakeES.instances.push(this); }
  addEventListener(t: string, cb: () => void): void { this.listeners.set(t, [...(this.listeners.get(t) ?? []), cb]); }
  close(): void { this.closed = true; this.readyState = 2; }
  emit(t: string): void { for (const cb of this.listeners.get(t) ?? []) cb(); }
}

describe('startSync', () => {
  beforeEach(() => { FakeES.instances = []; });
  afterEach(() => { vi.useRealTimers(); });

  const realSetTimeout = globalThis.setTimeout;
  // fake-indexeddb schedules with timers too, so let real time pass between small fake steps.
  const flush = async (ms: number, step = 50) => {
    for (let left = ms; left > 0; left -= step) {
      await vi.advanceTimersByTimeAsync(Math.min(step, left));
      await new Promise((r) => { realSetTimeout(r, 3); });
    }
  };
  const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });

  it('debounces local changes by 1s and stops everything on cleanup', async () => {
    await setMeta('syncToken', 'tok');
    const f = vi.fn(async () => json({ cursor: 1, changes: [] }));
    vi.stubGlobal('fetch', f);
    vi.stubGlobal('EventSource', FakeES);
    fake();
    const stop = startSync();
    await flush(10);
    const initial = f.mock.calls.length;
    expect(initial).toBe(1);
    expect(FakeES.instances).toHaveLength(1);
    expect(FakeES.instances[0]!.url).toContain('token=tok');

    await put('missions', mk('local'));
    await flush(900);
    expect(f.mock.calls.length).toBe(initial);
    await flush(200);
    expect(f.mock.calls.length).toBe(initial + 1);

    stop();
    expect(FakeES.instances[0]!.closed).toBe(true);
    const after = f.mock.calls.length;
    await put('missions', mk('later'));
    window.dispatchEvent(new Event('online'));
    await flush(70_000, 5000);
    expect(f.mock.calls.length).toBe(after);
  });

  it('retries with doubling delay only on failed retries', async () => {
    await setMeta('syncToken', 'tok');
    const f = vi.fn(async () => { throw new TypeError('network'); });
    vi.stubGlobal('fetch', f);
    vi.stubGlobal('EventSource', FakeES);
    fake();
    const stop = startSync();
    await flush(10);
    expect(f).toHaveBeenCalledTimes(1);
    // An ordinary trigger failing must not escalate the delay.
    window.dispatchEvent(new Event('online'));
    await flush(10);
    expect(f).toHaveBeenCalledTimes(2);
    await flush(2100);
    expect(f).toHaveBeenCalledTimes(3); // first retry after 2s
    await flush(3800);
    expect(f).toHaveBeenCalledTimes(3); // next retry waits 4s
    await flush(300);
    expect(f).toHaveBeenCalledTimes(4);
    stop();
  });

  it('reopens a closed EventSource and reacts to a new token', async () => {
    await setMeta('syncToken', 'tok');
    vi.stubGlobal('fetch', vi.fn(async () => json({ cursor: 1, changes: [] })));
    vi.stubGlobal('EventSource', FakeES);
    fake();
    const stop = startSync();
    await flush(10);
    const es = FakeES.instances[0]!;
    es.readyState = 2;
    es.emit('error');
    await flush(2100);
    expect(FakeES.instances).toHaveLength(2);
    await setMeta('syncToken', 'tok2');
    window.dispatchEvent(new Event('life-rpg:token'));
    await flush(10);
    expect(FakeES.instances).toHaveLength(3);
    expect(FakeES.instances[2]!.url).toContain('token=tok2');
    expect(FakeES.instances[1]!.closed).toBe(true);
    stop();
  });
});
