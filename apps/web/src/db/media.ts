import { MEDIA_MAX_BYTES, sha256Hex, sniffMediaType } from '@life/shared';
import { db, type MediaInfo } from './db';

// Media bytes on this device (Marco 3c, spec §3.2 and §5). Local only: never in SYNC_TABLES.

/** The file cannot be used; the message is PT-BR and shown as is. */
export class MediaInputError extends Error {}

export const MEDIA_MESSAGES = {
  empty: 'O arquivo está vazio.',
  tooBig: 'Arquivo grande demais (máximo 8 MB).',
  format: 'Formato não aceito.',
  noSpace: 'Sem espaço neste aparelho para guardar a mídia.',
} as const;

/** A Uint8Array over the data (no copy). Works with buffers from another realm (IndexedDB, tests). */
const toView = (data: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> =>
  ArrayBuffer.isView(data) ? new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength) : new Uint8Array(data);

/** SHA-256 hex: crypto.subtle where the page has it (HTTPS, localhost), the plain JS version otherwise. */
export async function hashBytes(data: ArrayBuffer | Uint8Array): Promise<string> {
  const view = toView(data);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return sha256Hex(view);
  const digest = new Uint8Array(await subtle.digest('SHA-256', view));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex;
}

const isQuota = (e: unknown): boolean => {
  const err = e as { name?: string; inner?: { name?: string } } | null;
  return err?.name === 'QuotaExceededError' || err?.inner?.name === 'QuotaExceededError';
};

export interface StoreOpts {
  /** Queue it for the server (media made or imported here); false for downloads. */
  upload: boolean;
  /** Downloads and imports: the hash the bytes must have. */
  expectHash?: string;
}

/**
 * Keeps the bytes on this device under their hash, after checking size and format. The same bytes
 * twice are stored once (with `upload`, a missing queue entry is added again). Throws
 * MediaInputError for unusable input; a wrong `expectHash` throws a plain Error.
 */
export async function storeMedia(data: ArrayBuffer | Uint8Array, opts: StoreOpts): Promise<{ info: MediaInfo; created: boolean }> {
  const view = toView(data);
  if (view.byteLength === 0) throw new MediaInputError(MEDIA_MESSAGES.empty);
  if (view.byteLength > MEDIA_MAX_BYTES) throw new MediaInputError(MEDIA_MESSAGES.tooBig);
  const type = sniffMediaType(view);
  if (!type) throw new MediaInputError(MEDIA_MESSAGES.format);
  const hash = await hashBytes(view);
  if (opts.expectHash !== undefined && opts.expectHash !== hash) {
    throw new Error(`media: expected ${opts.expectHash}, got ${hash}`);
  }
  const bytes = view.slice().buffer; // its own buffer: a view into a bigger one would store all of it
  try {
    return await db.transaction('rw', db.mediaInfo, db.mediaData, db.mediaQueue, async () => {
      const prev = await db.mediaInfo.get(hash);
      const info: MediaInfo = prev ?? { hash, type, size: view.byteLength, addedAt: Date.now() };
      if (!prev) {
        await db.mediaInfo.put(info);
        await db.mediaData.put({ hash, type, bytes });
      }
      if (opts.upload && !(await db.mediaQueue.get(hash))) await db.mediaQueue.put({ hash, addedAt: Date.now() });
      return { info, created: !prev };
    });
  } catch (e) {
    if (isQuota(e)) throw new MediaInputError(MEDIA_MESSAGES.noSpace);
    throw e;
  }
}

/** Media made on this device (pasted, drawn, recorded, picked): stored and queued for upload. */
export async function saveMediaBlob(blob: Blob): Promise<MediaInfo> {
  return (await storeMedia(await blob.arrayBuffer(), { upload: true })).info;
}

export interface MediaUsage { count: number; bytes: number; pending: number }

/** Files and bytes kept on this device, and how many still wait for the server. */
export async function mediaUsage(): Promise<MediaUsage> {
  let count = 0;
  let bytes = 0;
  await db.mediaInfo.each((m) => { count += 1; bytes += m.size; });
  return { count, bytes, pending: await db.mediaQueue.count() };
}
