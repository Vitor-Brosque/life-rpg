import type { BaseRecord, SyncChange, SyncTable } from '@life/shared';
import { SYNC_TABLES, base64ToBytes, isMediaHash } from '@life/shared';
import { storeMedia } from '../../db/media';
import { importRecords } from '../../db/repo';
import { plural } from '../../ui/format';

/** The file is not an export (the message is PT-BR and shown as is). */
export class ImportError extends Error {}

const isTable = (key: string): key is SyncTable => (SYNC_TABLES as readonly string[]).includes(key);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** A record the sync server accepts: string id (≤ 64), integer updatedAt; createdAt / deleted get defaults. */
function toRecord(raw: unknown): SyncChange['record'] | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '' || r.id.length > 64 || !isInt(r.updatedAt)) return undefined;
  return {
    ...r,
    id: r.id,
    updatedAt: r.updatedAt,
    createdAt: isInt(r.createdAt) ? r.createdAt : r.updatedAt,
    deleted: typeof r.deleted === 'boolean' ? r.deleted : false,
  } satisfies BaseRecord & Record<string, unknown>;
}

/**
 * Validates the export format (`collectExport`: an object keyed by table name with arrays of
 * records). Unknown keys are ignored and malformed records skipped; throws ImportError when
 * nothing in it looks like an export.
 */
export function parseImport(data: unknown): SyncChange[] {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ImportError('Arquivo inválido: não parece uma exportação do LIFE RPG.');
  }
  const changes: SyncChange[] = [];
  let tables = 0;
  for (const [key, rows] of Object.entries(data)) {
    if (!isTable(key) || !Array.isArray(rows)) continue;
    tables += 1;
    for (const row of rows) {
      const record = toRecord(row);
      if (record) changes.push({ table: key, record });
    }
  }
  if (tables === 0) throw new ImportError('Arquivo inválido: não parece uma exportação do LIFE RPG.');
  return changes;
}

export interface ImportResult { records: number; media: number }

/** The export's embedded media (well-formed entries only; the rest is ignored). */
export function parseImportMedia(data: unknown): Array<{ hash: string; data: string }> {
  if (typeof data !== 'object' || data === null) return [];
  const list = (data as { media?: unknown }).media;
  if (!Array.isArray(list)) return [];
  const out: Array<{ hash: string; data: string }> = [];
  for (const m of list) {
    if (typeof m !== 'object' || m === null) continue;
    const { hash, data: b64 } = m as { hash?: unknown; data?: unknown };
    if (typeof hash === 'string' && isMediaHash(hash) && typeof b64 === 'string') out.push({ hash, data: b64 });
  }
  return out;
}

/** Keeps each media whose bytes match its hash, queued for the server. Returns how many were new. */
export async function importMedia(entries: Array<{ hash: string; data: string }>): Promise<number> {
  let added = 0;
  for (const e of entries) {
    try {
      if ((await storeMedia(base64ToBytes(e.data), { upload: true, expectHash: e.hash })).created) added += 1;
    } catch (err) {
      console.warn(`import: media ${e.hash} skipped`, err);
    }
  }
  return added;
}

/** Reads an exported JSON file: media first (so their uploads go before the records), then records. */
export async function importFile(file: Blob): Promise<ImportResult> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new ImportError('Arquivo inválido: não é um JSON.');
  }
  const changes = parseImport(data);
  const media = await importMedia(parseImportMedia(data));
  return { records: await importRecords(changes), media };
}

export function importSummary(r: ImportResult): string {
  if (r.media === 0) return r.records === 1 ? '1 registro importado' : `${r.records} registros importados`;
  return `${plural(r.records, 'registro', 'registros')} e ${plural(r.media, 'mídia', 'mídias')} importados`;
}
