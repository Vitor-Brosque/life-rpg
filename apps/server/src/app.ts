import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { SYNC_TABLES, type SyncChange, type SyncResponse } from '@life/shared';
import type { ServerConfig } from './config';
import { Hub } from './hub';
import { PushService } from './push';
import { RecordStore } from './store';

export interface BuildDeps {
  store?: RecordStore;
  hub?: Hub;
  push?: PushService;
  now?: () => number;
}

const subscribeBody = z.object({
  endpoint: z.string().min(1).max(2048),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }),
});

const scheduleBody = z.object({
  tag: z.string().min(1).max(100),
  at: z.number().int(),
  title: z.string().max(120),
  body: z.string().max(300),
});

const syncBody = z.object({
  deviceId: z.string().max(64),
  cursor: z.number().int().min(0),
  changes: z
    .array(
      z.object({
        table: z.enum(SYNC_TABLES),
        record: z
          .object({
            id: z.string().max(64),
            updatedAt: z.number().int(),
            deleted: z.boolean(),
            createdAt: z.number().int(),
          })
          .passthrough(),
      }),
    )
    .max(2000),
});

/** Constant-time string comparison (different lengths are simply unequal). */
function safeEqual(given: string | undefined, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function buildApp(cfg: ServerConfig, deps: BuildDeps = {}): Promise<FastifyInstance> {
  const store = deps.store ?? new RecordStore(cfg.dbPath);
  const hub = deps.hub ?? new Hub();
  const push = deps.push ?? new PushService(store, cfg.dataDir);
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024 });

  // Open SSE responses: ended on close, otherwise they keep the server from shutting down.
  const streams = new Set<ServerResponse>();
  app.addHook('preClose', async () => {
    for (const res of streams) res.end();
    streams.clear();
  });
  app.addHook('onClose', async () => {
    if (!deps.store) store.close();
  });

  app.get('/api/health', async () => ({ ok: true, rev: store.currentRev() }));

  // Every other API route lives in this encapsulated plugin, so the auth hook is bound to the
  // matched routes (and the /api 404 handler) instead of the raw, still percent-encoded URL.
  await app.register(async (api) => {
    api.addHook('onRequest', async (request, reply) => {
      let ok = safeEqual(request.headers.authorization, `Bearer ${cfg.token}`);
      if (!ok && request.routeOptions.url === '/api/stream') {
        ok = safeEqual((request.query as { token?: string }).token, cfg.token);
      }
      if (!ok) return reply.code(401).send({ error: 'unauthorized' });
    });
    api.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }));
    registerApiRoutes(api, { store, hub, push, streams });
  }, { prefix: '/api' });

  if (cfg.webDir && existsSync(cfg.webDir)) {
    await app.register(fastifyStatic, {
      root: cfg.webDir,
      setHeaders: (res, path) => {
        if (/(^|[\\/])(sw\.js|index\.html)$/.test(path)) res.header('cache-control', 'no-cache');
      },
    });
    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split('?')[0]!;
      if (request.method === 'GET' && !path.startsWith('/api')) {
        return reply.header('cache-control', 'no-cache').type('text/html').sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found' });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }));
  }

  return app;
}

/** Authenticated routes; paths are relative to the '/api' prefix. */
function registerApiRoutes(
  app: FastifyInstance,
  { store, hub, push, streams }: {
    store: RecordStore; hub: Hub; push: PushService; streams: Set<ServerResponse>;
  },
): void {
  app.post('/sync', async (request, reply) => {
    const parsed = syncBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const { cursor, changes } = parsed.data;
    // The device has seen revisions this database never had (it was restored from a backup):
    // it must start over from 0 and resend everything, so its pushed changes are not applied now.
    if (cursor > store.currentRev()) return { cursor: 0, changes: [], reset: true } satisfies SyncResponse;
    const { accepted, rev } = store.apply(changes as SyncChange[]);
    if (accepted > 0) hub.publish(rev);
    return store.since(cursor);
  });

  app.get('/push/key', async () => ({ key: push.publicKey() }));

  app.post('/push/subscribe', async (request, reply) => {
    const parsed = subscribeBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    push.subscribe(parsed.data);
    return reply.code(204).send();
  });

  app.post('/push/schedule', async (request, reply) => {
    const parsed = scheduleBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    push.schedule(parsed.data);
    return reply.code(204).send();
  });

  app.delete('/push/schedule/:tag', async (request, reply) => {
    push.cancel((request.params as { tag: string }).tag);
    return reply.code(204).send();
  });

  app.get('/stream', (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: string, rev: number) =>
      res.write(`event: ${event}\ndata: {"rev":${rev}}\n\n`);
    send('hello', store.currentRev());
    const unsubscribe = hub.subscribe((rev) => send('changed', rev));
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    streams.add(res);
    request.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
      streams.delete(res);
    });
  });
}
