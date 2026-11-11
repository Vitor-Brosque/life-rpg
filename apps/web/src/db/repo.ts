import type { BaseRecord, SyncChange, SyncTable } from '@life/shared';
import { shouldAccept, ulid } from '@life/shared';
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
    saved = { ...record, updatedAt: Math.max(Date.now(), prev.updatedAt + 1) };
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

export async function softDelete(table: SyncTable, id: string): Promise<void> {
  await patch(table, id, { deleted: true } as Partial<BaseRecord>);
}

/** Apply a record from the server (no outbox, no change notification). */
export async function applyRemote(change: SyncChange): Promise<boolean> {
  const { table, record } = change;
  const t = tableOf(table);
  return db.transaction('rw', t, db.outbox, async () => {
    const pending = await db.outbox.get(`${table}:${record.id}`);
    if (pending && pending.updatedAt >= record.updatedAt) return false;
    const local = (await t.get(record.id)) as BaseRecord | undefined;
    if (!shouldAccept(record, local)) return false;
    await t.put(record);
    if (pending) await db.outbox.delete(pending.key); // superseded by the newer remote version
    return true;
  });
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
