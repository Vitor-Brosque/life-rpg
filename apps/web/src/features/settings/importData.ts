import type { BaseRecord, SyncChange, SyncTable } from '@life/shared';
import { SYNC_TABLES } from '@life/shared';
import { importRecords } from '../../db/repo';

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

/** Reads an exported JSON file and imports the records newer than the local copies. */
export async function importFile(file: Blob): Promise<number> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new ImportError('Arquivo inválido: não é um JSON.');
  }
  return importRecords(parseImport(data));
}
