import type { BaseRecord, SpeechRecording, SpeechSession, SyncChange, SyncTable } from '@life/shared';
import { SYNC_TABLES, shouldAccept, ulid, unionRecordings } from '@life/shared';
import { db, tableOf } from './db';

const listeners = new Set<() => void>();

export function onLocalChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function notify(): void {
  for (const cb of [...listeners]) {
    try { cb(); } catch { /* listener errors never break writes */ }
  }
}

export function newRecord<T extends BaseRecord>(
  fields: Omit<T, keyof BaseRecord> & Partial<BaseRecord>,
): T {
  const now = Date.now();
  return {
    id: ulid(now),
    createdAt: now,
    updatedAt: now,
    deleted: false,
    ...fields,
  } as unknown as T;
}

/** Must run inside a transaction covering `table` and the outbox. */
async function writeInTx<T extends BaseRecord>(table: SyncTable, record: T): Promise<T> {
  const t = tableOf(table);
  const prev = (await t.get(record.id)) as BaseRecord | undefined;
  let saved: T;
  if (prev) {
    const updatedAt = Math.max(Date.now(), prev.updatedAt + 1);
    // A new record written over a soft-deleted one with the same (deterministic) id revives it
    // as a fresh record, so "untouched since creation" checks keep working.
    const revived = prev.deleted && !record.deleted && record.createdAt === record.updatedAt;
    saved = { ...record, updatedAt, ...(revived ? { createdAt: updatedAt } : {}) };
  } else {
    const fresh = record.createdAt === record.updatedAt;
    const updatedAt = Math.max(Date.now(), record.updatedAt);
    saved = { ...record, updatedAt, createdAt: fresh ? updatedAt : record.createdAt };
  }
  await t.put(saved);
  await db.outbox.put({ key: `${table}:${saved.id}`, table, id: saved.id, updatedAt: saved.updatedAt });
  return saved;
}

export async function put<T extends BaseRecord>(table: SyncTable, record: T): Promise<T> {
  const saved = await db.transaction('rw', tableOf(table), db.outbox, () => writeInTx(table, record));
  notify();
  return saved;
}

/**
 * Writes records of several tables in ONE transaction (each with the usual outbox entry and
 * updatedAt bump), then notifies once: a review, its card and its XP land together or not at all.
 */
export async function putAll(entries: Array<{ table: SyncTable; record: BaseRecord }>): Promise<void> {
  if (entries.length === 0) return;
  const tables = [...new Set(entries.map((e) => e.table))].map(tableOf);
  await db.transaction('rw', [...tables, db.outbox], async () => {
    for (const { table, record } of entries) await writeInTx(table, record);
  });
  notify();
}

/** Writes a seed record with createdAt = updatedAt = 1 (loses to any real edit) and queues it for sync. */
export async function putSeed<T extends BaseRecord>(table: SyncTable, record: T): Promise<void> {
  const seeded = { ...record, createdAt: 1, updatedAt: 1 };
  await db.transaction('rw', tableOf(table), db.outbox, async () => {
    await tableOf(table).put(seeded);
    await db.outbox.put({ key: `${table}:${seeded.id}`, table, id: seeded.id, updatedAt: 1 });
  });
  notify();
}

/**
 * Creates `record` as a placeholder only when it is missing: updatedAt = 1, so it loses to any
 * real version (e.g. strokes drawn on another device that this one has not synced yet). A live
 * existing record is left untouched; a soft-deleted one is revived deliberately with a fresh
 * timestamp. One transaction. Resolves with the record now stored.
 */
export async function putPlaceholder<T extends BaseRecord>(table: SyncTable, record: T): Promise<T> {
  let wrote = false;
  const saved = await db.transaction('rw', tableOf(table), db.outbox, async () => {
    const prev = (await tableOf(table).get(record.id)) as T | undefined;
    if (prev && !prev.deleted) return prev;
    wrote = true;
    if (prev) return writeInTx(table, record);
    const placeholder = { ...record, createdAt: Date.now(), updatedAt: 1 };
    await tableOf(table).put(placeholder);
    await db.outbox.put({ key: `${table}:${placeholder.id}`, table, id: placeholder.id, updatedAt: 1 });
    return placeholder;
  });
  if (wrote) notify();
  return saved;
}

export async function patch<T extends BaseRecord>(
  table: SyncTable, id: string, changes: Partial<T>,
): Promise<T> {
  const saved = await db.transaction('rw', tableOf(table), db.outbox, async () => {
    const prev = (await tableOf(table).get(id)) as T | undefined;
    if (!prev) throw new Error(`${table}:${id} not found`);
    return writeInTx(table, { ...prev, ...changes, id } as T);
  });
  notify();
  return saved;
}

/**
 * Read-modify-write of record `id` in ONE transaction: `fn` gets the stored record and returns the
 * fields to change, or undefined to write nothing (then nothing is notified). Lists, error entries
 * and feedback change from the stored value this way, never from a screen's older copy.
 * `fn` must be synchronous (it runs inside the IndexedDB transaction).
 */
export async function mutate<T extends BaseRecord>(
  table: SyncTable, id: string, fn: (prev: T) => Partial<T> | undefined,
): Promise<T> {
  let wrote = false;
  const saved = await db.transaction('rw', tableOf(table), db.outbox, async () => {
    const prev = (await tableOf(table).get(id)) as T | undefined;
    if (!prev) throw new Error(`${table}:${id} not found`);
    const changes = fn(prev);
    if (!changes) return prev;
    wrote = true;
    return writeInTx(table, { ...prev, ...changes, id } as T);
  });
  if (wrote) notify();
  return saved;
}

/** Patches several records of `table` in one transaction, so live queries see one change. */
export async function patchMany<T extends BaseRecord>(
  table: SyncTable, entries: Array<{ id: string; changes: Partial<T> }>,
): Promise<void> {
  if (entries.length === 0) return;
  await db.transaction('rw', tableOf(table), db.outbox, async () => {
    for (const { id, changes } of entries) {
      const prev = (await tableOf(table).get(id)) as T | undefined;
      if (!prev) throw new Error(`${table}:${id} not found`);
      await writeInTx(table, { ...prev, ...changes, id } as T);
    }
  });
  notify();
}

/**
 * Patches the live record `id`, or creates it from `defaults` + `changes` when it is missing or
 * soft-deleted (a deleted one is revived as a fresh record). One transaction.
 */
export async function upsert<T extends BaseRecord>(
  table: SyncTable, id: string, changes: Partial<T>, defaults: Omit<T, keyof BaseRecord>,
): Promise<T> {
  const saved = await db.transaction('rw', tableOf(table), db.outbox, async () => {
    const prev = (await tableOf(table).get(id)) as T | undefined;
    if (prev && !prev.deleted) return writeInTx(table, { ...prev, ...changes, id } as T);
    return writeInTx(table, newRecord<T>({ ...defaults, ...changes, id } as Omit<T, keyof BaseRecord> & Partial<BaseRecord>));
  });
  notify();
  return saved;
}

export async function softDelete(table: SyncTable, id: string): Promise<void> {
  await patch(table, id, { deleted: true } as Partial<BaseRecord>);
}

const warnedTables = new Set<string>();

/** True when `next` holds a recording `prev` lacks, or the cap on one (order does not count). Guardar follows the version that wins. */
function gainedRecordings(prev: readonly SpeechRecording[], next: readonly SpeechRecording[]): boolean {
  const before = new Map(prev.map((r) => [r.hash, r]));
  return next.some((r) => {
    const b = before.get(r.hash);
    return !b || (!!r.capped && !b.capped);
  });
}

/** The result of applying one remote record: `accepted` (the remote version won) and `queued` (a merge was queued to push). */
export interface RemoteApplied { accepted: boolean; queued: boolean }

/**
 * Apply a record from the server (no outbox, no change notification). A table this version does
 * not have (synced by a newer client) is skipped with one warning per table.
 *
 * Speech sessions (I2): when a live remote version meets a live local one, the recordings are a
 * grow-only set merged by hash (`unionRecordings`), whichever version wins the other fields. When
 * the merge adds something the winning version lacked, it is stored with a newer `updatedAt` and
 * queued, so it reaches the server and the other device; equal lists write nothing (no ping-pong).
 */
export async function applyRemoteChange(change: SyncChange): Promise<RemoteApplied> {
  const { table, record } = change;
  if (!(SYNC_TABLES as readonly string[]).includes(table) || !db.tables.some((x) => x.name === table)) {
    if (!warnedTables.has(table)) {
      warnedTables.add(table);
      console.warn(`sync: skipping changes for unknown table "${table}"`);
    }
    return { accepted: false, queued: false };
  }
  const t = tableOf(table);
  return db.transaction('rw', t, db.outbox, async () => {
    const key = `${table}:${record.id}`;
    const pending = await db.outbox.get(key);
    const local = (await t.get(record.id)) as BaseRecord | undefined;
    const merging = table === 'speechSessions' && !!local && !local.deleted && !record.deleted;
    const recs = (r: BaseRecord | undefined): SpeechRecording[] => (r as SpeechSession | undefined)?.recordings ?? [];
    const queue = async (saved: BaseRecord): Promise<void> => {
      await t.put(saved);
      await db.outbox.put({ key, table, id: saved.id, updatedAt: saved.updatedAt });
    };
    if ((pending && pending.updatedAt >= record.updatedAt) || !shouldAccept(record, local)) {
      // The local version (or a pending local change) is newer: it keeps its fields, and gains the remote's recordings.
      if (!merging || !local || !gainedRecordings(recs(local), recs(record))) return { accepted: false, queued: false };
      const updatedAt = Math.max(Date.now(), local.updatedAt + 1);
      await queue({ ...local, recordings: unionRecordings(recs(local), recs(record)), updatedAt } as SpeechSession);
      return { accepted: false, queued: true };
    }
    if (merging && gainedRecordings(recs(record), recs(local))) {
      const updatedAt = Math.max(Date.now(), record.updatedAt + 1);
      await queue({ ...record, recordings: unionRecordings(recs(record), recs(local)), updatedAt } as SpeechSession);
      return { accepted: true, queued: true };
    }
    await t.put(record);
    if (pending) await db.outbox.delete(pending.key); // superseded by the newer remote version
    return { accepted: true, queued: false };
  });
}

/** `applyRemoteChange`, resolving true when the remote version won. */
export async function applyRemote(change: SyncChange): Promise<boolean> {
  return (await applyRemoteChange(change)).accepted;
}

/**
 * Import (Ajustes → "Importar JSON"): writes each record as is, keeping its own updatedAt, when it
 * is newer than the local copy (same rule as remote changes), and queues it for sync. One
 * transaction for the whole file. Resolves with the number of records written.
 */
export async function importRecords(changes: SyncChange[]): Promise<number> {
  const tables = [...new Set(changes.map((c) => c.table))].map(tableOf);
  if (tables.length === 0) return 0;
  const written = await db.transaction('rw', [...tables, db.outbox], async () => {
    let n = 0;
    for (const { table, record } of changes) {
      const t = tableOf(table);
      const local = (await t.get(record.id)) as BaseRecord | undefined;
      if (!shouldAccept(record, local)) continue;
      await t.put(record);
      await db.outbox.put({ key: `${table}:${record.id}`, table, id: record.id, updatedAt: record.updatedAt });
      n += 1;
    }
    return n;
  });
  if (written > 0) notify();
  return written;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
