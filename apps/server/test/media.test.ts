import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { MEDIA_MAX_BYTES, PDF_MAX_BYTES, PDF_TEXT_MAX_BYTES, PDF_TEXT_SIGNATURE, encodePdfText } from '@life/shared';
import { buildApp } from '../src/app';
import type { ServerConfig } from '../src/config';
import * as fs from 'node:fs';
import { MediaStore, backupMedia } from '../src/media';
import { RecordStore } from '../src/store';

// Spies over the real fs, so a test can make links or copies fail.
vi.mock('node:fs', async (orig) => {
  const actual = await orig<typeof import('node:fs')>();
  return { ...actual, linkSync: vi.fn(actual.linkSync), copyFileSync: vi.fn(actual.copyFileSync) };
});

const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });
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

  it('HEAD answers 200 for a stored file and 404 for a missing one, with the same auth as GET', async () => {
    const { app } = await make();
    const body = webp();
    const h = sha(body);
    await app.inject({ method: 'PUT', url: `/api/media/${h}`, headers: bin, payload: body });
    expect((await app.inject({ method: 'HEAD', url: `/api/media/${h}`, headers: auth })).statusCode).toBe(200);
    expect((await app.inject({ method: 'HEAD', url: `/api/media/${'b'.repeat(64)}`, headers: auth })).statusCode).toBe(404);
    expect((await app.inject({ method: 'HEAD', url: `/api/media/${h}` })).statusCode).toBe(401);
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

  it('PDFs da aula: a PDF up to 50 MB is accepted and served as a PDF; above, refused; images keep 8 MB', async () => {
    const { app, dir } = await make();
    const pdf = (n: number) => { const b = Buffer.alloc(n, 0x20); b.write('%PDF-1.7 ', 0, 'latin1'); return b; };
    const max = pdf(PDF_MAX_BYTES);
    expect((await app.inject({ method: 'PUT', url: `/api/media/${sha(max)}`, headers: bin, payload: max })).statusCode).toBe(204);
    const get = await app.inject({ url: `/api/media/${sha(max)}`, headers: auth });
    expect(get.headers['content-type']).toBe('application/pdf');
    expect(get.rawPayload.length).toBe(PDF_MAX_BYTES);
    const over = pdf(PDF_MAX_BYTES + 1);
    const refused = await app.inject({ method: 'PUT', url: `/api/media/${sha(over)}`, headers: bin, payload: over });
    expect(refused.statusCode).toBe(413);
    // An image between 8 and 50 MB passes the body limit but not its own.
    const image = webp(MEDIA_MAX_BYTES + 1);
    const img = await app.inject({ method: 'PUT', url: `/api/media/${sha(image)}`, headers: bin, payload: image });
    expect(img.statusCode).toBe(413);
    expect(img.json()).toEqual({ error: 'too_large' });
    expect(readdirSync(join(dir, 'media'))).toEqual([sha(max)]);
  }, 60_000);

  it('the extracted text of a PDF: accepted up to 4 MB, refused above', async () => {
    const { app } = await make();
    const { bytes } = encodePdfText(['Aula 1', 'Aula 2']);
    const body = Buffer.from(bytes);
    expect((await app.inject({ method: 'PUT', url: `/api/media/${sha(body)}`, headers: bin, payload: body })).statusCode).toBe(204);
    const big = Buffer.alloc(PDF_TEXT_MAX_BYTES + 1, 0x61);
    big.write(PDF_TEXT_SIGNATURE, 0, 'latin1');
    const r = await app.inject({ method: 'PUT', url: `/api/media/${sha(big)}`, headers: bin, payload: big });
    expect(r.statusCode).toBe(413);
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
  it('without links it copies aside then renames, and one bad file does not stop the mirror', async () => {
    const dir = tmp();
    const store = new MediaStore(join(dir, 'media'));
    const a = webp(50);
    const b = webp(51);
    store.put(sha(a), a);
    store.put(sha(b), b);
    const real = (await vi.importActual<typeof import('node:fs')>('node:fs')).copyFileSync;
    vi.mocked(fs.linkSync).mockImplementation(() => { throw new Error('EXDEV'); });
    vi.mocked(fs.copyFileSync).mockImplementation((src, dest, mode) => {
      if (String(src).endsWith(sha(a))) { writeFileSync(dest, 'half'); throw new Error('disk full'); } // a partial file is left behind
      real(src, dest, mode);
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const target = join(dir, 'backups', 'media');
    expect(backupMedia(join(dir, 'media'), target)).toBe(1);
    expect(err).toHaveBeenCalledTimes(1);
    expect(readdirSync(target)).toEqual([sha(b)]); // no partial file at a's final name, no leftover temp file
    expect(statSync(join(target, sha(b))).size).toBe(51);
    vi.mocked(fs.copyFileSync).mockImplementation(real);
    expect(backupMedia(join(dir, 'media'), target)).toBe(1); // the failed one is tried again
    expect(readdirSync(target).sort()).toEqual([sha(a), sha(b)].sort());
  });
});
