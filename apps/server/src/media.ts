import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { MEDIA_MAX_BYTES, isMediaHash, sniffMediaType, type MediaType } from '@life/shared';

// Media files (Marco 3c, spec §5): content-addressed and immutable, `<dataDir>/media/<sha256>`.
// The format is read from the bytes (allowlist), never from what the client declares.

export type MediaPutResult = 'created' | 'exists' | 'invalid_hash' | 'empty' | 'too_large' | 'hash_mismatch' | 'unsupported_type';

export class MediaStore {
  constructor(readonly dir: string) {}

  private file(hash: string): string {
    return join(this.dir, hash);
  }

  has(hash: string): boolean {
    return isMediaHash(hash) && existsSync(this.file(hash));
  }

  /** Stores `body` under its hash. Idempotent: an existing file is never rewritten. */
  put(hash: string, body: Uint8Array): MediaPutResult {
    if (!isMediaHash(hash)) return 'invalid_hash';
    if (body.length === 0) return 'empty';
    if (body.length > MEDIA_MAX_BYTES) return 'too_large';
    if (this.has(hash)) return 'exists';
    if (createHash('sha256').update(body).digest('hex') !== hash) return 'hash_mismatch';
    if (!sniffMediaType(body)) return 'unsupported_type';
    mkdirSync(this.dir, { recursive: true });
    // Written aside, then renamed: a crash never leaves half a file under the final name.
    const tmp = join(this.dir, `.${hash}.${randomBytes(4).toString('hex')}.tmp`);
    try {
      writeFileSync(tmp, body);
      renameSync(tmp, this.file(hash));
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
    return 'created';
  }

  /** The file and its format, or undefined when missing (or no longer a known format). */
  get(hash: string): { body: Buffer; type: MediaType } | undefined {
    if (!this.has(hash)) return undefined;
    const body = readFileSync(this.file(hash));
    const type = sniffMediaType(body);
    return type ? { body, type } : undefined;
  }

  /** Hashes of the stored files (temporary files and anything else are ignored). */
  list(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter(isMediaHash).sort();
  }
}

/**
 * Mirrors new media files into `targetDir` (daily backup): a hard link (no extra space) or a copy
 * where links are not possible. Never deletes. Returns how many files were added.
 */
export function backupMedia(mediaDir: string, targetDir: string): number {
  let added = 0;
  for (const hash of new MediaStore(mediaDir).list()) {
    const dest = join(targetDir, hash);
    if (existsSync(dest)) continue;
    mkdirSync(targetDir, { recursive: true });
    try {
      linkSync(join(mediaDir, hash), dest);
    } catch {
      copyFileSync(join(mediaDir, hash), dest);
    }
    added += 1;
  }
  return added;
}

const PUT_STATUS = { invalid_hash: 400, empty: 400, hash_mismatch: 400, too_large: 413, unsupported_type: 415 } as const;

/** PUT/GET /media/:hash inside the authenticated /api plugin (the token hook already ran). */
export function registerMediaRoutes(app: FastifyInstance, media: MediaStore): void {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MEDIA_MAX_BYTES },
    (_req, body, done) => done(null, body));

  app.put('/media/:hash', { bodyLimit: MEDIA_MAX_BYTES }, async (request, reply) => {
    const { hash } = request.params as { hash: string };
    if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'unsupported_type' });
    const result = media.put(hash, request.body);
    if (result === 'created' || result === 'exists') return reply.code(204).send();
    return reply.code(PUT_STATUS[result]).send({ error: result });
  });

  app.get('/media/:hash', async (request, reply) => {
    const { hash } = request.params as { hash: string };
    if (!isMediaHash(hash)) return reply.code(400).send({ error: 'invalid_hash' });
    const file = media.get(hash);
    if (!file) return reply.code(404).send({ error: 'not_found' });
    return reply
      .header('content-type', file.type)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .send(file.body);
  });
}
