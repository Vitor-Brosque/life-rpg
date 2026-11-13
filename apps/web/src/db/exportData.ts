import type { MediaType, SyncTable } from '@life/shared';
import { EXPORT_MEDIA_MAX_BYTES, SYNC_TABLES, bytesToBase64 } from '@life/shared';
import { db, tableOf } from './db';
import { mediaUsage } from './media';

export interface ExportMedia { hash: string; type: MediaType; data: string } // data: base64
export type ExportData = { exportedAt: number; media?: ExportMedia[]; mediaNote?: string } & Record<SyncTable, unknown[]>;

export const MEDIA_LEFT_OUT = 'Mídias não incluídas: passam de 25 MB. Elas continuam guardadas no aparelho e, com a sincronização, no servidor.';

/**
 * Every record of every synced table (soft-deleted included), keyed by table name, plus the media
 * kept on this device in base64 while they add up to at most `mediaCap` (spec Decisão 14).
 */
export async function collectExport(mediaCap: number = EXPORT_MEDIA_MAX_BYTES): Promise<ExportData> {
  const data = { exportedAt: Date.now() } as ExportData;
  for (const table of SYNC_TABLES) data[table] = await tableOf(table).toArray();
  const usage = await mediaUsage();
  if (usage.count > 0 && usage.bytes <= mediaCap) {
    data.media = (await db.mediaData.toArray()).map((m) => ({ hash: m.hash, type: m.type, data: bytesToBase64(new Uint8Array(m.bytes)) }));
  } else if (usage.count > 0) {
    data.mediaNote = MEDIA_LEFT_OUT;
  }
  return data;
}

/** `life-rpg-YYYY-MM-DD.json` in local time. */
export function exportFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `life-rpg-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

const isDomError = (e: unknown, name: string): boolean =>
  typeof e === 'object' && e !== null && (e as { name?: unknown }).name === name;

/**
 * Saves the full export as a JSON file. Where files can be shared (the iPhone Home Screen app,
 * which ignores `<a download>`), it opens the share sheet ("Salvar em Arquivos"…); otherwise it
 * downloads through a Blob URL. Closing the share sheet is not an error.
 */
export async function downloadExport(): Promise<void> {
  const data = await collectExport();
  const json = JSON.stringify(data, null, 2);
  const name = exportFileName();
  const file = new File([json], name, { type: 'application/json' });
  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'LIFE RPG — backup' });
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
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Asks the browser not to evict this origin's storage (IndexedDB) under pressure. Best effort. */
export function requestPersistentStorage(): void {
  try {
    void navigator.storage?.persist?.()?.catch(() => undefined);
  } catch {
    // Not supported or refused: the app works the same.
  }
}
