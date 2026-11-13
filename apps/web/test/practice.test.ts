import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Journey, PracticeSession } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { mutate, newRecord, put } from '../src/db/repo';
import {
  PracticeIncompleteError, addPracticeError, addPracticeFeedback, compareRebuild, concludePractice, createPracticeSession,
  editPracticeList, errorToCardDraft, pausePractice, peekImplementation, removePracticeError, removePracticeFeedback,
  reopenPractice, restorePracticeError, setPracticeRating, setRebuildCode, startRebuild, updatePractice, updatePracticeError,
} from '../src/domain/practiceActions';
import { ensurePracticeSketch, saveSketchStrokes } from '../src/domain/sketchActions';
import { saveDeck, setDeckArchived } from '../src/domain/studyActions';
import { isListed, sketchMeta } from '../src/features/sketch/sketchData';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0)); // Friday
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

const tech = () => put('journeys', newRecord<Journey>({ id: 'j-tech', title: 'Tech News', status: 'active', order: 0, areaId: 'area-oficio' }));
const get = async (id: string) => (await db.practiceSessions.get(id))!;
const rateAll = async (id: string) => {
  await setPracticeRating(id, 'delivered', 1);
  await setPracticeRating(id, 'understood', 2);
  await setPracticeRating(id, 'autonomous', 0);
};
const practiceXp = async () => (await db.xpEvents.toArray()).filter((x) => !x.deleted && x.reason === 'practice');
const ready = async (title: string, journeyId?: string) => {
  const s = await createPracticeSession({ title, ...(journeyId ? { journeyId } : {}) });
  await updatePractice(s.id, { problem: 'remover notícias repetidas', code: 'def dedup(xs): ...' });
  await rateAll(s.id);
  return s;
};

describe('repo.mutate', () => {
  it('reads and writes in one transaction; writes nothing when fn returns undefined', async () => {
    const s = await createPracticeSession({ title: 'Dedup' });
    const before = (await get(s.id)).updatedAt;
    vi.setSystemTime(new Date(2026, 10, 13, 10, 5));
    expect((await mutate<PracticeSession>('practiceSessions', s.id, () => undefined)).updatedAt).toBe(before);
    const next = await mutate<PracticeSession>('practiceSessions', s.id, (prev) => ({ problem: `${prev.title}!` }));
    expect(next.problem).toBe('Dedup!');
    expect(next.updatedAt).toBeGreaterThan(before);
    expect((await db.outbox.get(`practiceSessions:${s.id}`))!.updatedAt).toBe(next.updatedAt);
    await expect(mutate('practiceSessions', 'nope', () => ({}))).rejects.toThrow();
  });
});

describe('practice sessions', () => {
  it('create: the title is required; the deck defaults to the journey deck', async () => {
    await expect(createPracticeSession({ title: '   ' })).rejects.toThrow();
    await tech();
    const old = await saveDeck({ name: 'Velho', journeyId: 'j-tech' });
    await setDeckArchived(old.id, true);
    const deck = await saveDeck({ name: 'Tech News', journeyId: 'j-tech' });
    const s = await createPracticeSession({ title: '  Dedup  por URL ', journeyId: 'j-tech', missionId: 'm1' });
    expect(s).toMatchObject({
      title: 'Dedup por URL', status: 'open', step: 'problem', journeyId: 'j-tech', missionId: 'm1', deckId: deck.id,
      language: 'python', plan: [], ratings: {},
    });
    expect(await db.outbox.get(`practiceSessions:${s.id}`)).toBeDefined();
    expect((await createPracticeSession({ title: 'Solta' })).deckId).toBeUndefined();
  });

  it('updatePractice and pausePractice clean what they write', async () => {
    const s = await createPracticeSession({ title: 'Dedup' });
    await updatePractice(s.id, { title: '  ', problem: 'remover repetidas', code: '    return x' });
    expect(await get(s.id)).toMatchObject({ title: 'Dedup', problem: 'remover repetidas', code: '    return x' });
    await pausePractice(s.id, ' testar a API ');
    expect((await get(s.id)).nextAction).toBe('testar a API');
    await pausePractice(s.id, '  ');
    expect((await get(s.id)).nextAction).toBeUndefined();
  });

  it('two quick list edits both stay; a blanked item goes away', async () => {
    const s = await createPracticeSession({ title: 'Dedup' });
    await Promise.all([
      editPracticeList(s.id, 'plan', (xs) => [...xs, { id: 'a', text: 'normalizar URL', done: false }]),
      editPracticeList(s.id, 'plan', (xs) => [...xs, { id: 'b', text: ' gravar ', done: false }]),
    ]);
    expect((await get(s.id)).plan.map((x) => x.text)).toEqual(['normalizar URL', 'gravar']);
    await editPracticeList(s.id, 'plan', (xs) => xs.map((x) => (x.id === 'a' ? { ...x, text: '  ' } : x)));
    expect((await get(s.id)).plan.map((x) => x.id)).toEqual(['b']);
  });

  it('error entries: add, edit, remove and restore in place', async () => {
    const s = await createPracticeSession({ title: 'Dedup' });
    await expect(addPracticeError(s.id, { what: ' ', why: '', fix: '' })).rejects.toThrow();
    const e1 = await addPracticeError(s.id, { what: ' return no for ', why: 'sai cedo', fix: 'acumular' });
    const e2 = await addPracticeError(s.id, { what: 'esqueci o commit', why: '', fix: 'conn.commit()' });
    expect(e1).toMatchObject({ what: 'return no for', why: 'sai cedo', fix: 'acumular' });
    await updatePracticeError(s.id, e2.id, { what: 'esqueci o commit()', why: 'sem commit não grava', fix: 'conn.commit()' });
    expect((await get(s.id)).errors[1]).toMatchObject({ id: e2.id, why: 'sem commit não grava' });
    const removed = await removePracticeError(s.id, e1.id);
    expect(removed).toMatchObject({ index: 0, entry: { id: e1.id } });
    expect((await get(s.id)).errors.map((e) => e.id)).toEqual([e2.id]);
    await restorePracticeError(s.id, removed!.entry, removed!.index);
    expect((await get(s.id)).errors.map((e) => e.id)).toEqual([e1.id, e2.id]);
    expect(await removePracticeError(s.id, 'nope')).toBeUndefined();
  });

  it('errorToCardDraft: a draft in the session deck, once; the inbox when that deck is archived', async () => {
    await tech();
    const deck = await saveDeck({ name: 'Tech News', journeyId: 'j-tech' });
    const s = await createPracticeSession({ title: 'Dedup', journeyId: 'j-tech' });
    const e = await addPracticeError(s.id, { what: 'usei return no for', why: 'sai na 1ª volta', fix: 'acumular e retornar depois' });
    const note = await errorToCardDraft(s.id, e.id);
    expect(note).toMatchObject({
      type: 'basic', draft: true, deckId: deck.id, front: 'Erro: usei return no for\n\nQual é a ideia correta?',
      back: 'acumular e retornar depois', extra: 'sai na 1ª volta',
    });
    expect((await get(s.id)).errors[0]!.noteId).toBe(note.id);
    expect((await errorToCardDraft(s.id, e.id)).id).toBe(note.id);
    expect((await db.notes.toArray()).filter((n) => !n.deleted)).toHaveLength(1);
    expect(await db.cards.count()).toBe(0); // drafts have no cards
    await setDeckArchived(deck.id, true);
    const e2 = await addPracticeError(s.id, { what: 'outro', why: '', fix: '' });
    expect((await errorToCardDraft(s.id, e2.id)).deckId).toBeUndefined();
  });

  it('feedback entries', async () => {
    const s = await createPracticeSession({ title: 'Dedup' });
    await expect(addPracticeFeedback(s.id, { source: 'ai', text: '  ' })).rejects.toThrow();
    const f = await addPracticeFeedback(s.id, { source: 'ai', text: ' use um set ' });
    expect((await get(s.id)).feedback).toEqual([{ id: f.id, at: f.at, source: 'ai', text: 'use um set' }]);
    await removePracticeFeedback(s.id, f.id);
    expect((await get(s.id)).feedback).toEqual([]);
  });
});

describe('rebuild and XP', () => {
  it('rebuild: start, peek, compare once (+5), read-only after comparing, redo without a second bonus', async () => {
    const s = await createPracticeSession({ title: 'Dedup' });
    await updatePractice(s.id, { code: 'def f(): pass' });
    await peekImplementation(s.id); // no rebuild yet: nothing to record
    expect((await get(s.id)).rebuild).toBeUndefined();
    await startRebuild(s.id);
    await setRebuildCode(s.id, 'def f():\n    pass');
    await peekImplementation(s.id);
    expect((await get(s.id)).rebuild).toMatchObject({ code: 'def f():\n    pass', peeked: true });
    expect(await compareRebuild(s.id)).toEqual({ xp: 5 });
    expect((await get(s.id)).rebuild!.comparedAt).toBeDefined();
    await setRebuildCode(s.id, 'mudou');
    expect((await get(s.id)).rebuild!.code).toBe('def f():\n    pass');
    expect(await compareRebuild(s.id)).toEqual({ xp: 0 });
    await startRebuild(s.id); // "Sim, refazer"
    expect((await get(s.id)).rebuild).toEqual({ code: '', startedAt: expect.any(Number) });
    await setRebuildCode(s.id, 'x');
    expect(await compareRebuild(s.id)).toEqual({ xp: 0 }); // once per session
    expect((await practiceXp()).map((x) => x.id)).toEqual([`xp-practice-rebuild-${s.id}`]);
  });

  it('comparing an empty rebuild is recorded, without XP', async () => {
    const s = await createPracticeSession({ title: 'Dedup' });
    await updatePractice(s.id, { code: 'x' });
    await startRebuild(s.id);
    expect(await compareRebuild(s.id)).toEqual({ xp: 0 });
    expect((await get(s.id)).rebuild!.comparedAt).toBeDefined();
    expect(await practiceXp()).toEqual([]);
  });

  it('conclude: needs the three ratings, +10 once, in the journey area; reopening keeps it', async () => {
    await tech();
    const s = await createPracticeSession({ title: 'Dedup', journeyId: 'j-tech' });
    await updatePractice(s.id, { problem: 'remover repetidas', code: 'x' });
    await expect(concludePractice(s.id)).rejects.toBeInstanceOf(PracticeIncompleteError);
    await rateAll(s.id);
    expect((await get(s.id)).ratings).toEqual({ delivered: 1, understood: 2, autonomous: 0 });
    expect(await concludePractice(s.id)).toEqual({ xp: 10 });
    expect(await get(s.id)).toMatchObject({ status: 'done', endedAt: expect.any(Number) });
    expect(await practiceXp()).toEqual([expect.objectContaining({
      id: `xp-practice-${s.id}`, amount: 10, areaId: 'area-oficio', dayKey: '2026-11-13',
    })]);
    await reopenPractice(s.id);
    expect(await get(s.id)).toMatchObject({ status: 'open' });
    expect((await get(s.id)).endedAt).toBeUndefined();
    expect(await concludePractice(s.id)).toEqual({ xp: 0 });
    expect(await practiceXp()).toHaveLength(1);
  });

  it('no XP without code; Intelecto without a journey', async () => {
    const s = await createPracticeSession({ title: 'Só pensei' });
    await updatePractice(s.id, { problem: 'p' });
    await rateAll(s.id);
    expect(await concludePractice(s.id)).toEqual({ xp: 0 });
    expect((await get(s.id)).status).toBe('done');
    await ready('Sem jornada').then((t) => concludePractice(t.id));
    expect((await practiceXp())[0]).toMatchObject({ areaId: 'area-intelecto' });
  });

  it('at most 3 sessions earn XP per day; one that earned may still earn its rebuild bonus', async () => {
    const sessions = [await ready('S0'), await ready('S1'), await ready('S2'), await ready('S3')];
    const xp: number[] = [];
    for (const s of sessions) xp.push((await concludePractice(s.id)).xp);
    expect(xp).toEqual([10, 10, 10, 0]);
    await startRebuild(sessions[0]!.id);
    await setRebuildCode(sessions[0]!.id, 'y');
    expect(await compareRebuild(sessions[0]!.id)).toEqual({ xp: 5 });
    vi.setSystemTime(new Date(2026, 10, 16, 10, 0)); // Monday: the cap starts over
    await reopenPractice(sessions[3]!.id);
    expect(await concludePractice(sessions[3]!.id)).toEqual({ xp: 10 });
  });
});

describe('practice lousa', () => {
  it('ensurePracticeSketch: deterministic placeholder, hidden from lists until drawn', async () => {
    const s = await createPracticeSession({ title: 'Dedup' });
    const k = await ensurePracticeSketch(s);
    expect(k).toMatchObject({ id: `sketch-p-${s.id}`, practiceId: s.id, title: 'Lousa · Dedup', strokes: [], updatedAt: 1 });
    expect(isListed(k)).toBe(false);
    await saveSketchStrokes(k.id, [{ c: 0, w: 0, p: [1, 1] }]);
    const drawn = (await db.sketches.get(k.id))!;
    expect(isListed(drawn)).toBe(true);
    expect(sketchMeta(drawn, drawn.updatedAt)).toBe('Prática · 1 traço · agora');
    expect((await ensurePracticeSketch(s)).updatedAt).toBe(drawn.updatedAt);
    expect(await db.sketches.count()).toBe(1);
  });
});
