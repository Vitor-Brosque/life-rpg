import { describe, expect, it } from 'vitest';
import type { SyncChange } from '@life/shared';
import { RecordStore } from '../src/store';

const ch = (id: string, updatedAt: number, extra: Record<string, unknown> = {}): SyncChange => ({
  table: 'missions',
  record: { id, createdAt: 1, updatedAt, deleted: false, ...extra },
});

describe('RecordStore', () => {
  it('applies records and assigns increasing revs', () => {
    const s = new RecordStore(':memory:');
    expect(s.apply([ch('a', 10), ch('b', 10)])).toEqual({ accepted: 2, rev: 2 });
    expect(s.since(0).changes).toHaveLength(2);
    const r = s.since(1);
    expect(r.changes.map((c) => c.record.id)).toEqual(['b']);
    expect(r.cursor).toBe(2);
    expect(s.since(2)).toEqual({ cursor: 2, changes: [] });
    s.close();
  });

  it('rejects older updatedAt and accepts newer', () => {
    const s = new RecordStore(':memory:');
    s.apply([ch('a', 10, { title: 'v1' })]);
    expect(s.apply([ch('a', 5, { title: 'old' })])).toEqual({ accepted: 0, rev: 1 });
    expect(s.currentRev()).toBe(1);
    expect(s.apply([ch('a', 20, { title: 'v2' })])).toEqual({ accepted: 1, rev: 2 });
    const r = s.since(1);
    expect(r.changes[0]!.record.title).toBe('v2');
    s.close();
  });

  it('respects the limit', () => {
    const s = new RecordStore(':memory:');
    s.apply([ch('a', 1), ch('b', 1), ch('c', 1)]);
    const r = s.since(0, 2);
    expect(r.changes).toHaveLength(2);
    expect(r.cursor).toBe(2);
    s.close();
  });
});
