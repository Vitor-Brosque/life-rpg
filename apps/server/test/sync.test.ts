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

  it('syncs the corpo e casa tables, including a soft-deleted freezer move', async () => {
    const { app } = await make();
    const rec = (table: string, id: string, extra: Record<string, unknown> = {}) => ({
      table, record: { id, createdAt: 1, updatedAt: 10, deleted: false, ...extra },
    });
    const push = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'a', cursor: 0, changes: [
        rec('sleepLogs', 'sleep-2026-11-13', { night: '2026-11-13', bedAt: 5, wakeAt: 9 }),
        rec('recipes', 'r1', { name: 'Frango com arroz', ingredients: ['frango 1 kg'] }),
        rec('menus', 'menu-2026-11-09', { week: '2026-11-09', slots: [{ day: '2026-11-10', meal: 'almoco', recipeId: 'r1' }] }),
        rec('shoppingLists', 'shop-2026-11-09', { week: '2026-11-09', manual: [], checked: ['g:frango 1 kg'] }),
        rec('freezerMoves', 'f1', { at: 5, day: '2026-11-13', recipeId: 'r1', delta: -1, kind: 'eat', deleted: true }),
        rec('workouts', 'w1', { at: 5, day: '2026-11-13', kind: 'cardio', minutes: 10, minimum: true }),
      ] },
    });
    expect(push.statusCode).toBe(200);
    const pull = await app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'b', cursor: 0, changes: [] } });
    const changes = (pull.json() as { changes: Array<{ table: string; record: { id: string; deleted: boolean } }> }).changes;
    expect(changes.map((c) => c.table).sort()).toEqual(['freezerMoves', 'menus', 'recipes', 'shoppingLists', 'sleepLogs', 'workouts']);
    expect(changes.find((c) => c.record.id === 'f1')!.record.deleted).toBe(true);
    expect(changes.find((c) => c.record.id === 'menu-2026-11-09')).toMatchObject({
      record: { slots: [{ day: '2026-11-10', meal: 'almoco', recipeId: 'r1' }] },
    });
  });

  it('a mission lousa placeholder (updatedAt 1) pushed after a real version keeps the real one', async () => {
    const { app } = await make();
    const strokes = [{ c: 0, w: 0, p: [1, 1] }];
    const rec = (updatedAt: number, st: unknown[]) => ({
      table: 'sketches', record: { id: 'sketch-m-m1', createdAt: 1, updatedAt, deleted: false, title: '', missionId: 'm1', strokes: st },
    });
    await app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'a', cursor: 0, changes: [rec(10, strokes)] } });
    await app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'b', cursor: 0, changes: [rec(1, [])] } });
    const pull = await app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'c', cursor: 0, changes: [] } });
    const changes = (pull.json() as { changes: Array<{ record: { id: string; updatedAt: number; strokes: unknown[] } }> }).changes;
    expect(changes.find((c) => c.record.id === 'sketch-m-m1')!.record).toMatchObject({ updatedAt: 10, strokes });
  });

  it('syncs a practice session with its lists and errors, and a soft-deleted one', async () => {
    const { app } = await make();
    const session = {
      id: 'p1', createdAt: 1, updatedAt: 10, deleted: false, title: 'Dedup', status: 'open', step: 'plan',
      problem: 'remover repetidas', inputs: '', outputs: '', basics: [], plan: [{ id: 'a', text: 'normalizar URL', done: false }],
      alternatives: '', decision: '', language: 'python', code: 'x', tests: [], feedback: [],
      errors: [{ id: 'e1', at: 5, what: 'return no for', why: '', fix: 'acumular' }], ratings: { delivered: 1 }, explanation: '',
    };
    const push = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'a', cursor: 0, changes: [
        { table: 'practiceSessions', record: session },
        { table: 'practiceSessions', record: { ...session, id: 'p2', deleted: true } },
      ] },
    });
    expect(push.statusCode).toBe(200);
    const pull = await app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'b', cursor: 0, changes: [] } });
    const changes = (pull.json() as { changes: Array<{ table: string; record: { id: string; deleted: boolean } }> }).changes;
    expect(changes.find((c) => c.record.id === 'p1')).toMatchObject({ table: 'practiceSessions', record: { plan: session.plan, errors: session.errors } });
    expect(changes.find((c) => c.record.id === 'p2')!.record.deleted).toBe(true);
  });

  it('syncs a month reflection (monthReviews), and a soft-deleted one', async () => {
    const { app } = await make();
    const observed = { workdays: 22, activeWorkdays: 17, blocksPlanned: 80, blocksStarted: 48, minimumUsed: 12, resumptions: 2, reviews: 310, practiceClosed: 4, workouts: 14, escapes: 9 };
    const push = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'a', cursor: 0, changes: [
        { table: 'monthReviews', record: { id: 'month-2026-10', createdAt: 1, updatedAt: 10, deleted: false, month: '2026-10', answers: { progress: 'a', obstacle: 'b', next: 'c' }, observed, answeredAt: 10 } },
        { table: 'monthReviews', record: { id: 'month-2026-09', createdAt: 1, updatedAt: 10, deleted: true, month: '2026-09', skipped: true, observed, answeredAt: 10 } },
      ] },
    });
    expect(push.statusCode).toBe(200);
    const pull = await app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'b', cursor: 0, changes: [] } });
    const changes = (pull.json() as { changes: Array<{ table: string; record: { id: string; deleted: boolean } }> }).changes;
    expect(changes.find((c) => c.record.id === 'month-2026-10')).toMatchObject({ table: 'monthReviews', record: { month: '2026-10', observed } });
    expect(changes.find((c) => c.record.id === 'month-2026-09')!.record.deleted).toBe(true);
  });
  it('syncs the acompanhamento tables', async () => {
    const { app } = await make();
    const r = { createdAt: 1, updatedAt: 10, deleted: false };
    const sets = [{ reps: 8, kg: 40 }];
    const blocks = [{ blockId: 'b1', name: 'Estudo', kind: 'study', targetStart: '08:00', durationMin: 60, minimumMin: 10, protected: false, order: 0, createdAt: 1 }];
    const marks = [{ at: 5, level: 'vi' }];
    const push = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'a', cursor: 0, changes: [
        { table: 'trainingPlans', record: { ...r, id: 'plan', days: [{ weekday: 1, name: 'Peito', exercises: ['Supino'] }] } },
        { table: 'trainingLogs', record: { ...r, id: 'training-2026-11-14', day: '2026-11-14', exercises: [{ id: 'p0', name: 'Supino', status: 'feito', sets }] } },
        { table: 'dayPlans', record: { ...r, id: '2026-11-14', day: '2026-11-14', mode: 'normal', takenAt: 9, blocks, commitments: [] } },
        { table: 'problemSets', record: { ...r, id: 'ps1', journeyId: 'j1', day: '2026-11-14', title: 'Lista 1', done: 3 } },
        { table: 'problemSets', record: { ...r, id: 'ps2', deleted: true, journeyId: 'j1', day: '2026-11-14', title: 'Lista 2', done: 1 } },
        { table: 'subjectTopics', record: { ...r, id: 'st1', journeyId: 'j1', name: 'Limites', marks } },
      ] },
    });
    expect(push.statusCode).toBe(200);
    const pull = await app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'b', cursor: 0, changes: [] } });
    const changes = (pull.json() as { changes: Array<{ table: string; record: { id: string; deleted: boolean } }> }).changes;
    expect(changes.find((c) => c.record.id === 'plan')).toMatchObject({ table: 'trainingPlans', record: { days: [{ weekday: 1, name: 'Peito' }] } });
    expect(changes.find((c) => c.record.id === 'training-2026-11-14')).toMatchObject({ table: 'trainingLogs', record: { exercises: [{ sets }] } });
    expect(changes.find((c) => c.record.id === '2026-11-14')).toMatchObject({ table: 'dayPlans', record: { blocks: [{ blockId: 'b1' }] } });
    expect(changes.find((c) => c.record.id === 'ps1')).toMatchObject({ table: 'problemSets', record: { done: 3 } });
    expect(changes.find((c) => c.record.id === 'ps2')!.record.deleted).toBe(true);
    expect(changes.find((c) => c.record.id === 'st1')).toMatchObject({ table: 'subjectTopics', record: { marks } });
  });

  it('syncs diary entries (diaryEntries), and an entry deleted for good as an empty marker', async () => {
    const { app } = await make();
    const r = { createdAt: 1, updatedAt: 10, deleted: false, themes: [], links: [], private: false };
    const push = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'a', cursor: 0, changes: [
        { table: 'diaryEntries', record: { ...r, id: 'diary-close-2026-11-10', day: '2026-11-10', at: 5, kind: 'fechamento', text: 'Dia corrido.', themes: ['familia'], links: [{ kind: 'journey', id: 'j1' }] } },
        { table: 'diaryEntries', record: { ...r, id: 'd2', deleted: true, day: '2026-11-11', at: 6, kind: 'livre', text: '', trashedAt: 7 } },
      ] },
    });
    expect(push.statusCode).toBe(200);
    const pull = await app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'b', cursor: 0, changes: [] } });
    const changes = (pull.json() as { changes: Array<{ table: string; record: { id: string; deleted: boolean; text?: string } }> }).changes;
    expect(changes.find((c) => c.record.id === 'diary-close-2026-11-10')).toMatchObject({
      table: 'diaryEntries', record: { kind: 'fechamento', text: 'Dia corrido.', themes: ['familia'], links: [{ kind: 'journey', id: 'j1' }] },
    });
    expect(changes.find((c) => c.record.id === 'd2')!.record).toMatchObject({ deleted: true, text: '' });
  });

  it('syncs strategies (strategies): a testing one, a trashed decided one and one deleted for good', async () => {
    const { app } = await make();
    const r = { createdAt: 1, updatedAt: 10, deleted: false, source: 'ia', startDay: '2026-11-23', reviewDay: '2026-12-07' };
    const push = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'a', cursor: 0, changes: [
        { table: 'strategies', record: { ...r, id: 's1', title: 'Celular em outro cômodo', sourceNote: 'Claude', status: 'testando', link: { kind: 'block', id: 'b1' } } },
        { table: 'strategies', record: { ...r, id: 's2', title: 'Biblioteca', status: 'mantida', decidedDay: '2026-11-23', decisionNote: 'Funcionou.', trashedAt: 5 } },
        { table: 'strategies', record: { ...r, id: 's3', title: '', status: 'testando', deleted: true } },
      ] },
    });
    expect(push.statusCode).toBe(200);
    const pull = await app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'b', cursor: 0, changes: [] } });
    const changes = (pull.json() as { changes: Array<{ table: string; record: { id: string; deleted: boolean } }> }).changes;
    expect(changes.find((c) => c.record.id === 's1')).toMatchObject({ table: 'strategies', record: { sourceNote: 'Claude', link: { kind: 'block', id: 'b1' } } });
    expect(changes.find((c) => c.record.id === 's2')).toMatchObject({ table: 'strategies', record: { status: 'mantida', trashedAt: 5 } });
    expect(changes.find((c) => c.record.id === 's3')!.record).toMatchObject({ deleted: true, title: '' });
  });

  it('syncs goals and seasons (goals, seasons)', async () => {
    const { app } = await make();
    const r = { createdAt: 1, updatedAt: 10, deleted: false };
    const push = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'a', cursor: 0, changes: [
        { table: 'goals', record: { ...r, id: 'g1', title: 'Carreira em Dados', why: 'Gosto de dados', horizon: '2027', status: 'ativo', order: 0 } },
        { table: 'seasons', record: {
          ...r, id: 'se1', title: 'Consistência', focus: [{ text: 'Tech' }, { link: { kind: 'goal', id: 'g1' } }], startDay: '2026-11-23',
          plannedWeeks: 6, status: 'encerrada', endedDay: '2027-01-03', review: { progress: 'Todo dia', obstacle: '', next: '', answeredAt: 5 },
        } },
      ] },
    });
    expect(push.statusCode).toBe(200);
    const pull = await app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'b', cursor: 0, changes: [] } });
    const changes = (pull.json() as { changes: Array<{ table: string; record: { id: string } }> }).changes;
    expect(changes.find((c) => c.record.id === 'g1')).toMatchObject({ table: 'goals', record: { horizon: '2027', status: 'ativo' } });
    expect(changes.find((c) => c.record.id === 'se1')).toMatchObject({
      table: 'seasons', record: { focus: [{ text: 'Tech' }, { link: { kind: 'goal', id: 'g1' } }], review: { progress: 'Todo dia' } },
    });
  });

  it('syncs speech sessions, situations and programs', async () => {
    const { app } = await make();
    const r = { createdAt: 1, updatedAt: 10, deleted: false };
    const push = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'a', cursor: 0, changes: [
        { table: 'speechSessions', record: {
          ...r, id: 'sp1', day: '2026-11-23', kind: 'leitura', passage: 'feira',
          recordings: [{ hash: 'a'.repeat(64), durationMs: 61000, at: 5, keep: true }], ratings: { clareza: 4 }, closedAt: 9,
        } },
        { table: 'speechSituations', record: { ...r, id: 'si1', day: '2026-11-23', at: 7, context: 'aula', repeats: 0, note: 'Perguntei' } },
        { table: 'speechPrograms', record: {
          ...r, id: 'pr1', startDay: '2026-11-23', week: 3, status: 'ativo',
          phaseNotes: { 1: { text: 'Mais calmo', day: '2026-11-30', answeredAt: 8 } },
        } },
      ] },
    });
    expect(push.statusCode).toBe(200);
    const pull = await app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'b', cursor: 0, changes: [] } });
    const changes = (pull.json() as { changes: Array<{ table: string; record: { id: string } }> }).changes;
    expect(changes.find((c) => c.record.id === 'sp1')).toMatchObject({
      table: 'speechSessions', record: { recordings: [{ durationMs: 61000, keep: true }], ratings: { clareza: 4 }, closedAt: 9 },
    });
    expect(changes.find((c) => c.record.id === 'si1')).toMatchObject({ table: 'speechSituations', record: { context: 'aula', repeats: 0 } });
    expect(changes.find((c) => c.record.id === 'pr1')).toMatchObject({
      table: 'speechPrograms', record: { week: 3, phaseNotes: { 1: { text: 'Mais calmo' } } },
    });
  });

  it('syncs the nutrition tables (foods, nutritionTargets, foodLogs, pantry, weighIns)', async () => {
    const { app } = await make();
    const r = { createdAt: 1, updatedAt: 10, deleted: false };
    const per100 = { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 };
    const push = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'a', cursor: 0, changes: [
        { table: 'foods', record: { ...r, id: 'f1', name: 'Arroz', per100, basis: 'pronto', source: 'tabela', group: 'carboidrato', like: 'gosto', unit: { name: 'colher', grams: 25 } } },
        { table: 'nutritionTargets', record: { ...r, id: 'ntarget-2026-11-25', from: '2026-11-25', byWeekday: Array(7).fill({ protein: 160, carbs: 250, fat: 60 }) } },
        { table: 'foodLogs', record: { ...r, id: 'fl1', day: '2026-11-25', meal: 'almoco', foodId: 'f1', name: 'Arroz', per100, basis: 'pronto', estimate: false, grams: 150, status: 'comido', order: 0 } },
        { table: 'pantry', record: { ...r, id: 'pantry-f1', foodId: 'f1', confirmedDay: '2026-11-25', grams: 350 } },
        { table: 'weighIns', record: { ...r, id: 'w1', day: '2026-11-25', kg: 72.4 } },
        { table: 'weighIns', record: { ...r, id: 'w2', day: '2026-11-24', kg: 72.9, deleted: true } },
      ] },
    });
    expect(push.statusCode).toBe(200);
    const pull = await app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'b', cursor: 0, changes: [] } });
    const changes = (pull.json() as { changes: Array<{ table: string; record: { id: string; deleted: boolean } }> }).changes;
    expect(changes.find((c) => c.record.id === 'f1')).toMatchObject({ table: 'foods', record: { per100, unit: { name: 'colher', grams: 25 } } });
    expect(changes.find((c) => c.record.id === 'ntarget-2026-11-25')).toMatchObject({ table: 'nutritionTargets', record: { from: '2026-11-25' } });
    expect(changes.find((c) => c.record.id === 'fl1')).toMatchObject({ table: 'foodLogs', record: { meal: 'almoco', grams: 150, status: 'comido' } });
    expect(changes.find((c) => c.record.id === 'pantry-f1')).toMatchObject({ table: 'pantry', record: { grams: 350 } });
    expect(changes.find((c) => c.record.id === 'w1')).toMatchObject({ table: 'weighIns', record: { kg: 72.4 } });
    expect(changes.find((c) => c.record.id === 'w2')!.record.deleted).toBe(true);
  });

  it('syncs the caderno tables (subjectNotebooks, studyDocs) and the study profile', async () => {
    const { app } = await make();
    const r = { createdAt: 1, updatedAt: 10, deleted: false };
    const markdown = '# Normalização\n'.repeat(2500);
    const push = await app.inject({
      method: 'POST', url: '/api/sync', headers: auth,
      payload: { deviceId: 'a', cursor: 0, changes: [
        { table: 'subjectNotebooks', record: { ...r, id: 'notebook-bd', journeyId: 'bd', plan: 'Ementa', bibliography: [{ title: 'Sistemas de Banco de Dados', kind: 'basica' }] } },
        { table: 'studyDocs', record: { ...r, id: 'doc1', journeyId: 'bd', title: 'Normalização passo a passo', markdown, source: 'ChatGPT' } },
        { table: 'studyDocs', record: { ...r, id: 'doc2', journeyId: 'bd', title: 'Apagada', markdown: 'x', source: 'Você', deleted: true } },
        { table: 'profile', record: { ...r, id: 'me', name: 'Lia', look: { skin: 0, hair: 0, hairColor: 0, outfit: 0 }, companionName: 'Brasa', onboarded: true, studyProfile: 'Aprendo com exemplos.' } },
      ] },
    });
    expect(push.statusCode).toBe(200);
    const pull = await app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'b', cursor: 0, changes: [] } });
    const changes = (pull.json() as { changes: Array<{ table: string; record: { id: string; deleted: boolean } }> }).changes;
    expect(changes.find((c) => c.record.id === 'notebook-bd')).toMatchObject({ table: 'subjectNotebooks', record: { plan: 'Ementa', bibliography: [{ title: 'Sistemas de Banco de Dados', kind: 'basica' }] } });
    expect(changes.find((c) => c.record.id === 'doc1')).toMatchObject({ table: 'studyDocs', record: { markdown, source: 'ChatGPT' } });
    expect(changes.find((c) => c.record.id === 'doc2')!.record.deleted).toBe(true);
    expect(changes.find((c) => c.record.id === 'me')).toMatchObject({ table: 'profile', record: { studyProfile: 'Aprendo com exemplos.' } });
  });

  it('the same migrated entry pushed by a second device is not a new revision', async () => {
    const { app } = await make();
    const entry = { id: 'diary-close-2026-11-10', createdAt: 9, updatedAt: 9, deleted: false, day: '2026-11-10', at: 5, kind: 'fechamento', text: 'x', themes: [], links: [], private: false };
    const first = await app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'a', cursor: 0, changes: [{ table: 'diaryEntries', record: entry }] } });
    const second = await app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: { deviceId: 'b', cursor: 0, changes: [{ table: 'diaryEntries', record: entry }] } });
    expect(second.json().cursor).toBe(first.json().cursor);
    expect(second.json().changes).toHaveLength(1);
  });
});
