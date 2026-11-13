import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mission, SyncRequest } from '@life/shared';
import { db } from '../src/db/db';
import { getMeta, importRecords, newRecord, patch, put, setMeta } from '../src/db/repo';
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
    expect(await syncNow()).toBe(true);
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
    expect(await syncNow()).toBe(true);
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

  it('skips changes for tables this version does not know (warning once per table) and applies the rest', async () => {
    await setMeta('syncToken', 'tok');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const remote = { ...mk('remote'), id: 'remote1', updatedAt: 5000, createdAt: 5000 };
    const future = (id: string) => ({ table: 'futureTable', record: { id, createdAt: 1, updatedAt: 1, deleted: false } });
    vi.stubGlobal('fetch', vi.fn(async () => json({
      cursor: 9, changes: [future('f1'), { table: 'missions', record: remote }, future('f2')],
    })));
    expect(await syncNow()).toBe(true);
    expect(useSyncStatus.getState().state).toBe('idle');
    expect((await db.missions.get('remote1'))!.title).toBe('remote');
    expect(await getMeta('cursor')).toBe(9);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('futureTable');
    warn.mockRestore();
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

  it('pushes a large outbox in batches the server accepts (≤ 2000 changes per request)', async () => {
    await setMeta('syncToken', 'tok');
    await importRecords(Array.from({ length: 1500 }, (_, i) => ({
      table: 'missions' as const, record: { ...mk(), id: `m-${String(i).padStart(4, '0')}` },
    })));
    const sizes: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      sizes.push((JSON.parse(init.body) as SyncRequest).changes.length);
      return json({ cursor: 1, changes: [] });
    }));
    await syncNow();
    expect(sizes).toEqual([1000, 500]);
    expect(await db.outbox.count()).toBe(0);
    expect(useSyncStatus.getState()).toMatchObject({ state: 'idle', pending: 0 });
  }, 60000);

  it('401 sets error status; network failure sets offline', async () => {
    await setMeta('syncToken', 'bad');
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
    expect(await syncNow()).toBe(false);
    expect(useSyncStatus.getState()).toMatchObject({ state: 'error', error: 'Código de acesso inválido' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    expect(await syncNow()).toBe(false);
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

  it('on reset (server restored from a backup) resends every local record from cursor 0', async () => {
    await setMeta('syncToken', 'tok');
    const a = await put('missions', mk('a'));
    const b = await put('missions', mk('b'));
    vi.stubGlobal('fetch', vi.fn(async () => json({ cursor: 40, changes: [] })));
    expect(await syncNow()).toBe(true);
    expect(await db.outbox.count()).toBe(0);
    await db.settings.put({
      id: 'settings', createdAt: 1, updatedAt: 123, deleted: false, dayStartHour: 4, dayEndHour: 23,
      pomodoro: { focusMin: 25, breakMin: 5 }, companionMuted: false, commitmentReminderMin: 10,
    }); // a record that came from the server earlier (no outbox entry)

    const bodies: SyncRequest[] = [];
    const f = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as SyncRequest;
      bodies.push(body);
      return body.cursor > 3 ? json({ cursor: 0, changes: [], reset: true }) : json({ cursor: 3, changes: [] });
    });
    vi.stubGlobal('fetch', f);
    expect(await syncNow()).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodies[0]!.cursor).toBe(40);
    expect(bodies[1]!.cursor).toBe(0);
    const sent = new Map(bodies[1]!.changes.map((c) => [`${c.table}:${c.record.id}`, c.record.updatedAt]));
    expect(sent.get(`missions:${a.id}`)).toBe(a.updatedAt);
    expect(sent.get(`missions:${b.id}`)).toBe(b.updatedAt);
    expect(sent.get('settings:settings')).toBe(123);
    expect(sent.size).toBe(3);
    expect(await getMeta('cursor')).toBe(3);
    expect(await db.outbox.count()).toBe(0);
  });

  it('a server that keeps answering reset cannot loop forever', async () => {
    await setMeta('syncToken', 'tok');
    await setMeta('cursor', 9);
    await put('missions', mk('a'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = vi.fn(async () => json({ cursor: 0, changes: [], reset: true }));
    vi.stubGlobal('fetch', f);
    expect(await syncNow()).toBe(false);
    expect(f.mock.calls.length).toBeLessThanOrEqual(3);
    expect(useSyncStatus.getState().state).toBe('error');
    expect(await db.outbox.count()).toBe(1);
    spy.mockRestore();
  });

  it('on 413 halves the push batch within the cycle and goes back to full batches after success', async () => {
    await setMeta('syncToken', 'tok');
    await importRecords(Array.from({ length: 10 }, (_, i) => ({
      table: 'missions' as const, record: { ...mk(), id: `m-${i}` },
    })));
    const sizes: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const n = (JSON.parse(init.body) as SyncRequest).changes.length;
      sizes.push(n);
      return n > 3 ? json({ error: 'too large' }, 413) : json({ cursor: 1, changes: [] });
    }));
    expect(await syncNow()).toBe(true);
    expect(sizes).toEqual([10, 5, 2, 8, 4, 2, 6, 3, 3]);
    expect(await db.outbox.count()).toBe(0);
    expect(useSyncStatus.getState()).toMatchObject({ state: 'idle', pending: 0 });
  });

  it('a single record still too large is an error', async () => {
    await setMeta('syncToken', 'tok');
    await put('missions', mk('huge'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = vi.fn(async () => json({}, 413));
    vi.stubGlobal('fetch', f);
    expect(await syncNow()).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
    expect(useSyncStatus.getState()).toMatchObject({ state: 'error', error: 'Erro do servidor (413)' });
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
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  const realSetTimeout = globalThis.setTimeout;
  // fake-indexeddb schedules with timers too, so let real time pass between small fake steps.
  const flush = async (ms: number, step = 50) => {
    for (let left = ms; left > 0; left -= step) {
      await vi.advanceTimersByTimeAsync(Math.min(step, left));
      await new Promise((r) => { realSetTimeout(r, 3); });
    }
  };
  /**
   * Flushes in small steps until `cond` holds (Dexie reads need real time, which varies under load).
   * Rule for this file: a fixed `flush(T)` only asserts "not before T"; "eventually" always goes through here.
   */
  const flushUntil = async (cond: () => boolean, tries = 100, step = 10) => {
    for (let i = 0; i < tries && !cond(); i++) await flush(step, step);
  };
  /** Waits for something an event (not a timer) causes: real event-loop turns, the fake clock stays put,
   *  so slow I/O under load can't let retry timers fire early. Falls back to advancing time. */
  const settleUntil = async (cond: () => boolean, turns = 2000) => {
    for (let i = 0; i < turns && !cond(); i++) await new Promise<void>((r) => setImmediate(r));
    if (!cond()) await flushUntil(cond);
  };
  const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });

  it('debounces local changes by 1s and stops everything on cleanup', async () => {
    await setMeta('syncToken', 'tok');
    const f = vi.fn(async () => json({ cursor: 1, changes: [] }));
    vi.stubGlobal('fetch', f);
    vi.stubGlobal('EventSource', FakeES);
    fake();
    const stop = startSync();
    await flushUntil(() => f.mock.calls.length > 0 && FakeES.instances.length > 0);
    const initial = f.mock.calls.length;
    expect(initial).toBe(1);
    expect(FakeES.instances).toHaveLength(1);
    expect(FakeES.instances[0]!.url).toContain('token=tok');

    await put('missions', mk('local'));
    await flush(900);
    expect(f.mock.calls.length).toBe(initial);
    await flushUntil(() => f.mock.calls.length > initial, 300);
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
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const retryDelays = () => spy.mock.calls.map((c) => c[1]).filter((ms): ms is number => typeof ms === 'number' && ms >= 2000 && ms <= 16_000);
    const stop = startSync();
    await flushUntil(() => f.mock.calls.length >= 1);
    expect(f).toHaveBeenCalledTimes(1);
    // An ordinary trigger failing must not escalate the delay.
    window.dispatchEvent(new Event('online'));
    await settleUntil(() => f.mock.calls.length >= 2);
    expect(f).toHaveBeenCalledTimes(2);
    // The retry timers armed so far: 2s after the first failure and 2s again after the failed "online" trigger
    // (it re-arms without doubling). Each failed *retry* then doubles: 4s, then 8s.
    await flushUntil(() => f.mock.calls.length >= 3, 300, 50); // the 2s retry
    await flushUntil(() => f.mock.calls.length >= 4, 300, 50); // the 4s retry
    await flushUntil(() => retryDelays().length >= 4, 300, 50);
    expect(retryDelays()).toEqual([2000, 2000, 4000, 8000]);
    stop();
  });

  it('reopens a closed EventSource and reacts to a new token', async () => {
    await setMeta('syncToken', 'tok');
    vi.stubGlobal('fetch', vi.fn(async () => json({ cursor: 1, changes: [] })));
    vi.stubGlobal('EventSource', FakeES);
    fake();
    const stop = startSync();
    await flushUntil(() => FakeES.instances.length > 0);
    const es = FakeES.instances[0]!;
    es.readyState = 2;
    es.emit('error');
    await flush(1900); // the reopen waits 2s
    expect(FakeES.instances).toHaveLength(1);
    await flushUntil(() => FakeES.instances.length >= 2, 300);
    expect(FakeES.instances).toHaveLength(2);
    await setMeta('syncToken', 'tok2');
    window.dispatchEvent(new Event('life-rpg:token'));
    await settleUntil(() => FakeES.instances.length >= 3);
    expect(FakeES.instances).toHaveLength(3);
    expect(FakeES.instances[2]!.url).toContain('token=tok2');
    expect(FakeES.instances[1]!.closed).toBe(true);
    stop();
  });
});
