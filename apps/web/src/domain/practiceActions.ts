import type {
  ChecklistItem, DayKey, FeedbackSource, ID, IndicatorKey, Note, PracticeError, PracticeFeedback, PracticePatch,
  PracticeScore, PracticeSession,
} from '@life/shared';
import {
  PRACTICE_LIMITS, PRACTICE_REBUILD_XP, PRACTICE_XP, addDays, cleanErrorFields, cleanItems, cleanPracticeTitle, earnsPracticeXp,
  earnsRebuildXp, errorCardDraft, newPracticeFields, normalizePractice, practiceXpAllowed, practiceXpId, ratingsComplete,
  rebuildXpId, sanitizePracticePatch, ulid,
} from '@life/shared';
import { db } from '../db/db';
import { mutate, newRecord, patch, put, softDelete } from '../db/repo';
import { awardXp, getToday, hasLiveXp, withLock } from './common';
import { saveNote } from './studyActions';

// Prática técnica (Marco 3d, spec §2, §5, §6). Every write changes only its own fields on top of the
// stored record (patch / mutate), so an edit never brings back an older copy of the other fields.

const T = 'practiceSessions' as const;
const STUDY_AREA = 'area-intelecto';
const live = <X extends { deleted: boolean }>(xs: X[]): X[] => xs.filter((x) => !x.deleted);

export class PracticeIncompleteError extends Error {
  constructor() { super('Every indicator needs a rating'); }
}

/** First active deck of the journey (by order): where error drafts go by default. */
async function journeyDeck(journeyId?: ID): Promise<ID | undefined> {
  if (!journeyId) return undefined;
  return live(await db.decks.toArray())
    .filter((d) => !d.archived && d.journeyId === journeyId)
    .sort((a, b) => a.order - b.order)[0]?.id;
}

export async function createPracticeSession(input: { title: string; journeyId?: ID; missionId?: ID }): Promise<PracticeSession> {
  const title = cleanPracticeTitle(input.title);
  if (!title) throw new Error('A practice session needs a title');
  const deckId = await journeyDeck(input.journeyId);
  return put(T, newRecord<PracticeSession>(newPracticeFields({ ...input, title, ...(deckId ? { deckId } : {}) })));
}

/** Text and link fields, cleaned (spec §4.2). A blank title is ignored: the old one stays. */
export const updatePractice = (id: ID, changes: PracticePatch): Promise<PracticeSession> =>
  patch<PracticeSession>(T, id, sanitizePracticePatch(changes));

/** "Pausar": the first action of next time (blank clears it). */
export const pausePractice = (id: ID, nextAction: string): Promise<PracticeSession> => updatePractice(id, { nextAction });

export type PracticeListKey = 'basics' | 'plan' | 'tests';

/** Changes a list from its stored value, in one transaction: two quick edits both stay. */
export const editPracticeList = (
  id: ID, key: PracticeListKey, fn: (items: ChecklistItem[]) => ChecklistItem[],
): Promise<PracticeSession> =>
  mutate<PracticeSession>(T, id, (prev) => ({ [key]: cleanItems(fn(normalizePractice(prev)[key])) }) as Partial<PracticeSession>);

export const setPracticeRating = (id: ID, key: IndicatorKey, value: PracticeScore): Promise<PracticeSession> =>
  mutate<PracticeSession>(T, id, (prev) => ({ ratings: { ...normalizePractice(prev).ratings, [key]: value } }));

// ------------------------------------------------------------------ error log

const errorsOf = (prev: PracticeSession): PracticeError[] => normalizePractice(prev).errors;

export async function addPracticeError(id: ID, fields: { what: string; why: string; fix: string }): Promise<PracticeError> {
  const entry: PracticeError = { id: ulid(), at: Date.now(), ...cleanErrorFields(fields) };
  if (!entry.what) throw new Error('An error entry needs what went wrong');
  await mutate<PracticeSession>(T, id, (prev) => ({ errors: [...errorsOf(prev), entry].slice(-PRACTICE_LIMITS.errors) }));
  return entry;
}

export async function updatePracticeError(
  id: ID, errorId: ID, fields: { what: string; why: string; fix: string },
): Promise<PracticeSession> {
  const clean = cleanErrorFields(fields);
  if (!clean.what) throw new Error('An error entry needs what went wrong');
  return mutate<PracticeSession>(T, id, (prev) => ({
    errors: errorsOf(prev).map((e) => (e.id === errorId ? { ...e, ...clean } : e)),
  }));
}

/** Removes an entry; resolves with it and its index (for "Desfazer"), or undefined when it was not there. */
export async function removePracticeError(id: ID, errorId: ID): Promise<{ entry: PracticeError; index: number } | undefined> {
  const out: { removed?: { entry: PracticeError; index: number } } = {};
  await mutate<PracticeSession>(T, id, (prev) => {
    const errors = errorsOf(prev);
    const index = errors.findIndex((e) => e.id === errorId);
    if (index < 0) return undefined;
    out.removed = { entry: errors[index]!, index };
    return { errors: errors.filter((e) => e.id !== errorId) };
  });
  return out.removed;
}

export const restorePracticeError = (id: ID, entry: PracticeError, index: number): Promise<PracticeSession> =>
  mutate<PracticeSession>(T, id, (prev) => {
    const errors = errorsOf(prev);
    if (errors.some((e) => e.id === entry.id)) return undefined;
    const at = Math.max(0, Math.min(index, errors.length));
    return { errors: [...errors.slice(0, at), entry, ...errors.slice(at)] };
  });

/** "Virar card": a basic draft (front, back, "Por quê?") in the session's deck, else the inbox. Idempotent. */
export const errorToCardDraft = (id: ID, errorId: ID): Promise<Note> => withLock(`practice-card-${id}`, async () => {
  const stored = await db.practiceSessions.get(id);
  if (!stored || stored.deleted) throw new Error(`practice ${id} not found`);
  const s = normalizePractice(stored);
  const entry = s.errors.find((e) => e.id === errorId);
  if (!entry) throw new Error(`practice error ${errorId} not found`);
  if (entry.noteId) {
    const existing = await db.notes.get(entry.noteId);
    if (existing && !existing.deleted) return existing;
  }
  const deck = s.deckId ? await db.decks.get(s.deckId) : undefined;
  const deckId = deck && !deck.deleted && !deck.archived ? deck.id : undefined;
  const note = await saveNote({ type: 'basic', ...errorCardDraft(entry), draft: true, ...(deckId ? { deckId } : {}) });
  await mutate<PracticeSession>(T, id, (prev) => ({
    errors: errorsOf(prev).map((e) => (e.id === errorId ? { ...e, noteId: note.id } : e)),
  }));
  return note;
});

// ------------------------------------------------------------------ feedback (Marco 7 extension point)

export async function addPracticeFeedback(id: ID, input: { source: FeedbackSource; text: string }): Promise<PracticeFeedback> {
  const text = input.text.trim().slice(0, PRACTICE_LIMITS.feedbackText);
  if (!text) throw new Error('Feedback needs text');
  const entry: PracticeFeedback = { id: ulid(), at: Date.now(), source: input.source, text };
  await mutate<PracticeSession>(T, id, (prev) => ({
    feedback: [...normalizePractice(prev).feedback, entry].slice(-PRACTICE_LIMITS.feedback),
  }));
  return entry;
}

export const removePracticeFeedback = (id: ID, feedbackId: ID): Promise<PracticeSession> =>
  mutate<PracticeSession>(T, id, (prev) => ({ feedback: normalizePractice(prev).feedback.filter((f) => f.id !== feedbackId) }));

// ------------------------------------------------------------------ rebuild

/** "Começar reconstrução" and "Sim, refazer": a fresh, empty rebuild. */
export const startRebuild = (id: ID): Promise<PracticeSession> =>
  mutate<PracticeSession>(T, id, () => ({ rebuild: { code: '', startedAt: Date.now() } }));

/** The rebuild's code, only while it is not compared (then it is read-only). */
export const setRebuildCode = (id: ID, code: string): Promise<PracticeSession> =>
  mutate<PracticeSession>(T, id, (prev) => {
    const rb = normalizePractice(prev).rebuild;
    return rb && rb.comparedAt === undefined ? { rebuild: { ...rb, code: code.slice(0, PRACTICE_LIMITS.code) } } : undefined;
  });

/** "Mostrar mesmo assim": the implementation was looked at before comparing (observed data). */
export const peekImplementation = (id: ID): Promise<PracticeSession> =>
  mutate<PracticeSession>(T, id, (prev) => {
    const rb = normalizePractice(prev).rebuild;
    return rb && rb.comparedAt === undefined && !rb.peeked ? { rebuild: { ...rb, peeked: true } } : undefined;
  });

/**
 * "Reconstruir de novo, sem consultar" (ajustes da pesquisa, P2): a new session that opens on Reconstruir,
 * offered `days` after today (logical day). One at a time: while a live, open retest of `id` exists it is returned.
 */
export const createRetest = (id: ID, days: number): Promise<PracticeSession> => withLock(`practice-retest-${id}`, async () => {
  const src = await storedSession(id);
  const existing = live(await db.practiceSessions.toArray()).map(normalizePractice)
    .find((s) => s.retestOf === id && s.status === 'open');
  if (existing) return existing;
  const today = await getToday();
  const span = Number.isInteger(days) && days >= 1 ? days : 3;
  const again = (xs: ChecklistItem[]): ChecklistItem[] => xs.map((x) => ({ ...x, done: false }));
  return put(T, newRecord<PracticeSession>({
    ...newPracticeFields({
      title: `${src.title.replace(/( · de novo)+$/, '')} · de novo`.slice(0, PRACTICE_LIMITS.title),
      ...(src.journeyId ? { journeyId: src.journeyId } : {}),
      ...(src.missionId ? { missionId: src.missionId } : {}),
      ...(src.deckId ? { deckId: src.deckId } : {}),
    }),
    step: 'rebuild',
    problem: src.problem, inputs: src.inputs, outputs: src.outputs, language: src.language, code: src.code,
    basics: src.basics.map((x) => ({ ...x })), plan: again(src.plan), tests: again(src.tests),
    // Born with the rebuild started (not compared, not peeked): every hiding rule keeps the code out of sight.
    rebuild: { code: '', startedAt: Date.now() },
    retestOf: id, availableFrom: addDays(today, span),
  }));
});

// ------------------------------------------------------------------ XP (spec §6)

async function todayPracticeXpIds(today: DayKey): Promise<string[]> {
  return (await db.xpEvents.where('dayKey').equals(today).toArray())
    .filter((x) => !x.deleted && x.reason === 'practice')
    .map((x) => x.id);
}

async function practiceArea(journeyId?: ID): Promise<ID> {
  const j = journeyId ? await db.journeys.get(journeyId) : undefined;
  return j && !j.deleted && j.areaId ? j.areaId : STUDY_AREA;
}

async function mayAward(xpId: string, sessionId: ID, today: DayKey): Promise<boolean> {
  return !(await hasLiveXp(xpId)) && practiceXpAllowed(await todayPracticeXpIds(today), sessionId);
}

async function storedSession(id: ID): Promise<PracticeSession> {
  const stored = await db.practiceSessions.get(id);
  if (!stored || stored.deleted) throw new Error(`practice ${id} not found`);
  return normalizePractice(stored);
}

/** "Comparar com a implementação": marks the rebuild compared (once); +5 XP when earned. */
export const compareRebuild = (id: ID): Promise<{ xp: number }> => withLock('practice-xp', async () => {
  const s = await storedSession(id);
  if (!s.rebuild || s.rebuild.comparedAt !== undefined) return { xp: 0 };
  await mutate<PracticeSession>(T, id, (prev) => {
    const rb = normalizePractice(prev).rebuild;
    return rb && rb.comparedAt === undefined ? { rebuild: { ...rb, comparedAt: Date.now() } } : undefined;
  });
  const today = await getToday();
  const xpId = rebuildXpId(id);
  if (!earnsRebuildXp(s) || !(await mayAward(xpId, id, today))) return { xp: 0 };
  await awardXp(PRACTICE_REBUILD_XP, 'practice', today, { id: xpId, areaId: await practiceArea(s.journeyId) });
  return { xp: PRACTICE_REBUILD_XP };
});

/** "Encerrar sessão": needs the three ratings; +10 XP once per session when earned (never for the values). */
export const concludePractice = (id: ID): Promise<{ xp: number }> => withLock('practice-xp', async () => {
  const s = await storedSession(id);
  if (!ratingsComplete(s.ratings)) throw new PracticeIncompleteError();
  if (s.status !== 'done') await patch<PracticeSession>(T, id, { status: 'done', endedAt: Date.now() });
  const today = await getToday();
  const xpId = practiceXpId(id);
  if (!earnsPracticeXp(s) || !(await mayAward(xpId, id, today))) return { xp: 0 };
  await awardXp(PRACTICE_XP, 'practice', today, { id: xpId, areaId: await practiceArea(s.journeyId) });
  return { xp: PRACTICE_XP };
});

/** Back to open; the XP already given stays (it can never be given twice: deterministic ids). */
export const reopenPractice = (id: ID): Promise<PracticeSession> =>
  patch<PracticeSession>(T, id, { status: 'open', endedAt: undefined });

export const deletePractice = (id: ID): Promise<void> => softDelete(T, id);

export const restorePractice = (id: ID): Promise<PracticeSession> => patch<PracticeSession>(T, id, { deleted: false });
