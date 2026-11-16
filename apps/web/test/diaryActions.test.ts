import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockSession, DayState, DiaryEntry, Journey, MonthReview, SleepLog, TrainingLog, Week } from '@life/shared';
import { db } from '../src/db/db';
import { readCloseEntry, readDiaryExport, readDiaryWeek, readLinkNames } from '../src/db/diaryData';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import {
  emptyDiaryTrash, purgeDiaryEntry, restoreDiaryEntry, saveCloseNote, saveDiaryEntry, trashDiaryEntry, type DiaryDraft,
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
    expect(await emptyDiaryTrash()).toBe(2);
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
    expect(await emptyDiaryTrash()).toBe(1);
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
