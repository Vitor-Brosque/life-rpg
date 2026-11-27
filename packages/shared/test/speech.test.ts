import { describe, expect, it } from 'vitest';
import type { SpeechProgram, SpeechRecording, SpeechSession } from '../src/types';
import {
  SPEECH_FREE_ACTIVITIES, SPEECH_READINGS, SPEECH_WEEKS, activeProgram, compareDefaults, earnsSpeechXp, hasSpeechChanges,
  isPhaseEnd, mergeSpeechPatch, newSpeechDraft, phaseOfWeek, presetFields, presetOf, programLine, readingWpm,
  recordingLabel, retentionCandidates, sessionWpm, speechChanges, speechClock, speechCounted, speechDraftOf, speechRecordings,
  speechSessionTitle, speechSuggestions, speechXpAllowed, speechXpId, unionRecordings, withKeep, withRecording, wordCount,
} from '../src/speech';
import { base } from './patternFixture';

const rec = (hash: string, p: Partial<SpeechRecording> = {}): SpeechRecording => ({ hash, durationMs: 60_000, at: 1, ...p });
const sess = (id: string, p: Partial<SpeechSession> = {}): SpeechSession => ({
  ...base, id, day: '2026-11-23', kind: 'explicacao', recordings: [], ratings: {}, ...p,
});
const prog = (id: string, p: Partial<SpeechProgram> = {}): SpeechProgram => ({
  ...base, id, startDay: '2026-11-23', week: 1, status: 'ativo', phaseNotes: {}, ...p,
});

describe('reference readings and speed', () => {
  it('three original passages of 120–180 words', () => {
    expect(SPEECH_READINGS.map((r) => r.id)).toEqual(['feira', 'biblioteca', 'trem']);
    expect(SPEECH_READINGS.map((r) => wordCount(r.text))).toEqual([132, 127, 127]);
  });
  it('wordCount: pieces with a letter or digit; a dash alone is not a word', () => {
    expect(wordCount('  Olá — mundo, 2026!  ')).toBe(3);
    expect(wordCount('')).toBe(0);
  });
  it('words ÷ minutes, rounded; none when capped, shorter than 10 s or an unknown passage', () => {
    expect(readingWpm('feira', { durationMs: 60_000 })).toBe(132);
    expect(readingWpm('feira', { durationMs: 66_000 })).toBe(120);
    expect(readingWpm('biblioteca', { durationMs: 54_321 })).toBe(140);
    expect(readingWpm('feira', { durationMs: 9_999 })).toBeUndefined();
    expect(readingWpm('feira', { durationMs: 10_000 })).toBe(792);
    expect(readingWpm('feira', { durationMs: 180_000, capped: true })).toBeUndefined();
    // At the limit the reading may not have finished, whoever stopped it: no speed even without the flag.
    expect(readingWpm('feira', { durationMs: 180_000 })).toBeUndefined();
    expect(readingWpm('feira', { durationMs: 179_999 })).toBeDefined();
    expect(readingWpm('outro', { durationMs: 60_000 })).toBeUndefined();
    expect(readingWpm(undefined, { durationMs: 60_000 })).toBeUndefined();
  });
  it('only reference readings have a speed: never spontaneous speech', () => {
    expect(sessionWpm({ kind: 'leitura', passage: 'trem' }, { durationMs: 60_000 })).toBe(127);
    expect(sessionWpm({ kind: 'explicacao', passage: 'trem' }, { durationMs: 60_000 })).toBeUndefined();
    expect(sessionWpm({ kind: 'exercicio' }, { durationMs: 60_000 })).toBeUndefined();
  });
  it('speechClock: minutes and seconds', () => {
    expect(speechClock(65_000)).toBe('1:05');
    expect(speechClock(180_000)).toBe('3:00');
    expect(speechClock(999)).toBe('0:00');
  });
});

describe('sessions', () => {
  it('titles: kind, then the passage, exercise or simulation, then his topic', () => {
    expect(speechSessionTitle({ kind: 'leitura', passage: 'feira', topic: 'ignorado' })).toBe('Leitura de referência · A feira de sábado');
    expect(speechSessionTitle({ kind: 'exercicio', exercise: 'pausas' })).toBe('Exercício · Pausas');
    expect(speechSessionTitle({ kind: 'simulacao', simulation: 'pergunta', topic: '  JOIN  ' })).toBe('Simulação · Pergunta em aula · JOIN');
    expect(speechSessionTitle({ kind: 'explicacao', topic: 'explicar um JOIN' })).toBe('Explicação espontânea · explicar um JOIN');
    expect(speechSessionTitle({ kind: 'explicacao' })).toBe('Explicação espontânea');
  });
  it('counted: closed, recorded or done; deleted out', () => {
    expect(speechCounted(sess('a'))).toBe(false);
    expect(speechCounted(sess('a', { closedAt: 5 }))).toBe(true);
    expect(speechCounted(sess('a', { recordings: [rec('h')] }))).toBe(true);
    expect(speechCounted(sess('a', { done: true }))).toBe(true);
    expect(speechCounted(sess('a', { done: true, deleted: true }))).toBe(false);
  });
  it('XP of effort: a recording or "Fiz a atividade"; at most 2 sessions a day', () => {
    expect(earnsSpeechXp(sess('a'))).toBe(false);
    expect(earnsSpeechXp(sess('a', { recordings: [rec('h')] }))).toBe(true);
    expect(earnsSpeechXp(sess('a', { done: true }))).toBe(true);
    expect(speechXpId('s1')).toBe('xp-speech-s1');
    expect(speechXpAllowed([], 's1')).toBe(true);
    expect(speechXpAllowed(['xp-speech-a', 'xp-practice-b'], 's1')).toBe(true);
    expect(speechXpAllowed(['xp-speech-a', 'xp-speech-b'], 's1')).toBe(false);
    expect(speechXpAllowed(['xp-speech-a', 'xp-speech-s1'], 's1')).toBe(true);
  });
  it('recordings: the same file once; Guardar on and off', () => {
    const list = withRecording([rec('a')], rec('b'));
    expect(list.map((r) => r.hash)).toEqual(['a', 'b']);
    expect(withRecording(list, rec('a', { at: 9 }))).toEqual(list);
    expect(withKeep(list, 'b', true)[1]).toEqual(rec('b', { keep: true }));
    expect(withKeep(withKeep(list, 'b', true), 'b', false)[1]).toEqual(rec('b'));
  });
  it('unionRecordings: base plus what the other side has, by hash, ordered by when each was saved', () => {
    const local = [rec('a', { at: 10 }), rec('c', { at: 30 })];
    const remote = [rec('b', { at: 20 }), rec('a', { at: 10, durationMs: 5 })];
    expect(unionRecordings(remote, local)).toEqual([rec('a', { at: 10, durationMs: 5 }), rec('b', { at: 20 }), rec('c', { at: 30 })]);
    expect(unionRecordings(local, remote).map((r) => r.hash)).toEqual(['a', 'b', 'c']);
    expect(unionRecordings(local, local)).toEqual(local);
    expect(unionRecordings([], [])).toEqual([]);
  });
  it('unionRecordings: Guardar follows the base (the version that wins); the cap survives from either side; the same time keeps the order', () => {
    // He turned Guardar off on the winning side: an older copy on the other device must not turn it back on.
    expect(unionRecordings([rec('a')], [rec('a', { keep: true })])).toEqual([rec('a')]);
    expect(unionRecordings([rec('a', { keep: true })], [rec('a')])).toEqual([rec('a', { keep: true })]);
    expect(unionRecordings([rec('a')], [rec('a', { capped: true })])).toEqual([rec('a', { capped: true })]);
    expect(unionRecordings([rec('x', { at: 5 }), rec('y', { at: 5 })], [rec('z', { at: 5 })]).map((r) => r.hash)).toEqual(['x', 'y', 'z']);
    const base = [rec('a')];
    unionRecordings(base, [rec('a', { keep: true }), rec('b')]);
    expect(base).toEqual([rec('a')]);
  });
});

describe('the session sheet: only touched fields that changed', () => {
  it('a preset counts as chosen', () => {
    const p = { kind: 'leitura' as const, size: 5 as const, passage: 'feira' };
    expect(presetFields(p)).toEqual(['kind', 'size', 'passage']);
    expect(presetFields({ kind: 'explicacao', topic: '' })).toEqual(['kind']);
    expect(newSpeechDraft(p)).toEqual({ kind: 'leitura', size: 5, passage: 'feira', topic: '', ratings: {}, notes: '', done: false });
  });
  it('untouched or unchanged fields stay out; text trimmed and capped; blank clears', () => {
    const initial = speechDraftOf(sess('a', { topic: 'JOIN', notes: 'ok', ratings: { clareza: 3 }, size: 15 }));
    const draft = { ...initial, size: 5 as const, topic: '  JOIN  ', notes: '   ', ratings: { clareza: 4 as const, conforto: 2 as const } };
    expect(speechChanges(initial, draft, new Set())).toEqual({});
    const out = speechChanges(initial, draft, new Set(['size', 'topic', 'notes', 'ratings']));
    expect(out).toEqual({ size: 5, notes: undefined, ratings: { clareza: 4, conforto: 2 } });
    expect('topic' in out).toBe(false);
    expect(hasSpeechChanges(out)).toBe(true);
    expect(hasSpeechChanges({})).toBe(false);
  });
  it('done off is written as undefined; kind only when set', () => {
    const initial = speechDraftOf(sess('a', { done: true }));
    expect(speechChanges(initial, { ...initial, done: false }, new Set(['done']))).toEqual({ done: undefined });
    expect(speechChanges(newSpeechDraft(), newSpeechDraft(), new Set(['kind']))).toEqual({});
  });
  it('ratings merge key by key; a cleared key is removed', () => {
    expect(mergeSpeechPatch({ ratings: { clareza: 3, ritmo: 2 } }, { ratings: { clareza: undefined, pausas: 5 }, notes: 'x' }))
      .toEqual({ ratings: { ritmo: 2, pausas: 5 }, notes: 'x' });
    expect(mergeSpeechPatch({ ratings: { clareza: 3 } }, { size: 5 })).toEqual({ size: 5 });
  });
});

describe('the 12-week program', () => {
  it('12 weeks in four phases, three sizes each', () => {
    expect(SPEECH_WEEKS.map((w) => w.week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(SPEECH_WEEKS.map((w) => w.phase)).toEqual([1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 4]);
    for (const w of SPEECH_WEEKS) expect(w.activities.map((x) => x.size)).toEqual([5, 15, 30]);
    expect(SPEECH_FREE_ACTIVITIES.map((x) => x.size)).toEqual([5, 15, 30]);
  });
  it('phase ends at weeks 2, 5, 8 and 12; out-of-range weeks are clamped', () => {
    expect([1, 2, 3, 5, 8, 11, 12].map(isPhaseEnd)).toEqual([false, true, false, true, true, false, true]);
    expect(phaseOfWeek(0)).toBe(1);
    expect(phaseOfWeek(13)).toBe(4);
    expect(programLine({ week: 3 })).toBe('Semana 3 de 12 · Fase 2: Pausas, ritmo, articulação, ênfase e volume confortável');
    expect(programLine({ week: 99 })).toBe('Semana 12 de 12 · Fase 4: Situações reais');
  });
  it('the active program: one at a time, latest start then newest', () => {
    expect(activeProgram([])).toBeUndefined();
    expect(activeProgram([prog('a', { status: 'encerrado', endedDay: '2026-11-30' })])).toBeUndefined();
    expect(activeProgram([
      prog('a', { startDay: '2026-11-02' }), prog('b', { startDay: '2026-11-09', createdAt: 5 }),
      prog('c', { startDay: '2026-11-09', createdAt: 9 }), prog('d', { startDay: '2026-12-01', deleted: true }),
    ])?.id).toBe('c');
  });
  it('suggestions: the week focus and activities, else the free ones without focus', () => {
    expect(speechSuggestions(undefined)).toEqual({ activities: SPEECH_FREE_ACTIVITIES });
    const s = speechSuggestions({ week: 3 });
    expect(s.focus).toBe('Pausas: parar no fim de cada ideia, respirar e seguir.');
    expect(presetOf(s.activities[0]!)).toEqual({ kind: 'exercicio', size: 5, exercise: 'pausas' });
    expect(presetOf(SPEECH_WEEKS[0]!.activities[0]!)).toEqual({ kind: 'leitura', size: 5, passage: 'feira' });
  });
});

describe('recordings: list, comparison and retention', () => {
  const sessions = [
    sess('r1', { kind: 'leitura', passage: 'feira', day: '2026-10-01', recordings: [rec('f1', { at: 10, durationMs: 60_000 })], ratings: { clareza: 3 } }),
    sess('e1', { day: '2026-10-02', topic: 'JOIN', recordings: [rec('e', { at: 20, durationMs: 95_000 })] }),
    sess('r2', { kind: 'leitura', passage: 'trem', day: '2026-11-01', recordings: [rec('t1', { at: 30 })] }),
    sess('r3', { kind: 'leitura', passage: 'feira', day: '2026-11-20', recordings: [rec('f2', { at: 40, durationMs: 66_000 })] }),
    sess('x', { deleted: true, recordings: [rec('gone', { at: 50 })] }),
  ];
  it('every live recording, oldest first, with the speed only on readings', () => {
    const items = speechRecordings(sessions);
    expect(items.map((r) => r.key)).toEqual(['r1:f1', 'e1:e', 'r2:t1', 'r3:f2']);
    expect(items[0]).toMatchObject({ day: '2026-10-01', wpm: 132, reference: true, keep: false, ratings: { clareza: 3 } });
    expect(items[1]!.wpm).toBeUndefined();
    expect(recordingLabel(items[1]!)).toBe('02/10 · Explicação espontânea · JOIN · 1:35');
  });
  it('defaults: first and latest reading of the passage read last; else oldest and newest; nothing below two', () => {
    expect(compareDefaults(speechRecordings(sessions))).toEqual({ a: 'r1:f1', b: 'r3:f2' });
    expect(compareDefaults(speechRecordings(sessions.slice(0, 3)))).toEqual({ a: 'r1:f1', b: 'r2:t1' });
    expect(compareDefaults(speechRecordings(sessions.slice(0, 1)))).toEqual({});
  });
  it('retention: not readings, not kept, 30 days or older; a file used by a kept or recent recording stays', () => {
    const list = [
      sess('old', { day: '2026-10-01', recordings: [rec('a'), rec('b', { keep: true }), rec('shared')] }),
      sess('recent', { day: '2026-10-25', recordings: [rec('c'), rec('shared')] }),
      sess('read', { kind: 'leitura', passage: 'feira', day: '2026-09-01', recordings: [rec('d')] }),
      sess('old2', { day: '2026-10-24', kind: 'exercicio', exercise: 'pausas', recordings: [rec('a'), rec('e', { durationMs: 5_000 })] }),
    ];
    expect(retentionCandidates(list, '2026-11-23')).toEqual([
      { hash: 'a', sessionId: 'old', day: '2026-10-01', title: 'Explicação espontânea', durationMs: 60_000 },
      { hash: 'e', sessionId: 'old2', day: '2026-10-24', title: 'Exercício · Pausas', durationMs: 5_000 },
    ]);
    // On 31/10 only "old" is 30 days old, and its files are also used by younger sessions (or kept).
    expect(retentionCandidates(list, '2026-10-31')).toEqual([]);
    expect(retentionCandidates(list.slice(0, 1), '2026-10-30')).toEqual([]);
  });
});
