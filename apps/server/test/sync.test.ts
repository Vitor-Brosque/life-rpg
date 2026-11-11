import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { Hub } from '../src/hub';
import { RecordStore } from '../src/store';
import type { ServerConfig } from '../src/config';

const cfg: ServerConfig = { port: 0, dataDir: '.', token: 't', dbPath: ':memory:' };
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
