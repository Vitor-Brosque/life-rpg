import { describe, expect, it } from 'vitest';
import type { Goal, Journey, Week } from '../src/types';
import {
  GOAL_ACTIVE_MAX, activeGoals, goalAnswers, goalChanges, goalCountText, goalCounts, goalDraftOf, goalFields, goalGroups, goalIssue,
  goalLimitReached, goalMeta, goalNeedsPause, goalSave, goalTally, goalWeekLine, newGoalDraft, nextGoalOrder, oldGoals, pickableGoals,
  purposeChain, sortedGoals,
} from '../src/goals';
import { timestampAt } from '../src/dates';
import { base, block, mission, session } from './patternFixture';

const goal = (id: string, p: Partial<Goal> = {}): Goal => ({ ...base, id, title: `Objetivo ${id}`, status: 'ativo', order: 0, ...p });
const journey = (id: string, p: Partial<Journey> = {}): Journey => ({ ...base, id, title: `Jornada ${id}`, status: 'active', order: 0, ...p });

describe('the list of goals', () => {
  const list = [
    goal('a', { order: 2 }),
    goal('b', { order: 1 }),
    goal('p', { status: 'pausado', order: 0 }),
    goal('c', { status: 'concluido', order: 3 }),
    goal('x', { status: 'arquivado', order: 4 }),
    goal('d', { deleted: true }),
  ];
  it('active, paused, concluded, archived; each by order; deleted ones out', () => {
    expect(sortedGoals(list).map((g) => g.id)).toEqual(['b', 'a', 'p', 'c', 'x']);
    expect(activeGoals(list).map((g) => g.id)).toEqual(['b', 'a']);
    expect(pickableGoals(list).map((g) => g.id)).toEqual(['b', 'a', 'p']);
    expect(pickableGoals(list, 'c').map((g) => g.id)).toEqual(['b', 'a', 'p', 'c']);
    expect(nextGoalOrder(list)).toBe(5);
    expect(nextGoalOrder([])).toBe(0);
  });
  it('the meta line: the status when not active, and the horizon', () => {
    expect(goalMeta(goal('a', { horizon: ' 2027 ' }))).toBe('2027');
    expect(goalMeta(goal('a', { status: 'pausado', horizon: 'julho de 2027' }))).toBe('Pausado · julho de 2027');
    expect(goalMeta(goal('a'))).toBe('');
  });
});

describe('at most five active', () => {
  const five = ['1', '2', '3', '4', '5'].map((id, i) => goal(id, { order: i }));
  it('the limit counts the other active goals only', () => {
    expect(GOAL_ACTIVE_MAX).toBe(5);
    expect(goalLimitReached(five.slice(0, 4))).toBe(false);
    expect(goalLimitReached(five)).toBe(true);
    expect(goalLimitReached(five, '3')).toBe(false);
    expect(goalLimitReached([...five.slice(0, 4), goal('5', { status: 'pausado' })])).toBe(false);
  });
  it('a sixth asks to pause one; an already active goal never asks; paused or archived never asks', () => {
    expect(goalNeedsPause(five, 'ativo')).toBe(true);
    expect(goalNeedsPause(five, 'pausado')).toBe(false);
    expect(goalNeedsPause(five, 'arquivado')).toBe(false);
    expect(goalNeedsPause(five, 'ativo', { id: '3', wasActive: true })).toBe(false);
    expect(goalNeedsPause([...five, goal('6', { status: 'pausado' })], 'ativo', { id: '6' })).toBe(true);
  });
  it('what a save writes: the chosen one is paused, or the new one stays paused; never refused', () => {
    expect(goalSave(five, 'ativo', { pauseId: '2' })).toEqual({ status: 'ativo', pause: '2' });
    expect(goalSave(five, 'ativo')).toEqual({ status: 'pausado' });
    expect(goalSave(five, 'ativo', { pauseId: 'nope' })).toEqual({ status: 'pausado' });
    expect(goalSave(five, 'concluido', { pauseId: '2' })).toEqual({ status: 'concluido' });
    expect(goalSave(five.slice(0, 3), 'ativo', { pauseId: '2' })).toEqual({ status: 'ativo' });
    const six = [...five, goal('6', { status: 'pausado' })];
    expect(goalSave(six, 'ativo', { id: '6', pauseId: '6' })).toEqual({ status: 'pausado' });
    expect(goalSave(six, 'ativo', { id: '6', pauseId: '1' })).toEqual({ status: 'ativo', pause: '1' });
  });
});

describe('Planejar → Objetivos groups', () => {
  it('active and paused goals with their active journeys, an old goal only while used, then "Sem objetivo"', () => {
    const goals = [goal('g1', { order: 0 }), goal('g2', { status: 'pausado', order: 1 }), goal('g3', { status: 'concluido', order: 2 }),
      goal('g4', { status: 'arquivado', order: 3 }), goal('g5', { order: 4, deleted: true })];
    const journeys = [
      journey('j1', { goalId: 'g1', order: 1 }), journey('j2', { goalId: 'g1', order: 0 }), journey('j3', { goalId: 'g3' }),
      journey('j4'), journey('j5', { goalId: 'g5' }), journey('j6', { goalId: 'g1', status: 'done' }),
      journey('j7', { goalId: 'g4', status: 'archived' }), journey('j8', { goalId: 'g1', deleted: true }),
    ];
    expect(goalGroups(goals, journeys).map((g) => [g.goal?.id ?? '-', g.journeys.map((j) => j.id)])).toEqual([
      ['g1', ['j2', 'j1']], ['g2', []], ['g3', ['j3']], ['-', ['j4', 'j5']],
    ]);
    expect(oldGoals(goals, journeys).map((g) => g.id)).toEqual(['g4']);
  });
  it('no "Sem objetivo" group when every active journey has a goal; no goals: only the loose journeys', () => {
    expect(goalGroups([goal('g1')], [journey('j1', { goalId: 'g1' })]).map((g) => g.goal?.id)).toEqual(['g1']);
    expect(goalGroups([], [journey('j1')])).toEqual([{ journeys: [journey('j1')] }]);
    expect(goalGroups([], [])).toEqual([]);
  });
});

describe('the purpose chain', () => {
  const goals = [goal('g', { title: ' Carreira em  Dados ' }), goal('gone', { deleted: true }), goal('old', { title: 'Antigo', status: 'arquivado' })];
  const journeys = [journey('tech', { title: 'Tech News', goalId: 'g' }), journey('free', { title: 'Solta' }),
    journey('lost', { goalId: 'gone' }), journey('arch', { title: 'Velha', goalId: 'old' }), journey('del', { goalId: 'g', deleted: true })];
  it('"objective › journey", and its spoken form', () => {
    expect(purposeChain('tech', journeys, goals)).toEqual({
      visible: 'Carreira em Dados › Tech News', spoken: 'Objetivo: Carreira em Dados, jornada: Tech News',
    });
    expect(purposeChain('arch', journeys, goals)?.visible).toBe('Antigo › Velha');
  });
  it('nothing without a journey, a goal, or with a deleted one', () => {
    expect(purposeChain(undefined, journeys, goals)).toBeUndefined();
    expect(purposeChain('free', journeys, goals)).toBeUndefined();
    expect(purposeChain('lost', journeys, goals)).toBeUndefined();
    expect(purposeChain('del', journeys, goals)).toBeUndefined();
    expect(purposeChain('nope', journeys, goals)).toBeUndefined();
  });
});

describe('what was linked to each goal', () => {
  const at = (day: string, t = '10:00') => timestampAt(day, t);
  const input = {
    goals: [goal('g1'), goal('g2'), goal('g3', { deleted: true })],
    journeys: [journey('tech', { goalId: 'g1' }), journey('calc', { goalId: 'g2', subject: true }), journey('old', { goalId: 'g3' })],
    missions: [
      mission({ id: 'm1', title: 'a', journeyId: 'tech', status: 'done', completedAt: at('2026-11-10') }),
      mission({ id: 'm2', title: 'b', journeyId: 'tech', status: 'done', completedAt: at('2026-11-17', '02:00') }), // logical 16/11
      mission({ id: 'm3', title: 'c', journeyId: 'tech', status: 'done', completedAt: at('2026-11-17', '09:00') }), // after the range
      mission({ id: 'm4', title: 'd', journeyId: 'tech', status: 'open' }),
      mission({ id: 'm5', title: 'e', journeyId: 'old', status: 'done', completedAt: at('2026-11-10') }),
      mission({ id: 'm6', title: 'f', status: 'done', completedAt: at('2026-11-10') }),
    ],
    blocks: [block({ id: 'b-tech', journeyId: 'tech' }), block({ id: 'b-facul' })],
    sessions: [
      session('b-tech', '2026-11-10'),
      { ...session('b-tech', '2026-11-11'), skipped: true },
      session('b-facul', '2026-11-12'),
      session('b-facul', '2026-11-13'),
      { ...session('b-tech', '2026-11-08') },
    ],
    dayStates: [{ ...base, id: '2026-11-12', hardDay: false, reviewDone: false, subjectPicks: { 'b-facul': 'calc' } }],
    from: '2026-11-09', to: '2026-11-16', dayStartHour: 4,
  };
  it('missions concluded and blocks started, through the journey (and the subject chosen with "Usar")', () => {
    const counts = goalCounts(input);
    expect(counts.get('g1')).toEqual({ missions: 2, blocks: 1 });
    expect(counts.get('g2')).toEqual({ missions: 0, blocks: 1 });
    expect(counts.has('g3')).toBe(false);
  });
  it('the texts never say zero', () => {
    expect(goalCountText({ missions: 2, blocks: 1 })).toBe('2 missões concluídas · 1 bloco iniciado');
    expect(goalCountText({ missions: 1, blocks: 0 })).toBe('1 missão concluída');
    expect(goalCountText({ missions: 0, blocks: 3 })).toBe('3 blocos iniciados');
    expect(goalCountText({ missions: 0, blocks: 0 })).toBeUndefined();
    expect(goalCountText(undefined)).toBeUndefined();
    expect(goalWeekLine({ missions: 0, blocks: 2 })).toBe('Ligado a ele na semana passada: 2 blocos iniciados.');
    expect(goalWeekLine(undefined)).toBe('Sem registro ligado a ele na semana passada.');
  });
});

describe('"Avançou?"', () => {
  const week = (id: string, answeredAt: number, goals: Record<string, string>, p: Partial<Week> = {}): Week => ({
    ...base, id, objectives: [], review: { worked: '', obstacle: '', adjustment: '', answeredAt, goals: goals as never }, ...p,
  });
  const weeks = [
    week('2026-11-16', timestampAt('2026-11-16', '09:00'), { g: 'um-pouco' }),
    week('2026-11-09', timestampAt('2026-11-09', '09:00'), { g: 'sim', h: 'nao' }),
    week('2026-11-02', timestampAt('2026-11-03', '09:00'), { g: 'sim' }),
    week('2026-10-26', timestampAt('2026-10-26', '09:00'), { g: 'talvez' }),
    week('2026-10-19', timestampAt('2026-10-19', '09:00'), { g: 'sim' }, { deleted: true }),
  ];
  it('the answers of the reviews answered in the range, about the week before each review', () => {
    expect(goalAnswers(weeks, 'g', { from: '2026-11-03', to: '2026-11-16' }, 4)).toEqual([
      { week: '2026-10-26', day: '2026-11-03', progress: 'sim' },
      { week: '2026-11-02', day: '2026-11-09', progress: 'sim' },
      { week: '2026-11-09', day: '2026-11-16', progress: 'um-pouco' },
    ]);
    expect(goalAnswers(weeks, 'g', { from: '2026-10-01', to: '2026-10-31' }, 4)).toEqual([]);
    expect(goalAnswers(weeks, 'h', { from: '2026-11-01', to: '2026-11-30' }, 4).map((a) => a.progress)).toEqual(['nao']);
  });
  it('the tally, in the chips order', () => {
    expect(goalTally(goalAnswers(weeks, 'g', { from: '2026-11-01', to: '2026-11-30' }, 4))).toBe('Sim 2 · Um pouco 1');
    expect(goalTally([])).toBeUndefined();
  });
});

describe('the sheet', () => {
  it('a new draft is active; the stored form trims and drops blank texts', () => {
    expect(newGoalDraft()).toEqual({ title: '', why: '', horizon: '', status: 'ativo' });
    expect(goalIssue(newGoalDraft())).toBe('title');
    expect(goalIssue({ ...newGoalDraft(), title: '  x ' })).toBeUndefined();
    expect(goalFields({ title: ' Primeira  vaga ', why: ' ', horizon: ' 2027 ', status: 'ativo' }))
      .toEqual({ title: 'Primeira vaga', horizon: '2027', status: 'ativo' });
    expect(goalFields({ ...newGoalDraft(), title: 'x'.repeat(100) }).title).toHaveLength(80);
  });
  it('only what changed is written; a removed text is written as undefined', () => {
    const g = goal('g', { title: 'Carreira', why: 'Gosto de dados', horizon: '2027' });
    const initial = goalDraftOf(g);
    expect(initial).toEqual({ title: 'Carreira', why: 'Gosto de dados', horizon: '2027', status: 'ativo' });
    expect(goalChanges(initial, initial)).toEqual({});
    expect(goalChanges(initial, { ...initial, title: 'Carreira ' })).toEqual({});
    expect(goalChanges(initial, { ...initial, why: '', status: 'pausado' })).toEqual({ why: undefined, status: 'pausado' });
    expect(goalChanges(initial, { ...initial, horizon: 'julho de 2027' })).toEqual({ horizon: 'julho de 2027' });
  });
});
