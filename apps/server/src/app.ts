import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { SYNC_TABLES, type SyncChange } from '@life/shared';
import type { ServerConfig } from './config';
import { Hub } from './hub';
import { RecordStore } from './store';

export interface BuildDeps {
  store?: RecordStore;
  hub?: Hub;
  /** PushService is added in Task 7. */
  push?: unknown;
  now?: () => number;
}

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

export async function buildApp(cfg: ServerConfig, deps: BuildDeps = {}): Promise<FastifyInstance> {
  const store = deps.store ?? new RecordStore(cfg.dbPath);
  const hub = deps.hub ?? new Hub();
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024 });

  app.addHook('onClose', async () => {
    if (!deps.store) store.close();
  });

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    if (!path.startsWith('/api/') || path === '/api/health') return;
    let ok = request.headers.authorization === `Bearer ${cfg.token}`;
    if (!ok && path === '/api/stream') {
      ok = (request.query as { token?: string }).token === cfg.token;
    }
    if (!ok) return reply.code(401).send({ error: 'unauthorized' });
  });

  app.get('/api/health', async () => ({ ok: true, rev: store.currentRev() }));

  app.post('/api/sync', async (request, reply) => {
    const parsed = syncBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const { cursor, changes } = parsed.data;
    const { accepted, rev } = store.apply(changes as SyncChange[]);
    if (accepted > 0) hub.publish(rev);
    return store.since(cursor);
  });

  app.get('/api/stream', (request, reply) => {
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
    request.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

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
