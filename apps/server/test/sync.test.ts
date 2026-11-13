import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { Hub } from '../src/hub';
import { RecordStore } from '../src/store';
import type { ServerConfig } from '../src/config';

const cfg: ServerConfig = { port: 0, host: '127.0.0.1', dataDir: '.', token: 't', dbPath: ':memory:' };
const auth = { authorization: 'Bearer t' };
const mission = (id: string, updatedAt = 10) => ({
  table: 'missions',
  record: { id, createdAt: 1, updatedAt, deleted: false, title: 'x' },
});

async function make(hub = new Hub()): Promise<{ app: FastifyInstance; hub: Hub }> {
  const app = await buildApp(cfg, { store: new RecordStore(':memory:'), hub });
  return { app, hub };
}

describe('sync API', () => {
  it('health works without auth', async () => {
    const { app } = await make();
    const res = await app.inject({ url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, rev: 0 });
  });

  it('requires auth', async () => {
    const { app } = await make();
    const res = await app.inject({ method: 'POST', url: '/api/sync', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized' });
    expect((await app.inject({ url: '/api/stream' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/stream?token=bad' })).statusCode).toBe(401);
  });

  it('syncs between devices', async () => {
    const { app } = await make();
    const a = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'A', cursor: 0, changes: [mission('m1')] },
    });
    expect(a.statusCode).toBe(200);
    expect(a.json().cursor).toBeGreaterThanOrEqual(1);
    expect(a.json().changes).toHaveLength(1);
    const b = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'B', cursor: 0, changes: [] },
    });
    expect(b.json().changes[0].record).toMatchObject({ id: 'm1', title: 'x' });
  });

  it('syncs a blocks record between devices', async () => {
    const { app } = await make();
    const block = {
      table: 'blocks',
      record: { id: 'b1', createdAt: 1, updatedAt: 10, deleted: false, name: 'Tech', weekdays: [1, 2] },
    };
    const a = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'A', cursor: 0, changes: [block] },
    });
    expect(a.statusCode).toBe(200);
    const b = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'B', cursor: 0, changes: [] },
    });
    expect(b.json().changes[0]).toMatchObject({ table: 'blocks', record: { id: 'b1', name: 'Tech' } });
  });

  it('rejects invalid table', async () => {
    const { app } = await make();
    const res = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'A', cursor: 0, changes: [{ ...mission('m1'), table: 'nope' }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('publishes only when something was accepted', async () => {
    const published: number[] = [];
    const hub = new Hub();
    hub.subscribe((r) => published.push(r));
    const { app } = await make(hub);
    const push = (changes: unknown[]) =>
      app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'A', cursor: 0, changes } });
    await push([mission('m1', 10)]);
    expect(published).toEqual([1]);
    await push([mission('m1', 5)]);
    expect(published).toEqual([1]);
    await push([]);
    expect(published).toEqual([1]);
  });
});

describe('Hub', () => {
  it('subscribes, publishes and unsubscribes', () => {
    const hub = new Hub();
    const got: number[] = [];
    const off = hub.subscribe((r) => got.push(r));
    expect(hub.size()).toBe(1);
    hub.publish(3);
    off();
    hub.publish(4);
    expect(got).toEqual([3]);
    expect(hub.size()).toBe(0);
  });
});

describe('static serving', () => {
  it('serves files, SPA fallback and JSON 404 for api', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'web-'));
    writeFileSync(join(dir, 'index.html'), '<html>app</html>');
    writeFileSync(join(dir, 'sw.js'), '//sw');
    const app = await buildApp({ ...cfg, webDir: dir }, { store: new RecordStore(':memory:') });
    const sw = await app.inject({ url: '/sw.js' });
    expect(sw.statusCode).toBe(200);
    expect(sw.headers['cache-control']).toBe('no-cache');
    const spa = await app.inject({ url: '/missao/123' });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain('app');
    const api = await app.inject({ url: '/api/nope', headers: auth });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: 'not_found' });
  });
});

describe('auth on encoded paths', () => {
  it('percent-encoded /api paths never bypass auth', async () => {
    const store = new RecordStore(':memory:');
    const app = await buildApp(cfg, { store });
    const body = { deviceId: 'A', cursor: 0, changes: [mission('evil')] };
    for (const url of ['/%61pi/sync', '/ap%69/sync', '/%61%70%69/sync', '/api/%73ync']) {
      const res = await app.inject({ method: 'POST', url, payload: body });
      expect([401, 404], url).toContain(res.statusCode);
    }
    expect(store.currentRev()).toBe(0);
    expect(store.since(0).changes).toHaveLength(0);
    for (const url of ['/%61pi/push/key', '/%61pi/stream', '/ap%69/stream?token=bad']) {
      const res = await app.inject({ url });
      expect([401, 404], url).toContain(res.statusCode);
    }
    await app.close();
  });

  it('a wrong token of any length is rejected and the right one works', async () => {
    const { app } = await make();
    for (const authorization of ['Bearer ', 'Bearer x', 'Bearer tt', 'bearer t', 't']) {
      const res = await app.inject({ method: 'POST', url: '/api/sync', headers: { authorization }, payload: {} });
      expect(res.statusCode, authorization).toBe(401);
    }
    const ok = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'A', cursor: 0, changes: [] },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('unknown /api paths are a JSON 404 only after auth', async () => {
    const { app } = await make();
    const anon = await app.inject({ url: '/api/nope' });
    expect([401, 404]).toContain(anon.statusCode);
    expect(anon.headers['content-type']).toContain('application/json');
    const authed = await app.inject({ url: '/api/nope', headers: auth });
    expect(authed.statusCode).toBe(404);
    expect(authed.json()).toEqual({ error: 'not_found' });
  });
});

describe('cursor ahead of the server (restored backup)', () => {
  it('answers reset without applying the pushed changes', async () => {
    const store = new RecordStore(':memory:');
    const app = await buildApp(cfg, { store });
    const seed = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'A', cursor: 0, changes: [mission('m1')] },
    });
    expect(seed.json().cursor).toBe(1);
    const res = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'B', cursor: 50, changes: [mission('m2')] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cursor: 0, changes: [], reset: true });
    expect(store.currentRev()).toBe(1);
    expect(store.since(0).changes.map((c) => c.record.id)).toEqual(['m1']);
    // A cursor equal to the current rev is normal.
    const same = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'A', cursor: 1, changes: [] },
    });
    expect(same.json()).toEqual({ cursor: 1, changes: [] });
  });
});

describe('SSE stream', () => {
  it('an open stream does not block app.close()', async () => {
    const { get } = await import('node:http');
    const { app } = await make();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const req = get(`http://127.0.0.1:${port}/api/stream?token=t`);
    const firstChunk = await new Promise<string>((resolve, reject) => {
      req.on('response', (res) => res.once('data', (d: Buffer) => resolve(d.toString())));
      req.on('error', reject);
    });
    expect(firstChunk).toContain('event: hello');
    req.on('error', () => {}); // the server ending the stream may surface as a socket error
    const started = Date.now();
    const closed = await Promise.race([
      app.close().then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 1000)),
    ]);
    req.destroy();
    expect(closed).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('syncs the study tables (decks, notes, cards, reviews) including a soft-deleted review', async () => {
    const { app } = await make();
    const rec = (table: string, id: string, extra: Record<string, unknown> = {}) => ({
      table, record: { id, createdAt: 1, updatedAt: 10, deleted: false, ...extra },
    });
    const push = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'a', cursor: 0, changes: [
        rec('decks', 'd1', { name: 'SQL', order: 0, archived: false }),
        rec('notes', 'n1', { deckId: 'd1', type: 'basic', front: 'a', back: 'b', draft: false }),
        rec('cards', 'n1-0', { noteId: 'n1', ord: 0, state: 'new', due: 1 }),
        rec('reviews', 'r1', { cardId: 'n1-0', deleted: true }),
      ] },
    });
    expect(push.statusCode).toBe(200);
    const pull = await app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'b', cursor: 0, changes: [] } });
    const tables = (pull.json() as { changes: Array<{ table: string; record: { deleted: boolean } }> }).changes;
    expect(tables.map((c) => c.table).sort()).toEqual(['cards', 'decks', 'notes', 'reviews']);
    expect(tables.find((c) => c.table === 'reviews')!.record.deleted).toBe(true);
  });

  it('syncs a lousa (sketches) with its strokes, and a soft-deleted one', async () => {
    const { app } = await make();
    const strokes = [{ c: 1, w: 0, p: [0, 0, 10.5, 3.2] }];
    const push = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'a', cursor: 0, changes: [
        { table: 'sketches', record: { id: 's1', createdAt: 1, updatedAt: 10, deleted: false, title: 'Lista 3', strokes } },
        { table: 'sketches', record: { id: 'sketch-m-m1', createdAt: 1, updatedAt: 10, deleted: true, title: '', missionId: 'm1', strokes: [] } },
      ] },
    });
    expect(push.statusCode).toBe(200);
    const pull = await app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'b', cursor: 0, changes: [] } });
    const changes = (pull.json() as { changes: Array<{ table: string; record: { id: string; deleted: boolean } }> }).changes;
    expect(changes.find((c) => c.record.id === 's1')).toMatchObject({ table: 'sketches', record: { title: 'Lista 3', strokes } });
    expect(changes.find((c) => c.record.id === 'sketch-m-m1')!.record.deleted).toBe(true);
  });
});
