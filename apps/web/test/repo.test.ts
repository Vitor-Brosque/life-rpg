import { beforeEach, describe, expect, it } from 'vitest';
import type { Deck, Mission, Note } from '@life/shared';
import { db } from '../src/db/db';
import { applyRemote, newRecord, patch, put, getMeta, setMeta, onLocalChange, putAll } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';

beforeEach(async () => { await db.delete(); await db.open(); });

const mk = () => newRecord<Mission>({ title: 'x', checklist: [], status: 'open', important: false, shrunk: false, postponeCount: 0 });

describe('repo', () => {
  it('put creates an outbox entry and bumps updatedAt strictly', async () => {
    const a = await put('missions', mk());
    expect(await db.outbox.get(`missions:${a.id}`)).toMatchObject({ id: a.id, updatedAt: a.updatedAt });
    const b = await put('missions', a);
    expect(b.updatedAt).toBeGreaterThan(a.updatedAt);
    expect((await db.outbox.get(`missions:${a.id}`))!.updatedAt).toBe(b.updatedAt);
    expect(await db.outbox.count()).toBe(1);
  });

  it('put over a soft-deleted record revives it as a fresh record', async () => {
    const a = await put('missions', { ...mk(), id: 'det-1' });
    await patch<Mission>('missions', a.id, { deleted: true });
    const dead = (await db.missions.get(a.id))!;
    const again = await put('missions', { ...mk(), id: 'det-1', title: 'again' });
    expect(again.deleted).toBe(false);
    expect(again.updatedAt).toBeGreaterThan(dead.updatedAt);
    expect(again.createdAt).toBe(again.updatedAt); // untouched since (re)creation
    expect((await db.missions.get(a.id))!).toMatchObject({ deleted: false, title: 'again' });
    expect((await db.outbox.get(`missions:${a.id}`))!.updatedAt).toBe(again.updatedAt);
  });

  it('patch merges and notifies listeners after commit', async () => {
    let n = 0;
    const off = onLocalChange(() => { n++; });
    const a = await put('missions', mk());
    const b = await patch<Mission>('missions', a.id, { title: 'y' });
    off();
    expect(b.title).toBe('y');
    expect(n).toBe(2);
  });

  it('applyRemote rejects older, accepts newer without outbox', async () => {
    const base = { ...mk(), id: 'r1', updatedAt: 1000, createdAt: 1000 };
    expect(await applyRemote({ table: 'missions', record: base as never })).toBe(true);
    expect(await db.outbox.count()).toBe(0);
    expect(await applyRemote({ table: 'missions', record: { ...base, updatedAt: 500 } as never })).toBe(false);
    expect(await applyRemote({ table: 'missions', record: { ...base, title: 'new', updatedAt: 2000 } as never })).toBe(true);
    expect((await db.missions.get('r1'))!.title).toBe('new');
    expect(await db.outbox.count()).toBe(0);
  });

  it('remote never overwrites a newer pending local change', async () => {
    const a = await put('missions', { ...mk(), title: 'local' });
    const remote = { ...a, title: 'remote', updatedAt: a.updatedAt - 1 };
    expect(await applyRemote({ table: 'missions', record: remote as never })).toBe(false);
    expect((await db.missions.get(a.id))!.title).toBe('local');
    const newer = { ...a, title: 'remote2', updatedAt: a.updatedAt + 10 };
    expect(await applyRemote({ table: 'missions', record: newer as never })).toBe(true);
    expect(await db.outbox.count()).toBe(0);
  });

  it('meta round-trips', async () => {
    expect(await getMeta('k')).toBeUndefined();
    await setMeta('k', { a: 1 });
    expect(await getMeta('k')).toEqual({ a: 1 });
  });

  it('seed is idempotent', async () => {
    await ensureSeed();
    await ensureSeed();
    expect(await db.areas.count()).toBe(6);
    expect(await db.profile.count()).toBe(1);
    expect((await db.settings.get('settings'))!.dayStartHour).toBe(4);
  });

  it('seed records never win over real data', async () => {
    await ensureSeed();
    expect((await db.profile.get('me'))!.updatedAt).toBe(1);
    expect((await db.areas.get('area-vigor'))!.updatedAt).toBe(1);
    expect(await db.outbox.get('profile:me')).toMatchObject({ updatedAt: 1 });
    const seeded = (await db.profile.get('me'))!;
    expect(await applyRemote({ table: 'profile', record: { ...seeded, updatedAt: 5, onboarded: true, name: 'Ana' } })).toBe(true);
    expect((await db.profile.get('me'))!.onboarded).toBe(true);
    const edited = await patch<typeof seeded>('profile', 'me', { name: 'Bia' });
    expect(edited.updatedAt).toBeGreaterThan(1);
  });

  it('putAll writes several tables in one transaction and notifies once', async () => {
    let calls = 0;
    const off = onLocalChange(() => { calls++; });
    const deck = newRecord<Deck>({ name: 'SQL', order: 0, archived: false });
    const note = newRecord<Note>({ deckId: deck.id, type: 'basic', front: 'a', back: 'b', draft: false });
    await putAll([{ table: 'decks', record: deck }, { table: 'notes', record: note }]);
    off();
    expect(calls).toBe(1);
    expect(await db.decks.get(deck.id)).toMatchObject({ name: 'SQL' });
    expect(await db.notes.get(note.id)).toMatchObject({ front: 'a' });
    expect(await db.outbox.get(`decks:${deck.id}`)).toBeDefined();
    expect(await db.outbox.get(`notes:${note.id}`)).toBeDefined();
  });

  it('putAll with an empty list does nothing', async () => {
    await putAll([]);
    expect(await db.outbox.count()).toBe(0);
  });
});
