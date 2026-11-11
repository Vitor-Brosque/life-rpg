import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PushService, vapidSubject, type PushSender, type PushSubscriptionJSON } from '../src/push';
import { RecordStore } from '../src/store';
import { buildApp } from '../src/app';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'liferpg-push-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const sub = (n: number): PushSubscriptionJSON => ({
  endpoint: `https://push.example/${n}`,
  keys: { p256dh: 'p', auth: 'a' },
});

function setup() {
  const sent: { endpoint: string; payload: string }[] = [];
  const goneEndpoints = new Set<string>();
  const sender: PushSender = {
    async send(s, payload) {
      sent.push({ endpoint: s.endpoint, payload });
      return { gone: goneEndpoints.has(s.endpoint) };
    },
  };
  let t = 1000;
  const store = new RecordStore(':memory:');
  const svc = new PushService(store, tmp(), sender, () => t);
  return { sent, goneEndpoints, svc, store, setNow: (n: number) => (t = n) };
}

describe('PushService', () => {
  it('sends only due pushes to every subscription', async () => {
    const { svc, sent } = setup();
    svc.subscribe(sub(1));
    svc.subscribe(sub(2));
    svc.schedule({ tag: 'due', at: 900, title: 'T', body: 'B' });
    svc.schedule({ tag: 'later', at: 5000, title: 'T2', body: 'B2' });
    expect(await svc.tick()).toBe(1);
    expect(sent).toHaveLength(2);
    expect(JSON.parse(sent[0]!.payload)).toEqual({ title: 'T', body: 'B', tag: 'due' });
    expect(await svc.tick()).toBe(0);
  });

  it('leaves future push and sends it once due', async () => {
    const { svc, sent, setNow } = setup();
    svc.subscribe(sub(1));
    svc.schedule({ tag: 'later', at: 5000, title: 'x', body: 'y' });
    await svc.tick();
    expect(sent).toHaveLength(0);
    setNow(5000);
    expect(await svc.tick()).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it('replaces by tag and cancels', async () => {
    const { svc, sent } = setup();
    svc.subscribe(sub(1));
    svc.schedule({ tag: 'a', at: 10, title: 'old', body: 'b' });
    svc.schedule({ tag: 'a', at: 10, title: 'new', body: 'b' });
    svc.schedule({ tag: 'c', at: 10, title: 'gone', body: 'b' });
    svc.cancel('c');
    expect(await svc.tick()).toBe(1);
    expect(JSON.parse(sent[0]!.payload).title).toBe('new');
  });

  it('deletes gone subscriptions', async () => {
    const { svc, sent, goneEndpoints } = setup();
    svc.subscribe(sub(1));
    svc.subscribe(sub(1)); // upsert, no duplicate
    goneEndpoints.add(sub(1).endpoint);
    svc.schedule({ tag: 'a', at: 10, title: 't', body: 'b' });
    await svc.tick();
    expect(sent).toHaveLength(1);
    svc.schedule({ tag: 'b', at: 10, title: 't', body: 'b' });
    await svc.tick();
    expect(sent).toHaveLength(1);
  });

  it('drops pushes more than 10 minutes past due without sending them', async () => {
    const { svc, sent, store, setNow } = setup();
    svc.subscribe(sub(1));
    setNow(1_000_000);
    svc.schedule({ tag: 'stale', at: 1_000_000 - 10 * 60_000 - 1, title: 'old', body: 'b' });
    svc.schedule({ tag: 'edge', at: 1_000_000 - 10 * 60_000, title: 'edge', body: 'b' });
    expect(await svc.tick()).toBe(1);
    expect(sent.map((x) => JSON.parse(x.payload).tag)).toEqual(['edge']);
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM push_queue').get()).toEqual({ n: 0 });
  });

  it('a tag rescheduled while another push is being sent survives', async () => {
    const sent: string[] = [];
    let t = 1000;
    const store = new RecordStore(':memory:');
    let svc!: PushService;
    const sender: PushSender = {
      async send(_s, payload) {
        const { tag, title } = JSON.parse(payload) as { tag: string; title: string };
        sent.push(`${tag}:${title}`);
        if (tag === 'a') svc.schedule({ tag: 'b', at: 5000, title: 'moved', body: 'x' });
        return { gone: false };
      },
    };
    svc = new PushService(store, tmp(), sender, () => t);
    svc.subscribe(sub(1));
    svc.schedule({ tag: 'a', at: 900, title: 'first', body: 'x' });
    svc.schedule({ tag: 'b', at: 950, title: 'orig', body: 'x' });
    await svc.tick();
    expect(sent).toEqual(['a:first']);
    t = 5000;
    expect(await svc.tick()).toBe(1);
    expect(sent).toEqual(['a:first', 'b:moved']);
  });

  it('VAPID subject comes from LIFE_RPG_VAPID_SUBJECT', () => {
    expect(vapidSubject({})).toBe('mailto:life-rpg@example.com');
    expect(vapidSubject({ LIFE_RPG_VAPID_SUBJECT: 'mailto:me@home.lan' })).toBe('mailto:me@home.lan');
  });

  it('public key is stable across instances on the same dataDir', () => {
    const dir = tmp();
    const store = new RecordStore(':memory:');
    const a = new PushService(store, dir);
    const b = new PushService(store, dir);
    expect(a.publicKey()).toBeTruthy();
    expect(b.publicKey()).toBe(a.publicKey());
  });
});

describe('push routes', () => {
  it('require auth and work', async () => {
    const store = new RecordStore(':memory:');
    const push = new PushService(store, tmp(), { send: async () => ({ gone: false }) }, () => 0);
    const app = await buildApp(
      { port: 0, host: '127.0.0.1', dataDir: '.', token: 't', dbPath: ':memory:' },
      { store, push },
    );
    const h = { authorization: 'Bearer t' };
    expect((await app.inject({ url: '/api/push/key' })).statusCode).toBe(401);
    const key = await app.inject({ url: '/api/push/key', headers: h });
    expect(key.json()).toEqual({ key: push.publicKey() });
    const s = await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: h, payload: sub(1) });
    expect(s.statusCode).toBe(204);
    const bad = await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: h, payload: { endpoint: 1 } });
    expect(bad.statusCode).toBe(400);
    const sc = await app.inject({
      method: 'POST', url: '/api/push/schedule', headers: h,
      payload: { tag: 'x', at: 1, title: 't', body: 'b' },
    });
    expect(sc.statusCode).toBe(204);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/push/schedule/x', headers: h })).statusCode,
    ).toBe(204);
    expect(
      (await app.inject({
        method: 'POST', url: '/api/push/schedule', headers: h,
        payload: { tag: 'x'.repeat(101), at: 1, title: 't', body: 'b' },
      })).statusCode,
    ).toBe(400);
  });
});
