import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { shouldAccept, type SyncChange, type SyncTable } from '@life/shared';

// Loaded via require so bundlers do not strip the node: prefix (sqlite is only resolvable with it).
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;

interface Row {
  tbl: string;
  id: string;
  updatedAt: number;
  deleted: number;
  rev: number;
  data: string;
}

export class RecordStore {
  db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS records (
        tbl TEXT NOT NULL, id TEXT NOT NULL, updatedAt INTEGER NOT NULL,
        deleted INTEGER NOT NULL, rev INTEGER NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY (tbl, id)
      );
      CREATE INDEX IF NOT EXISTS records_rev ON records(rev);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    `);
  }

  currentRev(): number {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'rev'").get() as
      | { value: string }
      | undefined;
    return row ? Number(row.value) : 0;
  }

  /** A value of the `meta` table ('rev' belongs to the sync and is never touched through here). */
  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  apply(changes: SyncChange[]): { accepted: number; rev: number } {
    const getExisting = this.db.prepare('SELECT updatedAt FROM records WHERE tbl = ? AND id = ?');
    const upsert = this.db.prepare(
      `INSERT INTO records (tbl, id, updatedAt, deleted, rev, data) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(tbl, id) DO UPDATE SET updatedAt = excluded.updatedAt,
         deleted = excluded.deleted, rev = excluded.rev, data = excluded.data`,
    );
    const setRev = this.db.prepare(
      "INSERT INTO meta (key, value) VALUES ('rev', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    let rev = this.currentRev();
    let accepted = 0;
    this.db.exec('BEGIN');
    try {
      for (const c of changes) {
        const existing = getExisting.get(c.table, c.record.id) as { updatedAt: number } | undefined;
        if (!shouldAccept(c.record, existing)) continue;
        rev += 1;
        accepted += 1;
        upsert.run(
          c.table,
          c.record.id,
          c.record.updatedAt,
          c.record.deleted ? 1 : 0,
          rev,
          JSON.stringify(c.record),
        );
      }
      if (accepted > 0) setRev.run(String(rev));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return { accepted, rev };
  }

  since(cursor: number, limit = 5000): { cursor: number; changes: SyncChange[] } {
    const rows = this.db
      .prepare(
        'SELECT tbl, id, updatedAt, deleted, rev, data FROM records WHERE rev > ? ORDER BY rev LIMIT ?',
      )
      .all(cursor, limit) as unknown as Row[];
    const changes = rows.map((r) => ({
      table: r.tbl as SyncTable,
      record: JSON.parse(r.data) as SyncChange['record'],
    }));
    const last = rows[rows.length - 1];
    return { cursor: last ? last.rev : cursor, changes };
  }

  /** Every record of one table, as stored (deleted ones included: callers filter). */
  list<T = SyncChange['record']>(table: SyncTable): T[] {
    const rows = this.db.prepare('SELECT data FROM records WHERE tbl = ?').all(table) as unknown as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as T);
  }

  /**
   * Only some top-level fields of every record of one table (deleted ones included), taken by SQLite with
   * `json_extract`: the other fields (an apostila's Markdown) never become JavaScript strings. For counts.
   */
  listFields<T>(table: SyncTable, fields: readonly string[]): T[] {
    const cols = fields.map((f) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f)) throw new Error(`Campo inválido: ${f}`);
      return f === 'deleted' ? 'deleted' : `json_extract(data, '$.${f}') AS ${f}`;
    });
    const rows = this.db.prepare(`SELECT ${cols.join(', ')} FROM records WHERE tbl = ?`).all(table) as Record<string, unknown>[];
    return rows.map((r) => ({ ...r, ...('deleted' in r ? { deleted: r.deleted === 1 } : {}) }) as T);
  }

  backupTo(file: string): void {
    this.db.prepare('VACUUM INTO ?').run(file);
  }

  close(): void {
    this.db.close();
  }
}
