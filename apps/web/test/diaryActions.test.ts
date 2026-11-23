import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockSession, DayState, DiaryEntry, Journey, MonthReview, SleepLog, TrainingLog, Week } from '@life/shared';
import { db } from '../src/db/db';
import { readCloseEntry, readDiaryExport, readDiaryWeek, readLinkNames } from '../src/db/diaryData';
import { applyRemote, newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import {
  NewerDiaryText, emptyDiaryTrash, purgeDiaryEntry, restoreDiaryEntry, saveCloseNote, saveDiaryEntry, trashDiaryEntry,
  type DiaryBase, type DiaryDraft,
} from '../src/domain/diaryActions';
import { at, seedBlocks } from './blockFixture';

const draft = (p: Partial<DiaryDraft> = {}): DiaryDraft => ({
  text: 'Hoje rendeu.', day: '2026-11-11', at: at(11, 21, 5), themes: [], links: [], private: false, ...p,
});
const entry = (id: string) => db.diaryEntries.get(id) as Promise<DiaryEntry>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 21, 10));
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

describe('saveDiaryEntry', () => {
  it('writes nothing while the text is only spaces', async () => {
    expect(await saveDiaryEntry('e1', draft({ text: '  \n ' }))).toBeUndefined();
    expect(await db.diaryEntries.count()).toBe(0);
    expect(await db.outbox.get('diaryEntries:e1')).toBeUndefined();
  });

  it('creates a livre entry the first time, then replaces the draft fields; edited marks editedAt', async () => {
    await saveDiaryEntry('e1', draft({ themes: ['familia'], links: [{ kind: 'journey', id: 'j1' }] }));
    expect(await entry('e1')).toEqual({
      id: 'e1', createdAt: at(11, 21, 10), updatedAt: at(11, 21, 10), deleted: false, kind: 'livre',
      text: 'Hoje rendeu.', day: '2026-11-11', at: at(11, 21, 5), themes: ['familia'], links: [{ kind: 'journey', id: 'j1' }], private: false,
    });
    vi.setSystemTime(at(11, 21, 12));
    await saveDiaryEntry('e1', draft({ text: 'Hoje rendeu bem.', private: true }));
    expect(await entry('e1')).toMatchObject({ text: 'Hoje rendeu bem.', private: true, themes: [], createdAt: at(11, 21, 10) });
    expect((await entry('e1')).editedAt).toBeUndefined();
    vi.setSystemTime(at(12, 9));
    await saveDiaryEntry('e1', draft({ day: '2026-11-10', at: at(10, 22) }), { edited: true });
    expect(await entry('e1')).toMatchObject({ day: '2026-11-10', at: at(10, 22), editedAt: at(12, 9), kind: 'livre' });
  });

  it('keeps at most three links', async () => {
    const links = ['a', 'b', 'c', 'd'].map((id) => ({ kind: 'mission' as const, id }));
    await saveDiaryEntry('e1', draft({ links }));
    expect((await entry('e1')).links.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('trash', () => {
  it('Apagar → Restaurar → Apagar de vez (text emptied, themes and links gone, deleted)', async () => {
    await saveDiaryEntry('e1', draft({ themes: ['sono'], links: [{ kind: 'mission', id: 'm1' }] }));
    await trashDiaryEntry('e1');
    expect((await entry('e1')).trashedAt).toBe(at(11, 21, 10));
    await restoreDiaryEntry('e1');
    expect((await entry('e1')).trashedAt).toBeUndefined();
    expect((await entry('e1')).text).toBe('Hoje rendeu.');
    await trashDiaryEntry('e1');
    await purgeDiaryEntry('e1');
    expect(await entry('e1')).toMatchObject({ text: '', themes: [], links: [], deleted: true });
    expect(await db.outbox.get('diaryEntries:e1')).toMatchObject({ updatedAt: (await entry('e1')).updatedAt });
    await purgeDiaryEntry('missing');
    expect(await db.diaryEntries.count()).toBe(1);
  });

  it('Esvaziar deletes every trashed entry for good and leaves the others', async () => {
    await saveDiaryEntry('e1', draft());
    await saveDiaryEntry('e2', draft({ text: 'Outra' }));
    await saveDiaryEntry('e3', draft({ text: 'Fica' }));
    await trashDiaryEntry('e1');
    await trashDiaryEntry('e2');
    expect(await emptyDiaryTrash()).toEqual(['e1', 'e2']);
    expect((await db.diaryEntries.toArray()).map((e) => [e.id, e.deleted, e.text])).toEqual([
      ['e1', true, ''], ['e2', true, ''], ['e3', false, 'Fica'],
    ]);
  });
});

describe('trash edge cases', () => {
  it('Esvaziar re-checks each entry: one restored at the same time keeps its text', async () => {
    await saveDiaryEntry('e1', draft());
    await saveDiaryEntry('e2', draft({ text: 'Outra' }));
    await trashDiaryEntry('e1');
    await trashDiaryEntry('e2');
    const snap = await db.diaryEntries.toArray();
    vi.spyOn(db.diaryEntries, 'toArray').mockImplementationOnce((async () => {
      await restoreDiaryEntry('e1');
      return snap;
    }) as never);
    expect(await emptyDiaryTrash()).toEqual(['e2']);
    expect(await entry('e1')).toMatchObject({ text: 'Hoje rendeu.', deleted: false, trashedAt: undefined });
    expect(await entry('e2')).toMatchObject({ text: '', deleted: true });
    expect(await db.outbox.get('diaryEntries:e2')).toBeDefined();
  });

  it('trashing a trashed entry and restoring a visible one write nothing', async () => {
    await saveDiaryEntry('e1', draft());
    await db.outbox.clear();
    await restoreDiaryEntry('e1');
    expect(await db.outbox.count()).toBe(0);
    await trashDiaryEntry('e1');
    const trashed = await entry('e1');
    await db.outbox.clear();
    vi.setSystemTime(at(11, 22));
    await trashDiaryEntry('e1');
    expect(await entry('e1')).toEqual(trashed);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('saveCloseNote', () => {
  it('creates, edits, trashes on a blank note and revives a deleted one', async () => {
    await saveCloseNote('2026-11-11', '  Dia corrido  ');
    expect(await entry('diary-close-2026-11-11')).toMatchObject({ kind: 'fechamento', day: '2026-11-11', at: at(11, 21, 10), text: 'Dia corrido' });
    expect(await readCloseEntry('2026-11-11')).toMatchObject({ text: 'Dia corrido' });
    await saveCloseNote('2026-11-11', '');
    expect(await readCloseEntry('2026-11-11')).toBeNull();
    await purgeDiaryEntry('diary-close-2026-11-11');
    vi.setSystemTime(at(11, 22));
    await saveCloseNote('2026-11-11', 'De novo');
    expect(await entry('diary-close-2026-11-11')).toMatchObject({ text: 'De novo', deleted: false, createdAt: at(11, 22), at: at(11, 22) });
  });

  it('the same text again writes nothing (no editedAt, no outbox), even when the entry was saved untrimmed', async () => {
    await saveDiaryEntry('diary-close-2026-11-11', draft({ text: 'Dia corrido \n' }), { kind: 'fechamento' });
    await db.outbox.clear();
    vi.setSystemTime(at(11, 22));
    await saveCloseNote('2026-11-11', 'Dia corrido');
    expect((await entry('diary-close-2026-11-11')).editedAt).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('final fix wave', () => {
  const CLOSE = 'diary-close-2026-11-11';
  const oldNoteDay = () => put('dayState', newRecord<DayState>({
    id: '2026-11-11', hardDay: false, reviewDone: false, closedAt: at(11, 22), tiredness: 'medio', closeNote: 'Dia corrido',
  }));

  it('Apagar de vez on a fechamento also clears that day\'s old DayState.closeNote, through the outbox', async () => {
    await oldNoteDay();
    await saveCloseNote('2026-11-11', 'Dia corrido');
    await trashDiaryEntry(CLOSE);
    await db.outbox.clear();
    vi.setSystemTime(at(11, 23));
    await purgeDiaryEntry(CLOSE);
    const ds = (await db.dayState.get('2026-11-11'))!;
    expect(ds.closeNote).toBeUndefined();
    expect(ds).toMatchObject({ closedAt: at(11, 22), tiredness: 'medio', deleted: false, updatedAt: at(11, 23) });
    expect(await db.outbox.get('dayState:2026-11-11')).toMatchObject({ updatedAt: ds.updatedAt });
    expect(await entry(CLOSE)).toMatchObject({ text: '', deleted: true });
  });

  it('Esvaziar does the same for a fechamento, and resolves with the ids it deleted', async () => {
    await oldNoteDay();
    await saveCloseNote('2026-11-11', 'Dia corrido');
    await saveDiaryEntry('e1', draft());
    await trashDiaryEntry(CLOSE);
    await trashDiaryEntry('e1');
    await db.outbox.clear();
    expect((await emptyDiaryTrash()).sort()).toEqual([CLOSE, 'e1']);
    expect((await db.dayState.get('2026-11-11'))!.closeNote).toBeUndefined();
    expect(await db.outbox.get('dayState:2026-11-11')).toBeDefined();
  });

  it('DayState is left alone by a livre purge, by Apagar on a fechamento, and when it has no closeNote', async () => {
    await oldNoteDay();
    await saveCloseNote('2026-11-11', 'Dia corrido');
    await saveDiaryEntry('e1', draft());
    await db.outbox.clear();
    const before = await db.dayState.get('2026-11-11');
    await trashDiaryEntry('e1');
    await purgeDiaryEntry('e1');
    await trashDiaryEntry(CLOSE);
    expect(await db.dayState.get('2026-11-11')).toEqual(before);
    expect(await db.outbox.get('dayState:2026-11-11')).toBeUndefined();
    await saveCloseNote('2026-11-12', 'Outro dia');
    await put('dayState', newRecord<DayState>({ id: '2026-11-12', hardDay: false, reviewDone: false, closedAt: at(12, 22) }));
    await db.outbox.clear();
    await purgeDiaryEntry('diary-close-2026-11-12');
    expect(await db.outbox.get('dayState:2026-11-12')).toBeUndefined();
  });

  it('a new observation keeps the different text of a trashed fechamento as a trashed, restorable livre entry', async () => {
    await saveCloseNote('2026-11-11', 'Primeira versão');
    await saveDiaryEntry(CLOSE, draft({ text: 'Primeira versão', at: at(11, 21, 10), themes: ['familia'], private: true }), { kind: 'fechamento' });
    vi.setSystemTime(at(11, 21, 30));
    await saveCloseNote('2026-11-11', '');
    vi.setSystemTime(at(11, 22));
    await saveCloseNote('2026-11-11', 'Segunda versão');
    expect(await entry(CLOSE)).toMatchObject({
      kind: 'fechamento', text: 'Segunda versão', trashedAt: undefined, deleted: false, at: at(11, 22), themes: [], links: [], private: false,
    });
    const kept = (await db.diaryEntries.toArray()).filter((e) => e.id !== CLOSE);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({
      kind: 'livre', day: '2026-11-11', at: at(11, 21, 10), text: 'Primeira versão', themes: ['familia'], private: true,
      trashedAt: at(11, 21, 30), deleted: false,
    });
    expect(await db.outbox.get(`diaryEntries:${kept[0]!.id}`)).toBeDefined();
    await restoreDiaryEntry(kept[0]!.id);
    expect((await entry(kept[0]!.id)).trashedAt).toBeUndefined();
  });

  it('the same text as the trashed fechamento just brings it back (no copy)', async () => {
    await saveCloseNote('2026-11-11', 'Dia corrido');
    await saveCloseNote('2026-11-11', '');
    await saveCloseNote('2026-11-11', ' Dia corrido ');
    expect(await db.diaryEntries.count()).toBe(1);
    expect(await entry(CLOSE)).toMatchObject({ text: 'Dia corrido', trashedAt: undefined });
  });
});

describe('fix round 2', () => {
  const CLOSE = 'diary-close-2026-11-11';
  const livreCopies = async () => (await db.diaryEntries.toArray()).filter((e) => e.id !== CLOSE);

  it('a save with a base never replaces a newer text from elsewhere; the base follows each save', async () => {
    const a = (await saveDiaryEntry('e1', draft({ text: 'Texto A' })))!;
    const base: DiaryBase = { updatedAt: a.updatedAt, text: 'Texto A' };
    vi.setSystemTime(at(11, 21, 20));
    await saveDiaryEntry('e1', draft({ text: 'Texto A e mais' }), { base });
    const mine = await entry('e1');
    expect(base).toEqual({ updatedAt: mine.updatedAt, text: 'Texto A e mais' });
    await applyRemote({ table: 'diaryEntries', record: { ...mine, text: 'Texto B', updatedAt: mine.updatedAt + 60_000 } });
    const newer = await entry('e1');
    await db.outbox.clear();
    const refused = saveDiaryEntry('e1', draft({ text: 'Texto A e mais ainda' }), { base });
    await expect(refused).rejects.toBeInstanceOf(NewerDiaryText);
    await expect(refused).rejects.toMatchObject({ entry: newer });
    expect(await entry('e1')).toEqual(newer);
    expect(await db.outbox.count()).toBe(0);
    expect(base).toEqual({ updatedAt: mine.updatedAt, text: 'Texto A e mais' });
  });

  it('nothing to lose, the save goes through: same text as the newer one, text unchanged elsewhere, deleted elsewhere', async () => {
    const a = (await saveDiaryEntry('e1', draft({ text: 'Texto A' })))!;
    await applyRemote({ table: 'diaryEntries', record: { ...a, text: 'Igual', updatedAt: a.updatedAt + 1000 } });
    await saveDiaryEntry('e1', draft({ text: 'Igual' }), { base: { updatedAt: a.updatedAt, text: 'Texto A' } });
    const same = await entry('e1');
    await applyRemote({ table: 'diaryEntries', record: { ...same, themes: ['sono'], updatedAt: same.updatedAt + 1000 } });
    await saveDiaryEntry('e1', draft({ text: 'Igual, e mais' }), { base: { updatedAt: same.updatedAt, text: 'Igual' } });
    const themed = await entry('e1');
    expect(themed.text).toBe('Igual, e mais');
    await applyRemote({ table: 'diaryEntries', record: { ...themed, text: '', themes: [], links: [], deleted: true, updatedAt: themed.updatedAt + 1000 } });
    await saveDiaryEntry('e1', draft({ text: 'De volta' }), { base: { updatedAt: themed.updatedAt, text: 'Igual, e mais' } });
    expect(await entry('e1')).toMatchObject({ text: 'De volta', deleted: false });
  });

  it('saves queued one after the other with the same base all go through (each moves the base)', async () => {
    const base: DiaryBase = { text: '' };
    await Promise.all([
      saveDiaryEntry('e1', draft({ text: 'um' }), { base }),
      saveDiaryEntry('e1', draft({ text: 'um dois' }), { base }),
    ]);
    expect((await entry('e1')).text).toBe('um dois');
    expect(base).toEqual({ updatedAt: (await entry('e1')).updatedAt, text: 'um dois' });
  });

  it('Esvaziar tells each entry it empties as it goes', async () => {
    await saveDiaryEntry('e1', draft());
    await saveDiaryEntry('e2', draft({ text: 'Outra' }));
    await trashDiaryEntry('e1');
    await trashDiaryEntry('e2');
    const seen: string[] = [];
    expect(await emptyDiaryTrash((id) => seen.push(id))).toEqual(['e1', 'e2']);
    expect(seen.sort()).toEqual(['e1', 'e2']);
  });

  it('Esvaziar that fails on one entry still tells the ones it emptied, then fails', async () => {
    await saveDiaryEntry('e1', draft());
    await saveDiaryEntry('e2', draft({ text: 'Outra' }));
    await trashDiaryEntry('e1');
    await trashDiaryEntry('e2');
    const get = db.diaryEntries.get.bind(db.diaryEntries);
    vi.spyOn(db.diaryEntries, 'get').mockImplementation(((key: string) =>
      key === 'e2' ? Promise.reject(new Error('disk')) : get(key)) as never);
    const seen: string[] = [];
    await expect(emptyDiaryTrash((id) => seen.push(id))).rejects.toThrow('disk');
    vi.restoreAllMocks();
    expect(seen).toEqual(['e1']);
    expect(await entry('e1')).toMatchObject({ deleted: true, text: '' });
    expect(await entry('e2')).toMatchObject({ deleted: false, text: 'Outra' });
  });

  it('Apagar de vez of any entry holding the day\'s old closeNote clears it (the trashed copy of a migrated note)', async () => {
    await put('dayState', newRecord<DayState>({ id: '2026-11-11', hardDay: false, reviewDone: false, closeNote: 'Dia corrido' }));
    await saveCloseNote('2026-11-11', 'Dia corrido');                // the migrated fechamento
    await saveCloseNote('2026-11-11', '');
    await saveCloseNote('2026-11-11', 'Outra observação');           // the old text goes to a trashed livre copy
    const [copy] = await livreCopies();
    expect(copy).toMatchObject({ kind: 'livre', text: 'Dia corrido' });
    await saveDiaryEntry('other', draft({ text: 'Outra coisa' }));
    await trashDiaryEntry('other');
    await db.outbox.clear();
    await purgeDiaryEntry('other');
    expect((await db.dayState.get('2026-11-11'))!.closeNote).toBe('Dia corrido');
    expect(await db.outbox.get('dayState:2026-11-11')).toBeUndefined();
    vi.setSystemTime(at(11, 23));
    expect(await emptyDiaryTrash()).toEqual([copy!.id]);
    const ds = (await db.dayState.get('2026-11-11'))!;
    expect(ds.closeNote).toBeUndefined();
    expect(await db.outbox.get('dayState:2026-11-11')).toMatchObject({ updatedAt: ds.updatedAt });
  });

  it('the trashed copy has a deterministic id, so the copy made on two devices is one record', async () => {
    await saveCloseNote('2026-11-11', 'Primeira versão');
    await saveCloseNote('2026-11-11', '');
    const prev = await entry(CLOSE);
    const copyId = `${CLOSE}-copia-${prev.updatedAt}`;
    vi.setSystemTime(at(11, 22));
    await saveCloseNote('2026-11-11', 'Segunda versão');
    expect((await livreCopies()).map((e) => e.id)).toEqual([copyId]);

    // The other device made the same copy first and it arrived by sync: nothing is written again.
    await db.delete();
    await db.open();
    await ensureSeed();
    await applyRemote({ table: 'diaryEntries', record: { ...prev } });
    const theirs = { ...prev, id: copyId, kind: 'livre' as const, createdAt: prev.updatedAt + 5, updatedAt: prev.updatedAt + 5 };
    await applyRemote({ table: 'diaryEntries', record: { ...theirs } });
    await saveCloseNote('2026-11-11', 'Segunda versão');
    expect(await livreCopies()).toEqual([theirs]);
    expect(await db.outbox.get(`diaryEntries:${copyId}`)).toBeUndefined();
  });

  it('a note over a text that changed since it was shown keeps that text as a trashed, restorable copy', async () => {
    await saveCloseNote('2026-11-11', 'Versão antiga');
    vi.setSystemTime(at(11, 21, 30));
    await saveDiaryEntry(CLOSE, draft({ text: 'Versão nova', at: at(11, 21, 10) }), { kind: 'fechamento' });
    const newer = await entry(CLOSE);
    vi.setSystemTime(at(11, 22));
    await saveCloseNote('2026-11-11', 'Minha nota', { shown: 'Versão antiga' });
    expect(await entry(CLOSE)).toMatchObject({ kind: 'fechamento', text: 'Minha nota', trashedAt: undefined, deleted: false });
    expect(await livreCopies()).toEqual([expect.objectContaining({
      id: `${CLOSE}-copia-${newer.updatedAt}`, kind: 'livre', day: '2026-11-11', at: at(11, 21, 10), text: 'Versão nova',
      trashedAt: at(11, 22), deleted: false,
    })]);
    expect(await db.outbox.get(`diaryEntries:${CLOSE}-copia-${newer.updatedAt}`)).toBeDefined();
  });

  it('no copy when the text is still the one shown, when it already is his note, or when his note is blank', async () => {
    await saveCloseNote('2026-11-11', 'Versão antiga');
    await saveCloseNote('2026-11-11', 'Minha nota', { shown: 'Versão antiga' });
    expect(await livreCopies()).toEqual([]);
    await saveDiaryEntry(CLOSE, draft({ text: 'Minha nota de novo' }), { kind: 'fechamento' });
    await saveCloseNote('2026-11-11', ' Minha nota de novo ', { shown: 'Minha nota' });
    expect(await livreCopies()).toEqual([]);
    await saveDiaryEntry(CLOSE, draft({ text: 'Versão de outro aparelho' }), { kind: 'fechamento' });
    await saveCloseNote('2026-11-11', '', { shown: 'Minha nota de novo' });
    expect(await livreCopies()).toEqual([]);
    expect(await entry(CLOSE)).toMatchObject({ text: 'Versão de outro aparelho', trashedAt: at(11, 21, 10) });
  });
});

describe('diaryData', () => {
  it('readDiaryWeek: groups of the week with the reviews answered in it', async () => {
    await saveDiaryEntry('e1', draft());
    await saveDiaryEntry('e2', draft({ day: '2026-11-03', at: at(3, 9) }));
    await put('weeks', newRecord<Week>({ id: '2026-11-09', objectives: [], review: { worked: 'Manhãs', obstacle: '', adjustment: '', answeredAt: at(9, 9) } }));
    const groups = await readDiaryWeek('2026-11-09');
    expect(groups.map((g) => [g.day, g.entries.map((e) => e.id), g.reviews.map((r) => r.title)])).toEqual([
      ['2026-11-11', ['e1'], []], ['2026-11-09', [], ['Nova semana']],
    ]);
  });

  it('readLinkNames: missions and journeys by link key, deleted ones out', async () => {
    const j = await put('journeys', newRecord<Journey>({ title: 'Tech News', status: 'active', order: 0 }));
    await put('journeys', newRecord<Journey>({ id: 'gone', title: 'Velha', status: 'active', order: 1, deleted: true }));
    expect(await readLinkNames()).toEqual({ [`journey:${j.id}`]: 'Tech News' });
  });

  it('readDiaryExport: entries, the app records of each day and the reviews of the week', async () => {
    await seedBlocks();
    await saveDiaryEntry('e1', draft());
    await put('dayState', newRecord<DayState>({ id: '2026-11-11', hardDay: false, reviewDone: false, startedAt: at(11, 9), tiredness: 'muito' }));
    await put('blockSessions', newRecord<BlockSession>({ id: 'bs-b1-2026-11-11', blockId: 'b1', day: '2026-11-11', version: 'normal', startedAt: at(11, 9), endedAt: at(11, 12) }));
    await put('trainingLogs', newRecord<TrainingLog>({ id: 'training-2026-11-11', day: '2026-11-11', planName: 'Pernas', exercises: [{ id: 'p0', name: 'Agachamento', status: 'feito', sets: [] }] }));
    await put('sleepLogs', newRecord<SleepLog>({ id: 'sleep-2026-11-10', night: '2026-11-10', bedAt: at(10, 23, 40), wakeAt: at(11, 7, 10), quality: 4 }));
    await put('monthReviews', newRecord<MonthReview>({ id: 'month-2026-10', month: '2026-10', observed: {} as MonthReview['observed'], answeredAt: at(10, 20), answers: { progress: 'Lista 3', obstacle: '', next: '' } }));
    const data = await readDiaryExport('2026-11-09');
    expect(data.entries.map((e) => e.id)).toEqual(['e1']);
    expect(data.appDays).toEqual({
      '2026-11-11': {
        mode: 'normal', blocks: { started: 1, planned: 5 }, training: { name: 'Pernas', exercises: 1 },
        sleep: { bedAt: at(10, 23, 40), wakeAt: at(11, 7, 10), quality: 4 }, tiredness: 'muito',
      },
    });
    expect(data.reviews.map((r) => [r.title, r.day])).toEqual([['Reflexão de outubro', '2026-11-10']]);
  });
});
