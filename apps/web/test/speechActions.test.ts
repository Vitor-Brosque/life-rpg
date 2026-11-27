import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechSession } from '@life/shared';
import { sha256Hex } from '@life/shared';
import { db } from '../src/db/db';
import { storeMedia } from '../src/db/media';
import { newRecord, put, setMeta } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import {
  SpeechEmptyError, addSpeechRecording, closeSpeechSession, dismissSpeechNote, endSpeechProgram, freeSpeechRecordings, logSituation,
  removeSituation, reopenSpeechProgram, restoreSituation, savePhaseNote, saveSpeechSession, setProgramWeek, setRecordingKeep,
  startSpeechProgram,
} from '../src/domain/speechActions';
import { saveNote } from '../src/domain/studyActions';
import { at } from './blockFixture';
import { WEBM_BYTES } from './fakeMedia';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(23, 10));
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const rec = (hash: string) => ({ hash, durationMs: 61_000, at: at(23, 10) });
const speechXp = async () => (await db.xpEvents.toArray()).filter((x) => !x.deleted && x.reason === 'speech');
/** A distinct audio/webm file per n (storeMedia sniffs the first bytes). */
const webm = (n: number): Uint8Array => new Uint8Array([...WEBM_BYTES.slice(0, 12), 9, 9, 9, n]);
const session = (id: string, p: Partial<SpeechSession>) =>
  put('speechSessions', newRecord<SpeechSession>({ id, day: '2026-10-01', kind: 'explicacao', recordings: [], ratings: {}, ...p }));

describe('speech sessions', () => {
  it('the first recording creates the session (today, kind, touched fields); another adds; the same file stays once', async () => {
    await addSpeechRecording('s1', rec('a'), { kind: 'leitura', passage: 'feira', size: 5 });
    await addSpeechRecording('s1', rec('b'), { kind: 'leitura' });
    await addSpeechRecording('s1', rec('a'), { kind: 'leitura' });
    const s = (await db.speechSessions.get('s1'))!;
    expect(s).toMatchObject({ day: '2026-11-23', kind: 'leitura', passage: 'feira', size: 5, ratings: {} });
    expect(s.recordings.map((r) => r.hash)).toEqual(['a', 'b']);
  });
  it('a new session needs a kind; ratings merge key by key; only the patch is written', async () => {
    await expect(saveSpeechSession('s1', { notes: 'x' })).rejects.toThrow('A new speech session needs a kind');
    expect(await db.speechSessions.count()).toBe(0);
    await saveSpeechSession('s1', { kind: 'explicacao', topic: 'JOIN', ratings: { clareza: 3, ritmo: 2 } });
    await saveSpeechSession('s1', { ratings: { clareza: undefined, conforto: 4 } });
    expect(await db.speechSessions.get('s1')).toMatchObject({ kind: 'explicacao', topic: 'JOIN', ratings: { ritmo: 2, conforto: 4 } });
  });
  it('Encerrar: refused without a recording or done, nothing written; +8 XP once; closedAt kept', async () => {
    await expect(closeSpeechSession('s1', { kind: 'explicacao', notes: 'n' })).rejects.toBeInstanceOf(SpeechEmptyError);
    expect(await db.speechSessions.count()).toBe(0);
    expect(await closeSpeechSession('s1', { kind: 'exercicio', exercise: 'pausas', done: true })).toEqual({ xp: 8 });
    expect(await db.speechSessions.get('s1')).toMatchObject({ done: true, closedAt: at(23, 10) });
    vi.setSystemTime(at(23, 11));
    expect(await closeSpeechSession('s1', {})).toEqual({ xp: 0 });
    expect((await db.speechSessions.get('s1'))!.closedAt).toBe(at(23, 10));
    expect(await speechXp()).toEqual([expect.objectContaining({ id: 'xp-speech-s1', amount: 8, dayKey: '2026-11-23', areaId: 'area-intelecto' })]);
  });
  it('at most 2 sessions earn XP per day; the third still closes', async () => {
    for (const id of ['a', 'b', 'c']) await addSpeechRecording(id, rec(id), { kind: 'explicacao' });
    expect((await closeSpeechSession('a', {})).xp).toBe(8);
    expect((await closeSpeechSession('b', {})).xp).toBe(8);
    expect((await closeSpeechSession('c', {})).xp).toBe(0);
    expect((await db.speechSessions.get('c'))!.closedAt).toBe(at(23, 10));
    expect((await speechXp()).length).toBe(2);
  });
  it('Encerrar on a stored session: refused with notes only (notes untouched); accepted once a recording exists', async () => {
    await saveSpeechSession('s1', { kind: 'explicacao', notes: 'minhas palavras' });
    await expect(closeSpeechSession('s1', { notes: 'outras' })).rejects.toBeInstanceOf(SpeechEmptyError);
    expect(await db.speechSessions.get('s1')).toMatchObject({ notes: 'minhas palavras' });
    expect((await db.speechSessions.get('s1'))!.closedAt).toBeUndefined();
    await addSpeechRecording('s1', { ...rec('a'), capped: true }, {});
    expect(await closeSpeechSession('s1', { notes: 'outras' })).toEqual({ xp: 8 });
    expect(await db.speechSessions.get('s1')).toMatchObject({ notes: 'outras', recordings: [{ hash: 'a', capped: true }] });
  });
  it('Guardar on and off', async () => {
    await addSpeechRecording('s1', rec('a'), { kind: 'explicacao' });
    await setRecordingKeep('s1', 'a', true);
    expect((await db.speechSessions.get('s1'))!.recordings[0]).toEqual({ ...rec('a'), keep: true });
    await setRecordingKeep('s1', 'a', false);
    expect((await db.speechSessions.get('s1'))!.recordings[0]).toEqual(rec('a'));
  });
});

describe('real situations, program and settings', () => {
  it('a situation: today, now, the sentence in one line; Apagar and Desfazer', async () => {
    const s = await logSituation({ context: 'aula', repeats: 0, clarity: 4, note: '  Perguntei\n sem travar ' });
    expect(await db.speechSituations.get(s.id)).toMatchObject({ day: '2026-11-23', at: at(23, 10), context: 'aula', repeats: 0, clarity: 4, note: 'Perguntei sem travar' });
    expect('comfort' in (await db.speechSituations.get(s.id))!).toBe(false);
    await removeSituation(s.id);
    expect((await db.speechSituations.get(s.id))!.deleted).toBe(true);
    await restoreSituation(s.id);
    expect((await db.speechSituations.get(s.id))!.deleted).toBe(false);
  });
  it('one program at a time; the week is clamped; phase notes only on change; end and reopen', async () => {
    const p = await startSpeechProgram();
    expect((await startSpeechProgram()).id).toBe(p.id);
    expect(p).toMatchObject({ startDay: '2026-11-23', week: 1, status: 'ativo', phaseNotes: {} });
    expect((await setProgramWeek(p.id, 0)).week).toBe(1);
    expect((await setProgramWeek(p.id, 15)).week).toBe(12);
    const outbox = await db.outbox.count();
    await savePhaseNote(p.id, 1, '  Mais calmo nas aulas ');
    expect((await db.speechPrograms.get(p.id))!.phaseNotes[1]).toEqual({ text: 'Mais calmo nas aulas', day: '2026-11-23', answeredAt: at(23, 10) });
    const updated = (await db.speechPrograms.get(p.id))!.updatedAt;
    await savePhaseNote(p.id, 1, 'Mais calmo nas aulas');
    expect((await db.speechPrograms.get(p.id))!.updatedAt).toBe(updated);
    await savePhaseNote(p.id, 1, '   ');
    expect((await db.speechPrograms.get(p.id))!.phaseNotes).toEqual({});
    expect(await db.outbox.count()).toBe(outbox);   // same record: the outbox entry is replaced, not added
    expect(await endSpeechProgram(p.id)).toMatchObject({ status: 'encerrado', endedDay: '2026-11-23' });
    expect(await reopenSpeechProgram(p.id)).toMatchObject({ status: 'ativo', endedDay: undefined });
  });
  it('dismissSpeechNote keeps the other settings', async () => {
    await dismissSpeechNote();
    const s = (await db.settings.get('settings'))!;
    expect(s.speech).toEqual({ noteDismissed: true });
    expect(s.dayStartHour).toBe(4);
  });
});

describe('freeSpeechRecordings', () => {
  const serverHas = (has: (hash: string) => boolean) => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe('HEAD');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      return new Response(null, { status: has(url.split('/').pop()!) ? 200 : 404 });
    });
    vi.stubGlobal('fetch', f);
    return f;
  };
  /** Stores webm(n) on this device, not queued, and returns its hash. */
  const local = async (n: number) => { await storeMedia(webm(n), { upload: false }); return sha256Hex(webm(n))!; };

  beforeEach(async () => { await setMeta('syncToken', 'tok'); });

  it('server confirms: the local bytes go, the session keeps the reference, result counts it', async () => {
    const h = await local(1);
    await session('old', { recordings: [rec(h)] });
    serverHas(() => true);
    expect(await freeSpeechRecordings([h, 'f'.repeat(64)])).toEqual({ count: 1, bytes: 16, unconfirmed: 0 });
    expect(await db.mediaInfo.get(h)).toBeUndefined();
    expect(await db.mediaData.get(h)).toBeUndefined();
    expect((await db.speechSessions.get('old'))!.recordings.map((r) => r.hash)).toEqual([h]);
  });
  it('server answers 404 (the refused-upload case): nothing removed, unconfirmed 1', async () => {
    const h = await local(1);
    await session('old', { recordings: [rec(h)] });
    serverHas(() => false);
    expect(await freeSpeechRecordings([h])).toEqual({ count: 0, bytes: 0, unconfirmed: 1 });
    expect(await db.mediaInfo.get(h)).toBeDefined();
    expect(await db.mediaData.get(h)).toBeDefined();
  });
  it('offline (fetch rejects): nothing removed, unconfirmed 1', async () => {
    const h = await local(1);
    await session('old', { recordings: [rec(h)] });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await freeSpeechRecordings([h])).toEqual({ count: 0, bytes: 0, unconfirmed: 1 });
    expect(await db.mediaData.get(h)).toBeDefined();
  });
  it('no sync token: nothing removed and no request', async () => {
    await db.meta.delete('syncToken');
    const h = await local(1);
    await session('old', { recordings: [rec(h)] });
    const f = serverHas(() => true);
    expect(await freeSpeechRecordings([h])).toEqual({ count: 0, bytes: 0, unconfirmed: 1 });
    expect(f).not.toHaveBeenCalled();
    expect(await db.mediaData.get(h)).toBeDefined();
  });
  it('never removes: a kept recording, a recent one, a hash a live card uses, a soft-deleted session, or a queued file (not even asked)', async () => {
    const kept = await local(1); const recent = await local(2); const card = await local(3); const gone = await local(4);
    await storeMedia(webm(5), { upload: true }); const queued = sha256Hex(webm(5))!;
    const shared = await local(6);
    await session('a', { recordings: [{ ...rec(kept), keep: true }, rec(card), rec(queued), rec(shared)] });
    await session('b', { day: '2026-11-20', recordings: [rec(recent)] });
    await session('c', { deleted: true, recordings: [rec(gone)] });
    await session('d', { recordings: [{ ...rec(shared), keep: true }] });
    await saveNote({ type: 'basic', front: `Ouça [áudio](media:${card})`, back: 'x', draft: true });
    const f = serverHas(() => true);
    const out = await freeSpeechRecordings([kept, recent, card, gone, queued, shared]);
    expect(out.count).toBe(0);
    for (const h of [kept, recent, card, gone, queued, shared]) expect(await db.mediaInfo.get(h)).toBeDefined();
    expect(f.mock.calls.map((c) => c[0] as string).some((u) => u.endsWith(queued))).toBe(false);
  });
  it('a card that starts using the file while the server is answering keeps it', async () => {
    const h = await local(1);
    await session('old', { recordings: [rec(h)] });
    vi.stubGlobal('fetch', vi.fn(async () => {
      await saveNote({ type: 'basic', front: `Ouça [áudio](media:${h})`, back: 'x', draft: true });
      return new Response(null, { status: 200 });
    }));
    expect((await freeSpeechRecordings([h])).count).toBe(0);
    expect(await db.mediaData.get(h)).toBeDefined();
  });
});

describe('races and XP', () => {
  it('two recordings added at the same time to one session are both stored', async () => {
    await Promise.all([
      addSpeechRecording('s1', rec('a'), { kind: 'explicacao' }),
      addSpeechRecording('s1', rec('b'), { kind: 'explicacao' }),
    ]);
    expect((await db.speechSessions.get('s1'))!.recordings.map((r) => r.hash).sort()).toEqual(['a', 'b']);
  });
  it('closing with a live xp-speech event already there gives no second event', async () => {
    await addSpeechRecording('s1', rec('a'), { kind: 'explicacao' });
    expect(await closeSpeechSession('s1', {})).toEqual({ xp: 8 });
    expect(await closeSpeechSession('s1', { notes: 'x' })).toEqual({ xp: 0 });
    expect((await speechXp()).filter((x) => x.id === 'xp-speech-s1').length).toBe(1);
  });
});
