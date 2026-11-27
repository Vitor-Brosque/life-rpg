import { describe, expect, it } from 'vitest';
import type { Strategy } from '../src/types';
import {
  STRATEGY_ISSUE_TEXT, adjustedDraft, adjustmentLines, dueLine, dueStrategies, legacyExperiment, newStrategyDraft,
  postponedReview, quickStrategy, strategiesForBlock, strategiesInRange, strategyChanges, strategyDraftOf, strategyDue,
  strategyFields, strategyGroups, strategyIssue, strategyKey, strategyLine, strategyLinkFrom, strategyLinkValue,
  strategyMeta, strategyTrash, testingStrategies,
} from '../src/strategy';

const TODAY = '2026-11-23';
const base = { createdAt: 1, updatedAt: 1, deleted: false };
const strat = (id: string, p: Partial<Strategy> = {}): Strategy => ({
  ...base, id, title: `Estratégia ${id}`, source: 'ideia', startDay: '2026-11-16', reviewDay: '2026-11-30', status: 'testando', ...p,
});

describe('which strategies show where', () => {
  const list = [
    strat('a', { startDay: '2026-11-10', reviewDay: '2026-11-24' }),
    strat('b', { startDay: '2026-11-20', createdAt: 5 }),
    strat('c', { startDay: '2026-11-20', createdAt: 9, link: { kind: 'block', id: 'tech' } }),
    strat('d', { status: 'mantida', decidedDay: '2026-11-22' }),
    strat('e', { trashedAt: 10 }),
    strat('f', { deleted: true }),
    strat('g', { startDay: '2026-11-24' }),
    strat('h', { link: { kind: 'journey', id: 'j-tech' } }),
  ];
  it('testing: visible, started, newest start first (ties: newest created first)', () => {
    expect(testingStrategies(list, TODAY).map((s) => s.id)).toEqual(['c', 'b', 'h', 'a']);
  });
  it('the Agora line: one, two, and more than two titles', () => {
    expect(strategyLine([])).toBeUndefined();
    expect(strategyLine(['Celular longe'])).toBe('Estratégia em teste: Celular longe');
    expect(strategyLine(['A', ' B\n  b '])).toBe('Estratégias em teste: A · B b');
    expect(strategyLine(['A', 'B', 'C', 'D'])).toBe('Estratégias em teste: A · B · +2');
  });
  it('the block line: linked to one of the block ids or to its journey', () => {
    expect(strategiesForBlock(list, TODAY, ['tech', 'tech-sab']).map((s) => s.id)).toEqual(['c']);
    expect(strategiesForBlock(list, TODAY, ['other'], 'j-tech').map((s) => s.id)).toEqual(['h']);
    expect(strategiesForBlock(list, TODAY, ['other'])).toEqual([]);
  });
  it('the old weekly experiment shows unless a visible strategy has the same title', () => {
    expect(legacyExperiment('  Celular longe ', [])).toBe('Celular longe');
    expect(legacyExperiment('Celular longe', [strat('x', { title: 'celular  LONGE' })])).toBeUndefined();
    expect(legacyExperiment('Celular longe', [strat('x', { title: 'Celular longe', trashedAt: 3 })])).toBe('Celular longe');
    expect(legacyExperiment('   ', [])).toBeUndefined();
    expect(legacyExperiment(undefined, [])).toBeUndefined();
  });
  it('"Hora de decidir" from the review day on, only while testing', () => {
    expect(strategyDue(strat('x', { reviewDay: '2026-11-23' }), TODAY)).toBe(true);
    expect(strategyDue(strat('x', { reviewDay: '2026-11-24' }), TODAY)).toBe(false);
    expect(strategyDue(strat('x', { reviewDay: '2026-11-01', status: 'descartada', decidedDay: '2026-11-02' }), TODAY)).toBe(false);
    expect(strategyDue(strat('x', { reviewDay: '2026-11-01', trashedAt: 1 }), TODAY)).toBe(false);
    const due = [strat('p', { reviewDay: '2026-11-20' }), strat('q', { reviewDay: '2026-11-18' }), strat('r', { reviewDay: '2026-12-01' })];
    expect(dueStrategies(due, TODAY).map((s) => s.id)).toEqual(['q', 'p']);
    expect(dueLine(['A', 'B'])).toBe('Hora de decidir: “A” · “B”. Decidir é opcional.');
  });
});

describe('the list', () => {
  it('groups by status in order, testing by review day, decided by newest decision; trash apart', () => {
    const list = [
      strat('t1', { reviewDay: '2026-12-01' }),
      strat('t2', { reviewDay: '2026-11-20' }),
      strat('m1', { status: 'mantida', decidedDay: '2026-11-10' }),
      strat('m2', { status: 'mantida', decidedDay: '2026-11-18' }),
      strat('d1', { status: 'descartada', decidedDay: '2026-11-05' }),
      strat('x1', { trashedAt: 5 }),
      strat('x2', { trashedAt: 9 }),
    ];
    expect(strategyGroups(list).map((g) => [g.title, g.items.map((s) => s.id)])).toEqual([
      ['Testando', ['t2', 't1']], ['Mantidas', ['m2', 'm1']], ['Descartadas', ['d1']],
    ]);
    expect(strategyTrash(list).map((s) => s.id)).toEqual(['x2', 'x1']);
    expect(strategyGroups([])).toEqual([]);
  });
  it('the line under each title', () => {
    expect(strategyMeta(strat('a', { startDay: '2026-11-10', reviewDay: '2026-11-24' }))).toBe('Ideia minha · desde 10/11 · decidir em 24/11');
    expect(strategyMeta(strat('a', { source: 'padroes', startDay: '2026-11-02', status: 'mantida', decidedDay: '2026-11-16' })))
      .toBe('Padrões · desde 02/11 · mantida em 16/11');
    expect(strategyMeta(strat('a', { source: 'ia', status: 'ajustada', decidedDay: '2026-11-20' })))
      .toBe('Conversa de IA · desde 16/11 · ajustada em 20/11');
  });
  it('"Decidir depois": a week after today, or after a review day still ahead', () => {
    expect(postponedReview({ reviewDay: '2026-11-20' }, TODAY)).toBe('2026-11-30');
    expect(postponedReview({ reviewDay: '2026-11-25' }, TODAY)).toBe('2026-12-02');
  });
});

describe('strategies in a report period', () => {
  it('testing and started by the end, or decided on or after the start; oldest start first', () => {
    const list = [
      strat('late', { startDay: '2026-11-16' }),
      strat('early', { startDay: '2026-11-01' }),
      strat('after', { startDay: '2026-11-17' }),
      strat('decidedIn', { startDay: '2026-10-20', status: 'mantida', decidedDay: '2026-11-10' }),
      strat('decidedBefore', { startDay: '2026-10-20', status: 'descartada', decidedDay: '2026-11-08' }),
      strat('trashed', { startDay: '2026-11-01', trashedAt: 1 }),
    ];
    expect(strategiesInRange(list, { start: '2026-11-09', end: '2026-11-16' }).map((s) => s.id))
      .toEqual(['decidedIn', 'early', 'late']);
  });
});

describe('titles from one tap', () => {
  it('the Nova semana adjustment: one strategy per line, no repeats, one line each', () => {
    expect(adjustmentLines(' Celular longe \n\n  dormir   antes\ncelular LONGE\n')).toEqual(['Celular longe', 'dormir antes']);
    expect(adjustmentLines('   ')).toEqual([]);
    expect(adjustmentLines('x'.repeat(250))).toEqual(['x'.repeat(200)]);
  });
  it('quickStrategy: from today, two weeks to decide; blank gives nothing', () => {
    expect(quickStrategy('  Nesta semana,\nversão mínima ', 'padroes', TODAY)).toEqual({
      title: 'Nesta semana, versão mínima', source: 'padroes', startDay: TODAY, reviewDay: '2026-12-07', status: 'testando',
    });
    expect(quickStrategy('  ', 'ideia', TODAY)).toBeUndefined();
  });
  it('same title without accents, case or spaces', () => {
    expect(strategyKey('  Sessão   CURTA ')).toBe(strategyKey('sessao curta'));
  });
});

describe('the sheet', () => {
  it('a new draft: Ideia minha, from today, two weeks', () => {
    expect(newStrategyDraft(TODAY)).toEqual({
      title: '', source: 'ideia', sourceNote: '', why: '', observe: '', startDay: TODAY, reviewDay: '2026-12-07',
      status: 'testando', decisionNote: '',
    });
  });
  it('issues: a title, a start up to today, a decision after the start', () => {
    const ok = newStrategyDraft(TODAY, { title: 'Celular longe' });
    expect(strategyIssue(ok, TODAY)).toBeUndefined();
    expect(strategyIssue({ ...ok, title: '  ' }, TODAY)).toBe('title');
    expect(strategyIssue({ ...ok, startDay: '2026-11-24' }, TODAY)).toBe('start');
    expect(strategyIssue({ ...ok, startDay: '' }, TODAY)).toBe('start');
    expect(strategyIssue({ ...ok, reviewDay: TODAY }, TODAY)).toBe('review');
    expect(STRATEGY_ISSUE_TEXT.review).toBe('O dia de decidir precisa ser depois do início.');
  });
  it('stored fields: one line, cut, blanks absent, source note only for IA and Pesquisa, note only when decided', () => {
    const d = newStrategyDraft(TODAY, {
      title: '  Celular \n em outro cômodo ', source: 'ideia', sourceNote: 'Claude', why: ' ', observe: ' Escapes  e início ',
      link: { kind: 'block', id: 'tech' }, decisionNote: 'ignorada',
    });
    expect(strategyFields(d)).toEqual({
      title: 'Celular em outro cômodo', source: 'ideia', observe: 'Escapes e início', link: { kind: 'block', id: 'tech' },
      startDay: TODAY, reviewDay: '2026-12-07', status: 'testando',
    });
    expect(strategyFields({ ...d, source: 'ia', status: 'mantida', decisionNote: ' Funcionou.\nVou manter. ' })).toMatchObject({
      sourceNote: 'Claude', status: 'mantida', decisionNote: 'Funcionou.\nVou manter.',
    });
  });
  it('changes: only what differs; deciding stamps the day; back to testing clears the decision', () => {
    const s = strat('a', { title: 'Celular longe', why: 'Menos escapes', link: { kind: 'block', id: 'tech' } });
    const initial = strategyDraftOf(s);
    expect(strategyChanges(initial, initial, TODAY)).toEqual({});
    const cleared = strategyChanges(initial, { ...initial, why: '', title: 'Celular  longe ' }, TODAY);
    expect(Object.keys(cleared)).toEqual(['why']);
    expect(cleared.why).toBeUndefined();
    expect(Object.keys(strategyChanges(initial, { ...initial, link: undefined }, TODAY))).toEqual(['link']);
    expect(strategyChanges(initial, { ...initial, status: 'mantida', decisionNote: ' Deu certo ' }, TODAY))
      .toEqual({ status: 'mantida', decisionNote: 'Deu certo', decidedDay: TODAY });
    const decided = strategyDraftOf(strat('a', { status: 'mantida', decidedDay: '2026-11-20', decisionNote: 'Deu certo' }));
    expect(strategyChanges(decided, { ...decided, decisionNote: 'Deu certo nos dias de aula' }, TODAY))
      .toEqual({ decisionNote: 'Deu certo nos dias de aula' });
    expect(strategyChanges(decided, { ...decided, status: 'descartada' }, TODAY)).toEqual({ status: 'descartada', decidedDay: TODAY });
    const back = strategyChanges(decided, { ...decided, status: 'testando' }, TODAY);
    expect(Object.keys(back).sort()).toEqual(['decidedDay', 'decisionNote', 'status']);
    expect(back).toEqual({ status: 'testando', decidedDay: undefined, decisionNote: undefined });
  });
  it('"Testar a versão ajustada": same title, origin, reasons and link, from today', () => {
    const s = strat('a', { source: 'ia', sourceNote: 'Claude', why: 'x', observe: 'y', link: { kind: 'journey', id: 'j' }, status: 'ajustada', decidedDay: '2026-11-22', decisionNote: 'z' });
    expect(adjustedDraft(s, TODAY)).toEqual({
      title: 'Estratégia a', source: 'ia', sourceNote: 'Claude', why: 'x', observe: 'y', link: { kind: 'journey', id: 'j' },
      startDay: TODAY, reviewDay: '2026-12-07', status: 'testando', decisionNote: '',
    });
  });
  it('the link select value', () => {
    expect(strategyLinkValue({ kind: 'block', id: 'b1' })).toBe('block:b1');
    expect(strategyLinkValue(undefined)).toBe('');
    expect(strategyLinkFrom('journey:j-1:x')).toEqual({ kind: 'journey', id: 'j-1:x' });
    expect(strategyLinkFrom('')).toBeUndefined();
    expect(strategyLinkFrom('mission:m1')).toBeUndefined();
  });
});
