import { describe, expect, it } from 'vitest';
import type { PracticeScore, PracticeSession } from '../src/types';
import {
  INDICATORS, PRACTICE_DAILY_SESSIONS, PRACTICE_LIMITS, PRACTICE_STEPS, cleanErrorFields, cleanItems, cleanPracticeTitle,
  codeLines, compareFact, earnsPracticeXp, earnsRebuildXp, errorCardDraft, isPracticeStep, listOps, newPracticeFields,
  nextStep, normalizePractice, practiceHistory, practicePrompt, practiceSketchId, practiceXpAllowed, practiceXpId,
  practiceXpSession, prevStep, ratingsComplete, ratingsLine, rebuildFact, rebuildXpId, resumeSuggestion,
  sanitizePracticePatch, seriesSummary, stepFilled, stepLabel,
} from '../src/practice';

const S = (over: Partial<PracticeSession> = {}): PracticeSession => ({
  id: 'p1', createdAt: 1, updatedAt: 1, deleted: false, ...newPracticeFields({ title: 'Dedup' }), ...over,
});
const item = (id: string, text: string, done = false) => ({ id, text, done });

describe('steps', () => {
  it('nine steps in the method order, with neighbours', () => {
    expect(PRACTICE_STEPS.map((s) => s.label)).toEqual([
      'Problema', 'Fundamentos', 'Decompor', 'Decisões', 'Implementar', 'Testar', 'Feedback', 'Reconstruir', 'Fechar',
    ]);
    expect(stepLabel('plan')).toBe('Decompor');
    expect(nextStep('problem')).toBe('basics');
    expect(nextStep('close')).toBeUndefined();
    expect(prevStep('problem')).toBeUndefined();
    expect(prevStep('close')).toBe('rebuild');
    expect(isPracticeStep('plan')).toBe(true);
    expect(isPracticeStep('steps')).toBe(false);
  });

  it('stepFilled: content marks a step; blanks do not', () => {
    for (const { key } of PRACTICE_STEPS) expect(stepFilled(S(), key), key).toBe(false);
    expect(stepFilled(S({ problem: '   ' }), 'problem')).toBe(false);
    expect(stepFilled(S({ problem: 'dedup' }), 'problem')).toBe(true);
    expect(stepFilled(S({ basics: [item('a', 'set')] }), 'basics')).toBe(true);
    expect(stepFilled(S({ plan: [item('a', ' ')] }), 'plan')).toBe(false);
    expect(stepFilled(S({ decision: 'usar set' }), 'design')).toBe(true);
    expect(stepFilled(S({ code: 'x = 1' }), 'code')).toBe(true);
    expect(stepFilled(S({ tests: [item('a', '[] → []')] }), 'test')).toBe(true);
    expect(stepFilled(S({ feedback: [{ id: 'f', at: 1, source: 'person', text: 'ok' }] }), 'feedback')).toBe(true);
    expect(stepFilled(S({ rebuild: { code: 'x', startedAt: 1 } }), 'rebuild')).toBe(false);
    expect(stepFilled(S({ rebuild: { code: 'x', startedAt: 1, comparedAt: 2 } }), 'rebuild')).toBe(true);
    expect(stepFilled(S({ status: 'done' }), 'close')).toBe(true);
  });
});

describe('resumeSuggestion', () => {
  it('follows the method: problem, plan, open step, code, tests, rebuild', () => {
    expect(resumeSuggestion(S())).toBe('Escrever o problema em uma frase');
    const p = { problem: 'dedup' };
    expect(resumeSuggestion(S(p))).toBe('Decompor o problema em passos');
    expect(resumeSuggestion(S({ ...p, plan: [item('a', 'normalizar URL', true), item('b', ' gravar no banco ')] })))
      .toBe('Continuar: gravar no banco');
    const plan = [item('a', 'normalizar URL', true)];
    expect(resumeSuggestion(S({ ...p, plan }))).toBe('Implementar o primeiro passo');
    expect(resumeSuggestion(S({ ...p, plan, code: 'x' }))).toBe('Escrever um caso de teste');
    const tests = [item('t', '[] → []')];
    expect(resumeSuggestion(S({ ...p, plan, code: 'x', tests }))).toBe('Reconstruir sem consultar');
    expect(resumeSuggestion(S({ ...p, plan, code: 'x', tests, rebuild: { code: 'x', startedAt: 1, comparedAt: 2 } }))).toBe('');
  });

  it('a long step is cut to the next-action limit', () => {
    expect(resumeSuggestion(S({ problem: 'p', plan: [item('a', 'x'.repeat(400))] }))).toHaveLength(PRACTICE_LIMITS.nextAction);
  });
});

describe('creating and cleaning', () => {
  it('newPracticeFields: an open session at the first step, everything empty', () => {
    expect(newPracticeFields({ title: '  Dedup  por URL ', journeyId: 'j' })).toEqual({
      title: 'Dedup por URL', status: 'open', step: 'problem', journeyId: 'j',
      problem: '', inputs: '', outputs: '', basics: [], plan: [], alternatives: '', decision: '',
      language: 'python', code: '', tests: [], feedback: [], errors: [], ratings: {}, explanation: '',
    });
    expect(newPracticeFields({ title: 'x' })).not.toHaveProperty('journeyId');
  });

  it('cleanPracticeTitle: one space, no edges, 80 characters', () => {
    expect(cleanPracticeTitle('  Dedup   por\nURL ')).toBe('Dedup por URL');
    expect(cleanPracticeTitle('x'.repeat(100))).toHaveLength(80);
  });

  it('sanitizePracticePatch keeps indentation, drops a blank title, clears a blank next action', () => {
    expect(sanitizePracticePatch({ title: '   ' })).toEqual({});
    expect(sanitizePracticePatch({ title: ' Nova ' })).toEqual({ title: 'Nova' });
    expect(sanitizePracticePatch({ code: '    return x\n' })).toEqual({ code: '    return x\n' });
    expect(sanitizePracticePatch({ code: 'x'.repeat(20_001) }).code).toHaveLength(20_000);
    expect(sanitizePracticePatch({ problem: 'y'.repeat(2_001) }).problem).toHaveLength(2_000);
    expect(sanitizePracticePatch({ explanation: 'z'.repeat(700) }).explanation).toHaveLength(600);
    expect(sanitizePracticePatch({ nextAction: '  ' })).toEqual({ nextAction: undefined });
    expect(sanitizePracticePatch({ nextAction: ' testar a API ' })).toEqual({ nextAction: 'testar a API' });
    expect(sanitizePracticePatch({ step: 'nope' as never, language: 'rust' as never })).toEqual({});
    expect(sanitizePracticePatch({ journeyId: undefined })).toEqual({ journeyId: undefined });
  });

  it('cleanItems trims, drops blanks and caps size and count', () => {
    expect(cleanItems([item('a', '  set '), item('b', '   ')])).toEqual([item('a', 'set')]);
    expect(cleanItems(Array.from({ length: 40 }, (_, i) => item(`i${i}`, `passo ${i}`)))).toHaveLength(30);
    expect(cleanItems([item('a', 'x'.repeat(400))])[0]!.text).toHaveLength(300);
  });

  it('listOps: add, set, remove and moveUp', () => {
    const xs = [item('a', 'um'), item('b', 'dois')];
    expect(listOps.add(xs, '  três ', 'c')).toEqual([...xs, item('c', 'três')]);
    expect(listOps.add(xs, '   ', 'c')).toEqual(xs);
    expect(listOps.set(xs, 'b', { done: true })[1]).toEqual(item('b', 'dois', true));
    expect(listOps.remove(xs, 'a')).toEqual([item('b', 'dois')]);
    expect(listOps.moveUp(xs, 'b').map((x) => x.id)).toEqual(['b', 'a']);
    expect(listOps.moveUp(xs, 'a').map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('cleanErrorFields trims and cuts each field to 500', () => {
    expect(cleanErrorFields({ what: ' a ', why: 'b'.repeat(600), fix: '' })).toEqual({ what: 'a', why: 'b'.repeat(500), fix: '' });
  });

  it('normalizePractice fills what is missing or broken', () => {
    const broken = {
      id: 'p1', createdAt: 1, updatedAt: 1, deleted: false, title: 'T', status: 'weird', step: 'nope',
      plan: [{ id: 'a', text: 'ok' }, 'junk', { id: 3 }], language: 'rust', ratings: { delivered: 2, understood: 5 },
      errors: [{ id: 'e', what: 'w' }, { what: 'no id' }], feedback: [{ id: 'f', text: 't', source: 'robot' }],
      rebuild: { code: 'x' },
    } as unknown as PracticeSession;
    const n = normalizePractice(broken);
    expect(n).toMatchObject({
      title: 'T', status: 'open', step: 'problem', language: 'python', problem: '', basics: [], tests: [], code: '', explanation: '',
    });
    expect(n.plan).toEqual([item('a', 'ok')]);
    expect(n.ratings).toEqual({ delivered: 2 });
    expect(n.errors).toEqual([{ id: 'e', at: 0, what: 'w', why: '', fix: '' }]);
    expect(n.feedback).toEqual([{ id: 'f', at: 0, source: 'person', text: 't' }]);
    expect(n.rebuild).toBeUndefined();
    expect(normalizePractice(S({ rebuild: { code: 'y', startedAt: 3, peeked: true } })).rebuild).toEqual({ code: 'y', startedAt: 3, peeked: true });
  });
});

describe('normalizePractice optional fields', () => {
  it('drops wrongly typed optional fields so consumers never crash', () => {
    const bad = S({ title: 7 as unknown as string, nextAction: 5 as unknown as string, endedAt: '9' as unknown as number,
      journeyId: 3 as unknown as string, missionId: '' , deckId: {} as unknown as string });
    const n = normalizePractice(bad);
    expect(n.title).toBe('');
    expect('nextAction' in n).toBe(false);
    expect('endedAt' in n).toBe(false);
    expect('journeyId' in n).toBe(false);
    expect('missionId' in n).toBe(false);
    expect('deckId' in n).toBe(false);
    expect(() => practicePrompt({
      mode: 'normal', block: { kind: 'focus' }, sessions: [S({ nextAction: 5 as unknown as string }), n].map(normalizePractice),
    })).not.toThrow();
  });

  it('keeps well-typed optional fields', () => {
    const ok = S({ nextAction: 'ligar', endedAt: 5, journeyId: 'j', missionId: 'm', deckId: 'd' });
    expect(normalizePractice(ok)).toMatchObject({ nextAction: 'ligar', endedAt: 5, journeyId: 'j', missionId: 'm', deckId: 'd' });
  });
});

describe('facts and ratings', () => {
  it('codeLines counts non-blank lines', () => {
    expect(codeLines('a\n\n  \nb\n')).toBe(2);
    expect(codeLines('')).toBe(0);
  });

  it('rebuildFact in its four cases', () => {
    expect(rebuildFact(S())).toBe('Reconstrução: não feita nesta sessão.');
    expect(rebuildFact(S({ rebuild: { code: '', startedAt: 1 } }))).toBe('Reconstrução: começada, ainda sem comparar.');
    expect(rebuildFact(S({ rebuild: { code: 'a\nb', startedAt: 1, comparedAt: 2 } }))).toBe('Reconstrução: feita, 2 linhas, comparada.');
    expect(rebuildFact(S({ rebuild: { code: 'a', startedAt: 1, comparedAt: 2, peeked: true } })))
      .toBe('Reconstrução: feita, 1 linha, comparada. Você olhou a implementação durante a reconstrução.');
  });

  it('compareFact counts both sides', () => {
    expect(compareFact(S({ code: 'a\nb\nc', rebuild: { code: 'a', startedAt: 1, comparedAt: 2 } })))
      .toBe('1 linha na reconstrução, 3 na implementação.');
  });

  it('ratingsComplete and ratingsLine', () => {
    expect(ratingsComplete({ delivered: 0, understood: 1 })).toBe(false);
    expect(ratingsComplete({ delivered: 0, understood: 1, autonomous: 2 })).toBe(true);
    expect(ratingsLine({ delivered: 1, understood: 1, autonomous: 2 })).toBe('Entregue: parcial · Compreendido: em parte · Autônomo: sim');
    expect(ratingsLine({ delivered: 0 })).toBe('Entregue: não · Compreendido: — · Autônomo: —');
    expect(INDICATORS.map((i) => i.options)).toEqual([
      ['Não', 'Parcial', 'Sim'], ['Ainda não', 'Em parte', 'Sim'], ['Não', 'Com consulta', 'Sim'],
    ]);
    expect(INDICATORS.map((i) => i.question)).toEqual([
      'A funcionalidade ficou pronta?', 'Consigo explicar com minhas palavras', 'Reconstruí sem consultar',
    ]);
  });
});

describe('history', () => {
  const done = (i: number, r: [PracticeScore, PracticeScore, PracticeScore], over: Partial<PracticeSession> = {}) =>
    S({ id: `s${i}`, status: 'done', endedAt: 1000 + i, ratings: { delivered: r[0], understood: r[1], autonomous: r[2] }, ...over });

  it('keeps live closed sessions with all three ratings, oldest first, the last 10', () => {
    const sessions = [
      done(3, [2, 2, 2]), done(1, [0, 0, 0]), done(2, [1, 1, 1]),
      S({ id: 'open', ratings: { delivered: 2, understood: 2, autonomous: 2 } }),
      done(9, [2, 2, 2], { deleted: true }),
      S({ id: 'half', status: 'done', endedAt: 5000, ratings: { delivered: 2 } }),
    ];
    const h = practiceHistory(sessions);
    expect(h.count).toBe(3);
    expect(h.series.map((x) => x.key)).toEqual(['delivered', 'understood', 'autonomous']);
    expect(h.series.map((x) => x.label)).toEqual(['Entregue', 'Compreendido', 'Autônomo']);
    expect(h.series[0]!.values).toEqual([0, 1, 2]);
    expect(h.series[2]!.summary).toBe('Nível máximo em 1 das últimas 3');
    const twelve = Array.from({ length: 12 }, (_, i) => done(i, [(i % 3) as PracticeScore, 0, 0]));
    const h12 = practiceHistory(twelve);
    expect(h12.count).toBe(10);
    expect(h12.series[0]!.values[0]).toBe(2); // s2 is the oldest kept (2 % 3)
    expect(practiceHistory([])).toEqual({ count: 0, series: expect.any(Array) });
  });

  it('seriesSummary counts the top level, never averages', () => {
    expect(seriesSummary([2])).toBe('');
    expect(seriesSummary([1, 2])).toBe('Nível máximo em 1 das últimas 2');
    expect(seriesSummary([2, 2, 0, 1, 2])).toBe('Nível máximo em 3 das últimas 5');
    expect(seriesSummary([0, 2, 2, 0, 1, 2, 2])).toBe('Nível máximo em 3 das últimas 5');
    expect(seriesSummary([0, 1, 2, 0, 0, 2, 2, 1, 2, 0])).toBe('Nível máximo em 3 das últimas 5 · nas 5 anteriores: 1');
  });
});

describe('errors and XP', () => {
  it('errorCardDraft: the front asks, the back answers, the why goes to "Por quê?"', () => {
    expect(errorCardDraft({ what: ' usei return no for ', why: ' sai na 1ª volta ', fix: ' acumular e retornar depois ' })).toEqual({
      front: 'Erro: usei return no for\n\nQual é a ideia correta?', back: 'acumular e retornar depois', extra: 'sai na 1ª volta',
    });
    expect(errorCardDraft({ what: 'x', why: '  ', fix: '' })).toEqual({ front: 'Erro: x\n\nQual é a ideia correta?', back: '' });
  });

  it('XP needs real work', () => {
    expect(earnsPracticeXp(S({ problem: 'p', code: '  ' }))).toBe(false);
    expect(earnsPracticeXp(S({ problem: ' ', code: 'x' }))).toBe(false);
    expect(earnsPracticeXp(S({ problem: 'p', code: 'x' }))).toBe(true);
    expect(earnsRebuildXp(S({ code: 'x', rebuild: { code: ' ', startedAt: 1 } }))).toBe(false);
    expect(earnsRebuildXp(S({ code: '', rebuild: { code: 'y', startedAt: 1 } }))).toBe(false);
    expect(earnsRebuildXp(S({ code: 'x' }))).toBe(false);
    expect(earnsRebuildXp(S({ code: 'x', rebuild: { code: 'y', startedAt: 1 } }))).toBe(true);
  });

  it('deterministic ids and the daily cap of 3 sessions', () => {
    expect(practiceXpId('A')).toBe('xp-practice-A');
    expect(rebuildXpId('A')).toBe('xp-practice-rebuild-A');
    expect(practiceXpSession('xp-practice-rebuild-A')).toBe('A');
    expect(practiceXpSession('xp-practice-B')).toBe('B');
    expect(practiceXpSession('xp-study-goal-2026-11-13')).toBeUndefined();
    expect(PRACTICE_DAILY_SESSIONS).toBe(3);
    const today = ['xp-practice-A', 'xp-practice-rebuild-A', 'xp-practice-rebuild-B', 'xp-practice-C', 'xp-study-start-x'];
    expect(practiceXpAllowed(today, 'D')).toBe(false);
    expect(practiceXpAllowed(today, 'B')).toBe(true);
    expect(practiceXpAllowed(today.slice(0, 3), 'D')).toBe(true);
    expect(practiceXpAllowed([], 'D')).toBe(true);
  });

  it('practiceSketchId', () => {
    expect(practiceSketchId('01ABC')).toBe('sketch-p-01ABC');
  });
});

describe('practicePrompt', () => {
  const focus = { kind: 'focus' as const, journeyId: 'j-tech' };

  it('nothing outside focus and study blocks, nor on free or recovery days', () => {
    expect(practicePrompt({ mode: 'normal', sessions: [] })).toBeUndefined();
    for (const kind of ['body', 'routine', 'light'] as const) {
      expect(practicePrompt({ mode: 'normal', block: { kind }, sessions: [] }), kind).toBeUndefined();
    }
    expect(practicePrompt({ mode: 'recovery', block: focus, sessions: [] })).toBeUndefined();
    expect(practicePrompt({ mode: 'free', block: focus, sessions: [] })).toBeUndefined();
    expect(practicePrompt({ mode: 'low', block: { kind: 'study' }, sessions: [] })).toEqual({ kind: 'start' });
  });

  it('resumes the most recent open session of the block journey', () => {
    const sessions = [
      S({ id: 'old', journeyId: 'j-tech', updatedAt: 5 }),
      S({ id: 'new', journeyId: 'j-tech', updatedAt: 9 }),
      S({ id: 'other', journeyId: 'j-x', updatedAt: 20 }),
      S({ id: 'gone', journeyId: 'j-tech', updatedAt: 30, deleted: true }),
    ];
    expect(practicePrompt({ mode: 'normal', block: focus, sessions })).toMatchObject({ kind: 'resume', session: { id: 'new' } });
    // A block without a journey matches sessions without one.
    expect(practicePrompt({ mode: 'normal', block: { kind: 'study' }, sessions: [S({ id: 'loose', updatedAt: 2 }), ...sessions] }))
      .toMatchObject({ kind: 'resume', session: { id: 'loose' } });
  });

  it('else starts, offering the first action left by the last closed session', () => {
    const sessions = [
      S({ id: 'a', journeyId: 'j-tech', status: 'done', endedAt: 10, nextAction: 'testar a deduplicação' }),
      S({ id: 'b', journeyId: 'j-tech', status: 'done', endedAt: 20, nextAction: ' ligar a segunda fonte ' }),
      S({ id: 'c', journeyId: 'j-x', status: 'done', endedAt: 30, nextAction: 'outra coisa' }),
    ];
    expect(practicePrompt({ mode: 'normal', block: focus, sessions })).toEqual({ kind: 'start', firstAction: 'ligar a segunda fonte' });
    expect(practicePrompt({ mode: 'normal', block: focus, sessions: [S({ journeyId: 'j-tech', status: 'done', endedAt: 1, nextAction: '  ' })] }))
      .toEqual({ kind: 'start' });
  });
});
