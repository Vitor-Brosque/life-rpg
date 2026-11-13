import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { MEDIA_MAX_BYTES } from '@life/shared';
import { buildApp } from '../src/app';
import type { ServerConfig } from '../src/config';
import { MediaStore, backupMedia } from '../src/media';
import { RecordStore } from '../src/store';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'liferpg-media-')); dirs.push(d); return d; };
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const webp = (n = 32) => { const b = Buffer.alloc(n, 7); b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); return b; };
const auth = { authorization: 'Bearer t' };
const bin = { ...auth, 'content-type': 'application/octet-stream' };

async function make(): Promise<{ app: FastifyInstance; dir: string }> {
  const dir = tmp();
  const cfg: ServerConfig = { port: 0, host: '127.0.0.1', dataDir: dir, token: 't', dbPath: ':memory:' };
  return { app: await buildApp(cfg, { store: new RecordStore(':memory:') }), dir };
}

describe('media API', () => {
  it('stores a file once and serves it with immutable cache headers', async () => {
    const { app, dir } = await make();
    const body = webp();
    const h = sha(body);
    expect((await app.inject({ method: 'PUT', url: `/api/media/${h}`, headers: bin, payload: body })).statusCode).toBe(204);
    expect((await app.inject({ method: 'PUT', url: `/api/media/${h}`, headers: bin, payload: body })).statusCode).toBe(204);
    expect(readdirSync(join(dir, 'media'))).toEqual([h]);
    const get = await app.inject({ url: `/api/media/${h}`, headers: auth });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/webp');
    expect(get.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(get.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(get.rawPayload, body)).toBe(0);
  });

  it('refuses bad hashes, mismatches, unknown formats, empty and oversized bodies', async () => {
    const { app, dir } = await make();
    const body = webp();
    const text = Buffer.from('<html><script>alert(1)</script></html>');
    const cases: Array<[string, Buffer, number, string]> = [
      ['ABC', body, 400, 'invalid_hash'],
      ['a'.repeat(64), body, 400, 'hash_mismatch'],
      [sha(text), text, 415, 'unsupported_type'],
      [sha(Buffer.alloc(0)), Buffer.alloc(0), 400, 'empty'],
    ];
    for (const [h, payload, status, error] of cases) {
      const res = await app.inject({ method: 'PUT', url: `/api/media/${h}`, headers: bin, payload });
      expect(res.statusCode, h).toBe(status);
      expect(res.json()).toEqual({ error });
    }
    const big = webp(MEDIA_MAX_BYTES + 1);
    expect((await app.inject({ method: 'PUT', url: `/api/media/${sha(big)}`, headers: bin, payload: big })).statusCode).toBe(413);
    const json = await app.inject({ method: 'PUT', url: `/api/media/${sha(body)}`, headers: { ...auth, 'content-type': 'application/json' }, payload: '{}' });
    expect(json.statusCode).toBe(415);
    const typed = await app.inject({ method: 'PUT', url: `/api/media/${sha(body)}`, headers: { ...auth, 'content-type': 'image/webp' }, payload: body });
    expect(typed.statusCode).toBe(415);
    expect(existsSync(join(dir, 'media'))).toBe(false);
  });

  it('accepts more than the 5 MB of sync requests, up to 8 MiB', async () => {
    const { app } = await make();
    const body = webp(6 * 1024 * 1024);
    expect((await app.inject({ method: 'PUT', url: `/api/media/${sha(body)}`, headers: bin, payload: body })).statusCode).toBe(204);
  });

  it('needs the token; GET answers 404 and 400', async () => {
    const { app } = await make();
    const body = webp();
    const noAuth = await app.inject({ method: 'PUT', url: `/api/media/${sha(body)}`, headers: { 'content-type': 'application/octet-stream' }, payload: body });
    expect(noAuth.statusCode).toBe(401);
    expect((await app.inject({ url: `/api/media/${sha(body)}` })).statusCode).toBe(401);
    const missing = await app.inject({ url: `/api/media/${'b'.repeat(64)}`, headers: auth });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not_found' });
    expect((await app.inject({ url: '/api/media/..%2F..%2Ftoken', headers: auth })).statusCode).toBe(400);
  });
});

describe('MediaStore and backupMedia', () => {
  it('lists only hash-named files and mirrors new ones without deleting', () => {
    const dir = tmp();
    const store = new MediaStore(join(dir, 'media'));
    expect(store.list()).toEqual([]);
    const a = webp(40);
    const b = webp(41);
    expect(store.put(sha(a), a)).toBe('created');
    expect(store.put(sha(a), a)).toBe('exists');
    writeFileSync(join(dir, 'media', '.junk.tmp'), 'x');
    expect(store.list()).toEqual([sha(a)]);
    const target = join(dir, 'backups', 'media');
    expect(backupMedia(join(dir, 'media'), target)).toBe(1);
    expect(backupMedia(join(dir, 'media'), target)).toBe(0);
    store.put(sha(b), b);
    rmSync(join(dir, 'media', sha(a)));
    expect(backupMedia(join(dir, 'media'), target)).toBe(1);
    expect(readdirSync(target).sort()).toEqual([sha(a), sha(b)].sort());
    expect(statSync(join(target, sha(b))).size).toBe(41);
    expect(backupMedia(join(dir, 'nothing'), target)).toBe(0);
  });
});
