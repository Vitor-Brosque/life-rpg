import type { MediaType, SyncTable } from '@life/shared';
import { EXPORT_MEDIA_MAX_BYTES, SYNC_TABLES, bytesToBase64, isStudyFileMedia } from '@life/shared';
import { db, tableOf } from './db';
import { mediaUsage } from './media';

export interface ExportMedia { hash: string; type: MediaType; data: string } // data: base64
export type ExportData = { exportedAt: number; media?: ExportMedia[]; mediaNote?: string } & Record<SyncTable, unknown[]>;

/** What the export says (and the hint under the buttons repeats) when some media did not fit. */
export const mediaLeftOutNote = (n: number): string =>
  `${n} ${n === 1 ? 'mídia não coube' : 'mídias não couberam'} na exportação (limite de 25 MB). `
  + 'Continuam guardadas no aparelho e, com a sincronização, no servidor.';

/** What the export screen says about the PDFs (PDFs da aula 2026-11-26 §2.8): they never go in the JSON. */
export const PDF_EXPORT_NOTE = 'Os PDFs e o texto extraído deles ficam fora da exportação. Com a sincronização, o PC guarda uma cópia deles no backup diário.';

/**
 * Media hashes in the order they are packed: waiting for the server first (oldest first), then the rest. PDFs and their
 * extracted texts are left out (up to 50 MB each: the export JSON would not fit a phone).
 */
async function mediaOrder(): Promise<string[]> {
  const infos = await db.mediaInfo.toArray();
  const pdfs = new Set(infos.filter((m) => isStudyFileMedia(m.type)).map((m) => m.hash));
  const queued = (await db.mediaQueue.orderBy('addedAt').toArray()).map((q) => q.hash).filter((h) => !pdfs.has(h));
  const inQueue = new Set(queued);
  const rest = infos.filter((m) => !inQueue.has(m.hash) && !pdfs.has(m.hash)).sort((x, y) => x.addedAt - y.addedAt).map((m) => m.hash);
  return [...queued, ...rest];
}

/**
 * Every record of every synced table (soft-deleted included), keyed by table name, plus the media
 * kept on this device in base64, as many as fit in `mediaCap` bytes: those still waiting for the
 * server first (only this device has them), then the others. `mediaNote` says how many were left out.
 * PDFs and their extracted texts never go in (the StudyFile records do).
 */
export async function collectExport(mediaCap: number = EXPORT_MEDIA_MAX_BYTES): Promise<ExportData> {
  const data = { exportedAt: Date.now() } as ExportData;
  for (const table of SYNC_TABLES) data[table] = await tableOf(table).toArray();
  const media: ExportMedia[] = [];
  let bytes = 0;
  let leftOut = 0;
  for (const hash of await mediaOrder()) {
    const info = await db.mediaInfo.get(hash);
    if (!info) continue;
    if (bytes + info.size > mediaCap) { leftOut += 1; continue; }
    const row = await db.mediaData.get(hash);
    if (!row) continue;
    bytes += info.size;
    media.push({ hash, type: row.type, data: bytesToBase64(new Uint8Array(row.bytes)) });
  }
  if (media.length > 0) data.media = media;
  if (leftOut > 0) data.mediaNote = mediaLeftOutNote(leftOut);
  return data;
}

/** `life-rpg-YYYY-MM-DD.json` in local time. */
export function exportFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `life-rpg-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

const isDomError = (e: unknown, name: string): boolean =>
  typeof e === 'object' && e !== null && (e as { name?: unknown }).name === name;

export interface PreparedExport { file: File; mediaNote?: string }

/** Builds the export file (the slow part: reads every table and the media). */
export async function prepareExport(): Promise<PreparedExport> {
  const data = await collectExport();
  const file = new File([JSON.stringify(data, null, 2)], exportFileName(), { type: 'application/json' });
  return { file, ...(data.mediaNote ? { mediaNote: data.mediaNote } : {}) };
}

/** The device has a share sheet (the iPhone Home Screen app, which ignores `<a download>`). */
export const canShareFiles = (): boolean => typeof navigator.share === 'function' && typeof navigator.canShare === 'function';

/**
 * Hands the file over (the JSON backup, or the diary's week with its own `title`): the share sheet ("Salvar em Arquivos"…) where the device can share it,
 * otherwise a download through a Blob URL. Call it straight from a tap: share() needs the tap's
 * user activation, which a long preparation would have used up. Closing the share sheet is not an error.
 */
export async function deliverExport(file: File, title = 'LIFE RPG — backup'): Promise<void> {
  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if (isDomError(e, 'AbortError')) return;
      // NotAllowedError (e.g. the tap's user activation expired): fall back to the download.
      if (!isDomError(e, 'NotAllowedError')) throw e;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Prepares and delivers in one go (where no fresh tap is needed: desktop, the error screen). */
export async function downloadExport(): Promise<void> {
  await deliverExport((await prepareExport()).file);
}

/** Asks the browser not to evict this origin's storage (IndexedDB) under pressure. Best effort. */
export function requestPersistentStorage(): void {
  try {
    void navigator.storage?.persist?.()?.catch(() => undefined);
  } catch {
    // Not supported or refused: the app works the same.
  }
}
