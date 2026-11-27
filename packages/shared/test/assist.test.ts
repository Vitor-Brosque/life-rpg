import { describe, expect, it } from 'vitest';
import type { Area, Block, Commitment, Goal, Journey, Mission, SubjectTopic, TrainingPlan } from '../src/types';
import {
  ASSIST_CONTEXT_TABLES, ASSIST_LIMITS, ASSIST_RULES, PROPOSAL_GROUP_TITLE, buildAssistContext, proposalItems, proposalNamesOf,
  validateProposal, weekdaysText, type Proposal,
} from '../src/assist';
import { PROPOSAL_SCHEMA } from '../src/assistSchema';
import { AI_LIMITS } from '../src/ai';
import { base } from './patternFixture';

const TODAY = '2026-11-25';
const names = { areas: ['Estudo', 'Trabalho', 'Corpo'], journeys: ['Tech News', 'Cálculo I'], goals: ['Conseguir um estágio'], subjects: ['Cálculo I'] };

const valid = {
  title: 'Rotina para o semestre',
  summary: 'Manhãs para o projeto, tardes para a faculdade.',
  areas: [{ name: 'Idiomas', attribute: 'Sabedoria', why: 'Você quer inglês para vagas.' }],
  renameAreas: [{ from: 'trabalho', to: 'Estágio' }],
  goals: [{ title: 'Inglês B2', horizon: 'julho de 2027' }],
  season: { title: 'Fim de semestre', weeks: 6, focus: ['Provas', 'Portfólio'] },
  journeys: [{ title: 'Curso de inglês', area: 'Idiomas', goal: 'Inglês B2', missions: [{ title: 'Escolher o curso', durationMin: 30 }] }],
  missions: [{ title: 'Revisar a lista de SQL', area: 'estudo', durationMin: 60, energy: 'heavy', important: true, date: '2026-11-27', firstStep: 'Abrir a lista' }],
  routine: { mode: 'replace', blocks: [
    { name: 'Projeto', weekdays: [5, 1, 2, 3, 4], start: '08:00', durationMin: 120, minimumMin: 30, kind: 'focus', journey: 'Tech News', protected: true },
    { name: 'Inglês', weekdays: [2, 4], start: '18:00', durationMin: 45, minimumMin: 15, kind: 'study', journey: 'Curso de inglês' },
  ] },
  commitments: [{ title: 'Aula', weekdays: [1, 2, 3, 4, 5], start: '19:30', end: '22:30' }],
  training: { days: [{ weekday: 1, name: 'Peito', exercises: [{ name: 'Supino', sets: 3, repsMin: 6, repsMax: 8, restMinSec: 120, restMaxSec: 180 }] }],
    block: { startDay: '2026-11-30', weeks: [{ rirMin: 3, rirMax: 3, cardioMin: 20 }] } },
  subjects: [{ title: 'Banco de Dados', weekday: 3, start: '19:30', end: '22:30' }],
  preferences: { dayStartHour: 5, dayEndHour: 0 },
};

describe('validateProposal', () => {
  it('accepts a full proposal and keeps it as sent (trimmed, references by name, any case or accent)', () => {
    const r = validateProposal(valid, names, TODAY);
    expect(r.issues).toEqual([]);
    expect(r.payload!.routine!.blocks[0]!.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(r.payload!.missions![0]).toEqual({ title: 'Revisar a lista de SQL', area: 'estudo', durationMin: 60, energy: 'heavy', important: true, date: '2026-11-27', firstStep: 'Abrir a lista' });
    expect(r.payload!.training!.days[0]!.exercises[0]).toEqual({ name: 'Supino', sets: 3, repsMin: 6, repsMax: 8, restMinSec: 120, restMaxSec: 180 });
  });

  it('lists every problem with its path, and stores nothing', () => {
    const r = validateProposal({
      title: '', summary: 'x',
      missions: [{ title: 'a', area: 'Música', durationMin: 45, date: '2027-12-01' }],
      routine: { mode: 'merge', blocks: [{ name: 'b', weekdays: [8], start: '25:00', durationMin: 30, minimumMin: 40, kind: 'deep' }] },
      commitments: [{ title: 'c', weekdays: [1], start: '22:00', end: '21:00' }],
      renameAreas: [{ from: 'Casa', to: 'Lar' }],
      journeys: [{ title: 'j', goal: 'Ficar rico', missions: [] }],
      training: { days: [{ weekday: 1, name: 'A', exercises: [{ name: 'x', repsMin: 10, repsMax: 8 }] }] },
      preferences: { dayStartHour: 9, dayEndHour: 19 },
    }, names, TODAY);
    expect(r.payload).toBeUndefined();
    expect(r.issues.map((i) => i.path)).toEqual(expect.arrayContaining([
      'title', 'missions.0.area', 'missions.0.durationMin', 'missions.0.date', 'routine.mode', 'routine.blocks.0.weekdays',
      'routine.blocks.0.start', 'routine.blocks.0.minimumMin', 'routine.blocks.0.kind', 'commitments.0', 'renameAreas.0.from',
      'journeys.0.goal', 'training.days.0.exercises.0', 'preferences.dayStartHour', 'preferences.dayEndHour',
    ]));
  });

  it('refuses an empty proposal, too many items and non-objects', () => {
    expect(validateProposal({ title: 't', summary: 's' }, names, TODAY).issues[0]!.message).toBe('A proposta não tem nenhum item.');
    const many = { title: 't', summary: 's', missions: Array.from({ length: 30 }, (_, i) => ({ title: `m${i}` })),
      journeys: Array.from({ length: 6 }, (_, i) => ({ title: `j${i}`, missions: Array.from({ length: 15 }, (_, k) => ({ title: `x${k}` })) })) };
    expect(validateProposal(many, names, TODAY).issues[0]!.message).toMatch(/No máximo 80 itens/);
    expect(validateProposal([], names, TODAY).issues[0]!.message).toBe('A proposta precisa ser um objeto.');
    expect(validateProposal({ ...valid, missions: Array(ASSIST_LIMITS.missions + 1).fill({ title: 'm' }) }, names, TODAY).issues[0]!.path).toBe('missions');
  });
});

describe('validateProposal: study (what a subject chat taught)', () => {
  const pkg = {
    subject: 'cálculo i',
    topics: [{ name: '  Limites ', seen: true }, { name: 'Derivadas', why: 'Vem na próxima aula.' }],
    cards: [
      { type: 'basic', front: 'O que é um limite?', back: 'O valor de que f(x) se aproxima.' },
      { type: 'topic', front: 'Regras de derivação', back: 'Soma\nProduto\nCadeia' },
    ],
    assessments: [{ kind: 'prova', date: '2026-12-10', content: 'Limites e derivadas' }, { kind: 'trabalho', date: '2027-06-13' }],
    missions: [{ title: 'Fazer a lista 3', durationMin: 60, firstStep: 'Abrir a lista' }],
  };
  const study = (s: unknown, extra: Record<string, unknown> = {}) => validateProposal({ title: 't', summary: 's', study: s, ...extra }, names, TODAY);

  it('accepts a package for an existing subject (any case or accent) and keeps it as sent, trimmed', () => {
    const r = study([pkg]);
    expect(r.issues).toEqual([]);
    expect(r.payload!.study).toEqual([{
      subject: 'cálculo i',
      topics: [{ name: 'Limites', seen: true }, { name: 'Derivadas', why: 'Vem na próxima aula.' }],
      cards: pkg.cards,
      assessments: [{ kind: 'prova', date: '2026-12-10', content: 'Limites e derivadas' }, { kind: 'trabalho', date: '2027-06-13' }],
      missions: [{ title: 'Fazer a lista 3', durationMin: 60, firstStep: 'Abrir a lista' }],
    }]);
  });

  it('a subject must exist or be created in subjects of the same proposal (a plain journey is not a subject)', () => {
    const unknown = study([{ subject: 'Banco de Dados', topics: [{ name: 'Normalização' }] }]);
    expect(unknown.payload).toBeUndefined();
    expect(unknown.issues).toEqual([{ path: 'study.0.subject', message: expect.stringContaining('"Banco de Dados"') }]);
    expect(unknown.issues[0]!.message).toMatch(/subjects/);
    expect(study([{ subject: 'Tech News', topics: [{ name: 'x' }] }]).issues[0]!.path).toBe('study.0.subject');
    const created = study([{ subject: 'banco de dados', topics: [{ name: 'Normalização' }] }], { subjects: [{ title: 'Banco de Dados' }] });
    expect(created.issues).toEqual([]);
    expect(created.payload!.study![0]!.subject).toBe('banco de dados');
  });

  it('refuses an empty package and a package without a subject', () => {
    expect(study([{ subject: 'Cálculo I' }]).issues).toEqual([{ path: 'study.0', message: expect.any(String) }]);
    expect(study([{ subject: 'Cálculo I', topics: [], cards: [] }]).issues[0]!.path).toBe('study.0');
    expect(study([{ topics: [{ name: 'x' }] }]).issues[0]!.path).toBe('study.0.subject');
    expect(study({ subject: 'Cálculo I' }).issues[0]!.path).toBe('study');
  });

  it('limits: 5 packages, 20 topics, 20 cards, 10 assessments, 10 missions, 80 items per proposal', () => {
    const one = { subject: 'Cálculo I', topics: [{ name: 'x' }] };
    expect(study(Array(ASSIST_LIMITS.study + 1).fill(one)).issues[0]!.path).toBe('study');
    expect(study([{ subject: 'Cálculo I', topics: Array.from({ length: 21 }, (_, i) => ({ name: `t${i}` })) }]).issues[0]!.path).toBe('study.0.topics');
    expect(study([{ subject: 'Cálculo I', cards: Array(21).fill({ type: 'basic', front: 'f', back: 'b' }) }]).issues[0]!.path).toBe('study.0.cards');
    expect(study([{ subject: 'Cálculo I', assessments: Array(11).fill({ kind: 'prova', date: '2026-12-01' }) }]).issues[0]!.path).toBe('study.0.assessments');
    expect(study([{ subject: 'Cálculo I', missions: Array(11).fill({ title: 'm' }) }]).issues[0]!.path).toBe('study.0.missions');
    const full = { subject: 'Cálculo I', topics: Array.from({ length: 20 }, (_, i) => ({ name: `t${i}` })), cards: Array(20).fill({ type: 'basic', front: 'f', back: 'b' }) };
    expect(study([full, full, { ...full, cards: [] }]).issues[0]!.message).toMatch(/No máximo 80 itens por proposta \(esta tem 100\)/);
    expect(study([{ subject: 'Cálculo I', topics: [{ name: 'x'.repeat(81) }] }]).issues[0]!.path).toBe('study.0.topics.0.name');
    expect(study([{ subject: 'Cálculo I', assessments: [{ kind: 'prova', date: '2026-12-01', content: 'x'.repeat(201) }] }]).issues[0]!.path).toBe('study.0.assessments.0.content');
  });

  it('assessment: prova or trabalho, from today up to 200 days', () => {
    const at = (date: unknown, kind: unknown = 'prova') => study([{ subject: 'Cálculo I', assessments: [{ kind, date }] }]).issues;
    expect(at(TODAY)).toEqual([]);
    expect(at('2027-06-13')).toEqual([]);
    expect(at('2027-06-14')[0]!.path).toBe('study.0.assessments.0.date');
    expect(at('2026-11-24')[0]!.message).toMatch(/200 dias/);
    expect(at('10/12/2026')[0]!.path).toBe('study.0.assessments.0.date');
    expect(at('2026-12-10', 'seminario')[0]!.path).toBe('study.0.assessments.0.kind');
  });

  it('cards: type basic or topic, front and back required, up to the card field limit', () => {
    const card = (c: Record<string, unknown>) => study([{ subject: 'Cálculo I', cards: [{ type: 'basic', front: 'f', back: 'b', ...c }] }]).issues.map((i) => i.path);
    expect(card({ type: 'cloze' })).toEqual(['study.0.cards.0.type']);
    expect(card({ front: '  ' })).toEqual(['study.0.cards.0.front']);
    expect(card({ back: undefined })).toEqual(['study.0.cards.0.back']);
    expect(card({ front: 'x'.repeat(AI_LIMITS.cardField + 1) })).toEqual(['study.0.cards.0.front']);
    expect(card({ back: 'x'.repeat(AI_LIMITS.cardField) })).toEqual([]);
  });

  it('topics: seen must be true or false; missions follow the loose-mission format', () => {
    expect(study([{ subject: 'Cálculo I', topics: [{ name: 'x', seen: 'sim' }] }]).issues[0]!.path).toBe('study.0.topics.0.seen');
    const r = study([{ subject: 'Cálculo I', topics: [{ name: 'x', seen: false }] }]);
    expect(r.payload!.study![0]!.topics).toEqual([{ name: 'x' }]);
    expect(study([{ subject: 'Cálculo I', missions: [{ title: 'm', durationMin: 45 }] }]).issues[0]!.path).toBe('study.0.missions.0.durationMin');
  });

  it('a topic card needs at least one key point (list markers do not count); the review shows them without markers', () => {
    const card = (back: string) => study([{ subject: 'Cálculo I', cards: [{ type: 'topic', front: 'Regras', back }] }]);
    expect(card('-').issues).toEqual([{ path: 'study.0.cards.0.back', message: expect.any(String) }]);
    expect(card('* \n1.').issues.map((i) => i.path)).toEqual(['study.0.cards.0.back']);
    const ok = card('- Soma\n- Produto');
    expect(ok.issues).toEqual([]);
    expect(proposalItems(ok.payload!).find((i) => i.key === 'study.0.cards.0')!.detail).toEqual(['Pontos-chave: Soma; Produto']);
    expect(study([{ subject: 'Cálculo I', cards: [{ type: 'basic', front: 'f', back: '-' }] }]).issues).toEqual([]);
  });

  it('study missions ignore a sent area; the schema has no area for them and needs at least one list', () => {
    const r = study([{ subject: 'Cálculo I', missions: [{ title: 'Lista', area: 'Inexistente' }] }]);
    expect(r.issues).toEqual([]);
    expect(r.payload!.study![0]!.missions).toEqual([{ title: 'Lista' }]);
    const item = PROPOSAL_SCHEMA.properties.study.items;
    expect(Object.keys(item.properties.missions.items.properties)).not.toContain('area');
    expect(item.minProperties).toBe(2);
    expect(item.description).toMatch(/pelo menos um de topics, cards, assessments, missions, notebook ou docs/);
    expect(Object.keys(PROPOSAL_SCHEMA.properties.missions.items.properties)).toContain('area');
  });

  it('the rules tell the assistant how to send study', () => {
    expect(ASSIST_RULES.study).toMatch(/study/);
    expect(ASSIST_RULES.study).toMatch(/seen/);
  });
});

describe('proposalItems', () => {
  it('one reviewable item per thing, in the order they are applied, with readable texts', () => {
    const items = proposalItems(validateProposal(valid, names, TODAY).payload!);
    expect(items.map((i) => i.key)).toEqual([
      'preferences', 'renameAreas.0', 'areas.0', 'goals.0', 'season', 'journeys.0', 'missions.0', 'routine.blocks.0',
      'routine.blocks.1', 'commitments.0', 'training', 'subjects.0',
    ]);
    const text = Object.fromEntries(items.map((i) => [i.key, i.text]));
    expect(text.preferences).toBe('O dia começa às 05:00 e o dia termina às 00:00.');
    expect(text['routine.blocks.0']).toBe('seg a sex · 08:00 · Projeto · 2h, mínimo 30 min · foco · Tech News · protegido');
    expect(text['commitments.0']).toBe('seg a sex · 19:30–22:30 · Aula');
    expect(text['missions.0']).toBe('Revisar a lista de SQL · 1h · área estudo · sex 27/11 · importante');
    expect(text.training).toBe('Plano de treino: seg Peito · bloco de 1 semana');
    expect(items.find((i) => i.key === 'journeys.0')!.detail).toEqual(['Escolher o curso · 30 min']);
    expect(items.find((i) => i.key === 'areas.0')!.why).toBe('Você quer inglês para vagas.');
  });
  it('study items come after the subjects, keyed by package, kind and index, with the subject in the text', () => {
    const payload = validateProposal({
      title: 't', summary: 's',
      subjects: [{ title: 'Banco de Dados' }],
      study: [{
        subject: 'Banco de Dados',
        topics: [{ name: 'Normalização', seen: true, why: 'Vimos hoje.' }, { name: 'Índices' }],
        cards: [{ type: 'basic', front: 'O que é a 3FN?', back: 'Sem dependência transitiva.' }, { type: 'topic', front: 'Formas normais', back: '1FN\n2FN\n3FN' }],
        assessments: [{ kind: 'prova', date: '2026-12-10', content: 'Normalização e SQL' }, { kind: 'trabalho', date: '2026-12-01' }],
        missions: [{ title: 'Fazer a lista 3', durationMin: 60, firstStep: 'Abrir o enunciado' }],
      }],
    }, names, TODAY).payload!;
    const items = proposalItems(payload);
    expect(items.map((i) => i.key)).toEqual([
      'subjects.0', 'study.0.topics.0', 'study.0.topics.1', 'study.0.cards.0', 'study.0.cards.1', 'study.0.assessments.0',
      'study.0.assessments.1', 'study.0.missions.0',
    ]);
    expect(items.filter((i) => i.key.startsWith('study.')).every((i) => i.group === 'study')).toBe(true);
    expect(PROPOSAL_GROUP_TITLE.study).toBe('Estudo');
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey['study.0.topics.0']).toMatchObject({ text: 'Assunto · Banco de Dados: Normalização (já visto)', why: 'Vimos hoje.' });
    expect(byKey['study.0.topics.1']!.text).toBe('Assunto · Banco de Dados: Índices');
    expect(byKey['study.0.cards.0']).toMatchObject({ text: 'Card · Banco de Dados: O que é a 3FN?', detail: ['Verso: Sem dependência transitiva.'] });
    expect(byKey['study.0.cards.1']).toMatchObject({ text: 'Card · Banco de Dados: Formas normais', detail: ['Pontos-chave: 1FN; 2FN; 3FN'] });
    expect(byKey['study.0.assessments.0']).toMatchObject({ text: 'Prova · Banco de Dados · qui 10/12', detail: ['Conteúdo: Normalização e SQL'] });
    expect(byKey['study.0.assessments.1']!.text).toBe('Trabalho · Banco de Dados · ter 01/12');
    expect(byKey['study.0.assessments.1']!.detail).toBeUndefined();
    expect(byKey['study.0.missions.0']).toMatchObject({ text: 'Missão · Banco de Dados: Fazer a lista 3 · 1h', detail: ['Primeiro passo: Abrir o enunciado'] });
  });
  it('weekdaysText', () => {
    expect(weekdaysText([1, 2, 3, 4, 5])).toBe('seg a sex');
    expect(weekdaysText([1, 3, 5])).toBe('seg, qua e sex');
    expect(weekdaysText([6, 0])).toBe('sáb e dom');
    expect(weekdaysText([0, 1, 2, 3, 4, 5, 6])).toBe('todos os dias');
  });
});

describe('buildAssistContext', () => {
  const area = (id: string, name: string, p: Partial<Area> = {}): Area => ({ ...base, id, name, attribute: 'X', color: '#fff', icon: 'star', order: 0, archived: false, ...p });
  const tables = {
    profile: [{ ...base, id: 'me', name: 'Lia', companionName: 'Brasa', onboarded: true, look: { skin: 0, hair: 0, hairColor: 0, outfit: 0 } }],
    settings: [{ ...base, id: 'settings', dayStartHour: 4, dayEndHour: 23, pomodoro: { focusMin: 25, breakMin: 5 }, companionMuted: false, commitmentReminderMin: 10 }],
    areas: [area('a1', 'Estudo'), area('a2', 'Velha', { archived: true }), area('a3', 'Apagada', { deleted: true })],
    blocks: [{ ...base, id: 'b1', name: 'Foco', weekdays: [1, 2, 3, 4, 5], order: 0, targetStart: '08:00', durationMin: 120, minimumMin: 30, kind: 'focus', protected: false, checklist: [], archived: false, areaId: 'a1' } as Block],
    commitments: [
      { ...base, id: 'c1', title: 'Aula', date: '2026-08-03', start: '19:30', end: '22:30', weekdays: [1, 2], remind: true },
      { ...base, id: 'c2', title: 'Dentista', date: '2026-11-26', start: '10:00', end: '11:00', remind: true },
    ] as Commitment[],
    journeys: [{ ...base, id: 'j1', title: 'Projeto', status: 'active', order: 0, areaId: 'a1', goalId: 'g1' } as Journey],
    goals: [{ ...base, id: 'g1', title: 'Estágio', status: 'ativo', order: 0 } as Goal],
    missions: [
      { ...base, id: 'm1', title: 'Escrever o README', status: 'open', checklist: [], important: false, shrunk: false, postponeCount: 0, journeyId: 'j1', durationMin: 30, notes: 'segredo' },
      { ...base, id: 'm2', title: 'Lista de SQL', status: 'done', checklist: [], important: false, shrunk: false, postponeCount: 0, areaId: 'a1', completedAt: new Date(2026, 10, 18, 15).getTime() },
      { ...base, id: 'm3', title: 'Pagar a conta', status: 'open', checklist: [], important: true, shrunk: false, postponeCount: 0, date: '2026-11-26' },
    ] as Mission[],
    trainingPlans: [{ ...base, id: 'plan', days: [{ weekday: 1, name: 'Peito', exercises: ['Supino'] }], block: { startDay: '2026-11-23', weeks: [{ rirMin: 2, rirMax: 2 }] } } as unknown as TrainingPlan],
    dayState: [{ ...base, id: '2026-11-18', hardDay: true, reviewDone: false, mode: 'low' }],
    reviews: [{ ...base, id: 'r1', cardId: 'c', noteId: 'n', at: 1, day: '2026-11-17', rating: 3, durationMs: 1, wrote: false }],
    proposals: [{ ...base, id: 'p1', createdAt: Date.UTC(2026, 10, 20), source: 'ChatGPT', status: 'partial', payload: { title: 'Primeira', summary: 's' },
      outcome: [{ key: 'missions.0', result: 'applied' }, { key: 'missions.1', result: 'skipped', reason: 'já passou a data' }] } as Proposal],
    diaryEntries: [{ id: 'd', text: 'texto do diário' }],
    sleepLogs: [{ id: 's', night: '2026-10-02', quality: 2 }],
  };
  const ctx = buildAssistContext(tables as never, TODAY);

  it('has the structure, without archived or deleted things, and the plan in the detailed format', () => {
    expect(ctx.profile).toEqual({ name: 'Lia', companion: 'Brasa' });
    expect(ctx.areas.map((a) => a.name)).toEqual(['Estudo', 'Velha']);
    expect(ctx.routine[0]).toMatchObject({ name: 'Foco', days: 'seg a sex', start: '08:00', area: 'Estudo' });
    expect(ctx.commitments).toEqual([{ title: 'Aula', weekdays: [1, 2], days: 'seg e ter', start: '19:30', end: '22:30' }]);
    expect(ctx.journeys[0]).toMatchObject({ title: 'Projeto', area: 'Estudo', goal: 'Estágio', missionsTotal: 1, openMissions: [{ title: 'Escrever o README', durationMin: 30 }] });
    expect(ctx.missions).toEqual([{ title: 'Pagar a conta', date: '2026-11-26', important: true }]);
    expect(ctx.training!.days[0]!.exercises).toEqual([{ name: 'Supino' }]);
    expect(ctx.training!.block!.thisWeek).toBe('Semana 1 de 1 · RIR ~2');
  });
  it('summarises the last 4 complete weeks in counts only', () => {
    expect(ctx.history).toHaveLength(4);
    const w = ctx.history.find((h) => h.week === '2026-11-16 a 2026-11-22')!;
    expect(w.missionsDoneByArea).toEqual({ Estudo: 1 });
    expect(w.daysByMode.low).toBe(1);
    expect(w.reviews).toBe(1);
  });
  it('reports what happened to past proposals', () => {
    expect(ctx.proposals[0]).toMatchObject({ title: 'Primeira', status: 'partial', applied: 1, skipped: 1, skippedReasons: ['missions.1: já passou a data'] });
  });
  it('never carries private tables or free texts like mission notes', () => {
    const json = JSON.stringify(ctx);
    expect(json).not.toContain('texto do diário');
    expect(json).not.toContain('2026-10-02');
    expect(json).not.toContain('segredo');
  });
  it('never reads nor carries anything of the nutrition (tables or settings)', () => {
    const nutritionTables = ['foods', 'nutritionTargets', 'foodLogs', 'pantry', 'weighIns'];
    for (const t of nutritionTables) expect(ASSIST_CONTEXT_TABLES as readonly string[]).not.toContain(t);
    const withNutrition = {
      ...tables,
      settings: [{ ...tables.settings[0]!, nutrition: { meals: ['almoco', 'jantar'], lastBuild: { day: '2026-11-25', hunger: 'muita', trainingBefore: 'almoco' } } }],
      foods: [{ ...base, id: 'f1', name: 'Tapioca secreta', per100: { kcal: 240, protein: 0, carbs: 60, fat: 0 }, basis: 'pronto', source: 'rotulo', group: 'carboidrato', like: 'gosto' }],
      nutritionTargets: [{ ...base, id: 'ntarget-2026-11-20', from: '2026-11-20', byWeekday: Array(7).fill({ protein: 777, carbs: 888, fat: 99 }) }],
      foodLogs: [{ ...base, id: 'fl1', day: '2026-11-25', meal: 'almoco', foodId: 'f1', name: 'Tapioca secreta', per100: {}, basis: 'pronto', estimate: false, grams: 432, status: 'comido', order: 0 }],
      pantry: [{ ...base, id: 'pantry-f1', foodId: 'f1', confirmedDay: '2026-11-25', grams: 654 }],
      weighIns: [{ ...base, id: 'w1', day: '2026-11-25', kg: 123.4 }],
    };
    const json = JSON.stringify(buildAssistContext(withNutrition as never, TODAY));
    for (const secret of ['Tapioca', '777', '888', '432', '654', '123.4', 'nutrition', 'lastBuild', 'muita', 'pantry', 'weigh', 'foods']) {
      expect(json).not.toContain(secret);
    }
  });
  it('proposalNamesOf: what a proposal can cite', () => {
    expect(proposalNamesOf(tables as never)).toEqual({ areas: ['Estudo'], journeys: ['Projeto'], goals: ['Estágio'], subjects: [] });
  });
});

describe('buildAssistContext: subjects with topics and open avaliações', () => {
  const mission = (p: Partial<Mission>): Mission => ({ ...base, id: 'm', title: 'x', status: 'open', checklist: [], important: false, shrunk: false, postponeCount: 0, ...p } as Mission);
  const topic = (id: string, journeyId: string, name: string, p: Partial<SubjectTopic> = {}): SubjectTopic => ({ ...base, id, journeyId, name, marks: [], ...p });
  const tables = {
    journeys: [
      { ...base, id: 'bd', title: 'Banco de Dados', status: 'active', order: 0, subject: true, chatUrl: 'https://chat.exemplo.test/c/segredo-do-chat' },
      { ...base, id: 'calc', title: 'Cálculo I', status: 'active', order: 1, subject: true },
      { ...base, id: 'old', title: 'Física I', status: 'archived', order: 2, subject: true },
      { ...base, id: 'proj', title: 'Projeto', status: 'active', order: 3 },
    ] as Journey[],
    subjectTopics: [
      topic('t1', 'bd', 'Normalização', { marks: [{ at: 1, level: 'entendi' }] }),
      topic('t2', 'bd', 'Índices'),
      topic('t3', 'bd', 'Apagado', { deleted: true }),
      ...Array.from({ length: 45 }, (_, i) => topic(`c${i}`, 'calc', `Assunto ${String(i).padStart(2, '0')}`)),
    ],
    missions: [
      mission({ id: 'a1', title: 'Prova de Banco de Dados', journeyId: 'bd', assessment: 'prova', date: '2026-12-10', deadline: '2026-12-10', notes: 'conteúdo secreto' }),
      mission({ id: 'a2', title: 'Trabalho de Banco de Dados', journeyId: 'bd', assessment: 'trabalho', date: '2026-12-20', deadline: '2026-12-01' }),
      mission({ id: 'a3', title: 'Prova velha', journeyId: 'bd', assessment: 'prova', date: '2026-11-10', deadline: '2026-11-10' }),
      mission({ id: 'a4', title: 'Prova feita', journeyId: 'bd', assessment: 'prova', date: '2026-12-02', deadline: '2026-12-02', status: 'done' }),
      mission({ id: 'a5', title: 'Prova hoje', journeyId: 'calc', assessment: 'prova', date: TODAY, deadline: TODAY }),
    ],
    decks: [{ ...base, id: 'd1', name: 'Baralho secreto', journeyId: 'bd', order: 0, archived: false }],
    notes: [{ ...base, id: 'n1', deckId: 'd1', type: 'basic', front: 'Frente secreta', back: 'Verso secreto', draft: false }],
    cards: [{ ...base, id: 'k1', noteId: 'n1', deckId: 'd1' }],
  };
  const ctx = buildAssistContext(tables as never, TODAY);

  it('each active subject carries its topic names (up to 40) and every open avaliação from today on (kind and day)', () => {
    expect(ASSIST_CONTEXT_TABLES as readonly string[]).toContain('subjectTopics');
    expect(ctx.subjects.map((s) => s.title)).toEqual(['Banco de Dados', 'Cálculo I']);
    const bd = ctx.subjects[0]!;
    expect(bd.topics).toEqual(['Índices', 'Normalização']);
    expect(bd.assessments).toEqual([{ kind: 'trabalho', date: '2026-12-01' }, { kind: 'prova', date: '2026-12-10' }]);
    const calc = ctx.subjects[1]!;
    expect(calc.topics).toHaveLength(ASSIST_LIMITS.topicsInContext);
    expect(calc.topics[0]).toBe('Assunto 00');
    expect(calc.assessments).toEqual([{ kind: 'prova', date: TODAY }]);
  });
  it('never carries the chat link, notes, cards, decks or avaliação contents', () => {
    for (const t of ['notes', 'cards', 'decks']) expect(ASSIST_CONTEXT_TABLES as readonly string[]).not.toContain(t);
    const json = JSON.stringify(ctx);
    for (const secret of ['chatUrl', 'chat.exemplo.test', 'segredo-do-chat', 'Baralho secreto', 'Frente secreta', 'Verso secreto', 'conteúdo secreto']) {
      expect(json).not.toContain(secret);
    }
  });
  it('proposalNamesOf lists the active subjects', () => {
    expect(proposalNamesOf(tables as never).subjects).toEqual(['Banco de Dados', 'Cálculo I']);
  });
});
