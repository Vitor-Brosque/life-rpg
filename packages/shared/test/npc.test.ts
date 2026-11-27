import { describe, expect, it } from 'vitest';
import type { Block, BlockSession, FocusSession, Mission, XpEvent } from '../src/types';
import {
  buildAreaFacts, formatMinutes, freezerFacts, npcLines, npcStartIndex, reasonDaysThisWeek, sleepFacts, workoutFacts,
  type AreaFacts, type NpcCtx, type WorldFacts,
} from '../src/npc';

const TODAY = '2026-11-13';       // Friday
const WEEK = '2026-11-09';        // Monday
const WEEK_TS = new Date(2026, 10, 9, 4).getTime();
const base = { createdAt: 1, updatedAt: 1, deleted: false };

let seq = 0;
const xp = (amount: number, f: Partial<XpEvent> = {}): XpEvent =>
  ({ id: `x${++seq}`, at: WEEK_TS + seq, amount, reason: 'complete', dayKey: TODAY, ...base, ...f });
const mission = (f: Partial<Mission>): Mission => ({
  id: `m${++seq}`, title: 'Missão', checklist: [], status: 'open', important: false, shrunk: false, postponeCount: 0, ...base, ...f,
});

describe('buildAreaFacts', () => {
  it('aggregates XP, missions, focus and block sessions of this week by area', () => {
    const m1 = mission({ id: 'm1', title: 'Ligar para a vó', areaId: 'area-lacos', deadline: '2026-11-15' });
    const facts = buildAreaFacts({
      today: TODAY, weekStart: WEEK, weekStartTs: WEEK_TS, areaIds: ['area-lacos', 'area-oficio'],
      xp: [
        xp(12, { areaId: 'area-lacos', dayKey: '2026-11-10', at: WEEK_TS + 10, missionId: 'm1', reason: 'start' }),
        xp(8, { areaId: 'area-lacos', dayKey: '2026-11-10', at: WEEK_TS + 5 }),
        xp(5, { areaId: 'area-lacos', dayKey: '2026-11-08', at: WEEK_TS - 9 }),   // last week: not in weekXp
        xp(30, { areaId: 'area-lacos', dayKey: TODAY, at: WEEK_TS + 50, deleted: true }),
        xp(5, { areaId: 'area-oficio', dayKey: TODAY, at: WEEK_TS + 999_999, reason: 'block' }),
      ],
      missions: [
        m1,
        mission({ areaId: 'area-lacos', date: '2026-11-20' }),          // planned later: not open today
        mission({ journeyId: 'j-of', status: 'doing', deadline: '2026-11-13', title: 'B' }),
        mission({ journeyId: 'j-of', deadline: '2026-11-13', title: 'A' }),
        mission({ areaId: 'area-lacos', status: 'done', completedAt: WEEK_TS + 5 }),
        mission({ areaId: 'area-lacos', status: 'done', completedAt: WEEK_TS - 5 }),
      ],
      journeys: [{ id: 'j-of', areaId: 'area-oficio' }],
      focus: [
        { id: 'f1', startedAt: WEEK_TS + 1, endedAt: 0, activeMs: 50 * 60_000, mode: 'free', areaId: 'area-oficio', outcome: 'finished', ...base },
        { id: 'f2', startedAt: WEEK_TS + 2, endedAt: 0, activeMs: 25.5 * 60_000, mode: 'free', areaId: 'area-oficio', outcome: 'finished', ...base },
        { id: 'f3', startedAt: WEEK_TS - 2, endedAt: 0, activeMs: 99 * 60_000, mode: 'free', areaId: 'area-oficio', outcome: 'finished', ...base },
      ] satisfies FocusSession[],
      blocks: [{ id: 'b1', name: 'Bloco 1', weekdays: [1], order: 0, targetStart: '09:00', durationMin: 120, minimumMin: 30, journeyId: 'j-of', kind: 'focus', protected: false, checklist: [], archived: false, ...base }] satisfies Block[],
      sessions: [
        { id: 's1', blockId: 'b1', day: '2026-11-10', startedAt: 1, version: 'normal', ...base },
        { id: 's2', blockId: 'b1', day: '2026-11-11', version: 'normal', skipped: true, endedAt: 2, ...base },
        { id: 's3', blockId: 'b1', day: '2026-11-06', startedAt: 1, version: 'normal', ...base },
      ] satisfies BlockSession[],
      reasonLabel: (r) => ({ start: 'Coragem para começar', block: 'Bloco iniciado' } as Record<string, string>)[r] ?? r,
    });
    expect(facts['area-lacos']).toEqual({
      weekXp: 20, weekDays: 1, openMissions: 1, doneThisWeek: 1, focusMin: 0, blocksStarted: 0,
      nextDeadline: { title: 'Ligar para a vó', day: '2026-11-15' },
      last: { label: 'Coragem para começar', missionTitle: 'Ligar para a vó', day: '2026-11-10' },
    } satisfies AreaFacts);
    expect(facts['area-oficio']).toEqual({
      weekXp: 5, weekDays: 1, openMissions: 2, doneThisWeek: 0, focusMin: 75, blocksStarted: 1,
      nextDeadline: { title: 'A', day: '2026-11-13' },
      last: { label: 'Bloco iniciado', day: TODAY },
    } satisfies AreaFacts);
  });
});

describe('week helpers and Marco 4 rows', () => {
  it('reasonDaysThisWeek counts distinct days per reason', () => {
    expect(reasonDaysThisWeek([
      xp(10, { reason: 'study', dayKey: '2026-11-10' }), xp(3, { reason: 'study', dayKey: '2026-11-10' }),
      xp(3, { reason: 'study', dayKey: '2026-11-12' }), xp(3, { reason: 'study', dayKey: '2026-11-02' }),
      xp(3, { reason: 'review', dayKey: TODAY, deleted: true }),
    ], WEEK, TODAY)).toEqual({ study: 2 });
  });
  it('workoutFacts, freezerFacts and sleepFacts read only the fields they need and skip junk', () => {
    expect(workoutFacts([
      { day: '2026-11-10', kind: 'musculacao', deleted: false }, { day: '2026-11-11', kind: 'cardio', deleted: false },
      { day: '2026-11-11', kind: 'cardio', deleted: true }, { day: '2026-11-01', kind: 'cardio', deleted: false }, null, 'x',
    ], WEEK, TODAY)).toEqual({ total: 2, cardio: 1 });
    expect(freezerFacts([
      { delta: 6, kind: 'prep', deleted: false }, { delta: -1, kind: 'eat', deleted: false }, { delta: -1, kind: 'eat', deleted: true },
      { delta: 'x', kind: 'fix' },
    ])).toEqual({ portions: 5, everPrepped: true });
    expect(freezerFacts([{ delta: -2, kind: 'eat', deleted: false }])).toEqual({ portions: 0, everPrepped: false });
    // per dish, like the Casa tab: a negative dish does not eat into another one
    expect(freezerFacts([{ recipeId: 'a', delta: 4, kind: 'prep' }, { recipeId: 'b', delta: -2, kind: 'eat' }]))
      .toEqual({ portions: 4, everPrepped: true });
    const h = 3_600_000;
    expect(sleepFacts([
      { night: '2026-11-12', bedAt: 0, wakeAt: 7 * h, deleted: false },
      { night: '2026-11-11', bedAt: 0, deleted: false },
      { night: '2026-11-10', bedAt: 0, wakeAt: 17 * h, deleted: false },
      { night: '2026-11-06', bedAt: 0, wakeAt: 8 * h, deleted: false },
      { night: '2026-11-05', bedAt: 0, wakeAt: 8 * h, deleted: false },
      { night: TODAY, bedAt: 0, wakeAt: 8 * h, deleted: false },
    ], TODAY)).toBe(2);
  });
  it('formatMinutes', () => {
    expect([20, 60, 90, 65, 0].map(formatMinutes)).toEqual(['20 min', '1h', '1h30', '1h05', '0 min']);
  });
});

const facts = (f: Partial<AreaFacts> = {}): AreaFacts =>
  ({ weekXp: 0, weekDays: 0, openMissions: 0, doneThisWeek: 0, focusMin: 0, blocksStarted: 0, ...f });
const world = (w: Partial<WorldFacts> = {}): WorldFacts =>
  ({ today: TODAY, mode: 'normal', reasonDays: {}, sketchesThisWeek: 0, checkinsThisWeek: 0, ...w });
const ctx = (c: Partial<NpcCtx>): NpcCtx => ({
  kind: 'andarilha', area: { name: 'Corpo', attribute: 'Vigor' }, stage: 1, next: { stage: 2, level: 5, xpLeft: 40 },
  facts: facts(), world: world(), ...c,
});
const ids = (c: NpcCtx) => npcLines(c).map((l) => l.id);
const text = (c: NpcCtx, id: string) => npcLines(c).find((l) => l.id === id)?.text;

describe('npcLines', () => {
  it('there is always a stage line, last', () => {
    expect(ids(ctx({}))).toEqual(['stage']);
    expect(text(ctx({}), 'stage')).toBe('Mais 40 XP e isto aqui vira uma aldeia.');
    expect(text(ctx({ stage: 0 }), 'stage')).toBe('Por enquanto, ruínas. Qualquer ação de Vigor levanta a primeira tenda.');
    expect(text(ctx({ stage: 4, next: undefined }), 'stage')).toBe('Um castelo de pé. Ele fica, mesmo nos dias parados.');
  });

  it('treinadora: workouts of the week, the minimum cardio, a calm start, rest on free days', () => {
    const c = ctx({ kind: 'treinadora', world: world({ workouts: { total: 3, cardio: 0 } }) });
    expect(ids(c)).toEqual(['t-week', 't-cardio', 'stage']);
    expect(text(c, 't-week')).toBe('3 treinos registrados nesta semana. Cada registro reforça este campo.');
    expect(text(ctx({ kind: 'treinadora', world: world({ workouts: { total: 1, cardio: 1 } }) }), 't-week'))
      .toBe('1 treino registrado nesta semana, 1 de cardio. Cada registro reforça este campo.');
    expect(ids(ctx({ kind: 'treinadora', world: world({ workouts: { total: 0, cardio: 0 } }) }))).toEqual(['t-start', 'stage']);
    expect(ids(ctx({ kind: 'treinadora', world: world({ mode: 'free', workouts: { total: 0, cardio: 0 } }) }))).toEqual(['t-free', 'stage']);
    expect(ids(ctx({ kind: 'treinadora' }))).toEqual(['stage']);   // no Marco 4 table: nothing invented
  });

  it('escriba: reviews due today (time-sensitive), done, rest day, lousas, practice and the first card', () => {
    const due = ctx({ kind: 'escriba', world: world({ study: { due: 14, fresh: 6, minutes: 6.6, goalMet: false, restDay: false, cards: 80 } }) });
    expect(npcLines(due)[0]).toEqual({
      id: 'e-due', now: true,
      text: 'Hoje há 14 revisões e 6 cards novos esperando, uns 7 min. Lembrar com esforço é o que fixa.',
    });
    const one = ctx({ kind: 'escriba', world: world({ study: { due: 1, fresh: 0, minutes: 0.4, goalMet: false, restDay: false, cards: 80 } }) });
    expect(text(one, 'e-due')).toBe('Hoje há 1 revisão esperando, cerca de 1 min. Lembrar com esforço é o que fixa.');
    expect(ids(ctx({ kind: 'escriba', world: world({ study: { due: 0, fresh: 0, minutes: 0, goalMet: true, restDay: false, cards: 80 } }) })))
      .toEqual(['e-done', 'stage']);
    expect(ids(ctx({ kind: 'escriba', world: world({ study: { due: 9, fresh: 0, minutes: 2, goalMet: false, restDay: true, cards: 80 } }) })))
      .toEqual(['e-rest', 'stage']);
    const freeDay = ctx({ kind: 'escriba', world: world({ mode: 'free', study: { due: 9, fresh: 0, minutes: 2, goalMet: false, restDay: true, cards: 80 } }) });
    expect(npcLines(freeDay)[0]).toMatchObject({ id: 'e-free', now: true });
    expect(ids(freeDay)).not.toContain('e-rest');
    const more = ctx({ kind: 'escriba', world: world({ sketchesThisWeek: 2, reasonDays: { practice: 1 }, study: { due: 0, fresh: 0, minutes: 0, goalMet: false, restDay: false, cards: 0 } }) });
    expect(ids(more)).toEqual(['e-sketch', 'e-practice', 'e-first', 'stage']);
    expect(text(more, 'e-sketch')).toBe('2 lousas mexidas nesta semana. Pensar desenhando também é estudar.');
    expect(text(more, 'e-practice')).toBe('Você praticou em 1 dia nesta semana. Reconstruir sem consulta é onde a autonomia aparece.');
  });

  it('intendente: marmitas low (time-sensitive), empty, plenty, never prepped; batch prep this week', () => {
    const low = ctx({ kind: 'intendente', world: world({ freezer: { portions: 1, everPrepped: true } }) });
    expect(npcLines(low)[0]).toEqual({
      id: 'i-low', now: true,
      text: 'Resta 1 marmita no freezer. Se fizer sentido, o preparo em lote pode entrar na semana.',
    });
    expect(text(ctx({ kind: 'intendente', world: world({ freezer: { portions: 2, everPrepped: true } }) }), 'i-low'))
      .toBe('Restam 2 marmitas no freezer. Se fizer sentido, o preparo em lote pode entrar na semana.');
    expect(ids(ctx({ kind: 'intendente', world: world({ freezer: { portions: 0, everPrepped: true } }) }))).toEqual(['i-empty', 'stage']);
    expect(text(ctx({ kind: 'intendente', world: world({ freezer: { portions: 8, everPrepped: true }, reasonDays: { mealprep: 1 } }) }), 'i-stock'))
      .toBe('8 marmitas no freezer. Comida pronta é uma decisão a menos.');
    expect(ids(ctx({ kind: 'intendente', world: world({ freezer: { portions: 0, everPrepped: false }, reasonDays: { mealprep: 1 } }) })))
      .toEqual(['i-first', 'i-prep', 'stage']);
  });

  it('intendente on a free day: rest first, the low freezer is no longer time-sensitive', () => {
    const c = ctx({ kind: 'intendente', world: world({ mode: 'free', freezer: { portions: 1, everPrepped: true } }) });
    const lines = npcLines(c);
    expect(lines[0]).toMatchObject({ id: 'i-free', now: true });
    expect(lines.find((l) => l.id === 'i-low')).toMatchObject({ now: false });
  });

  it('bardo is gentle about people missions and has no "open" nudge', () => {
    const c = ctx({ kind: 'bardo', facts: facts({ openMissions: 2 }) });
    expect(ids(c)).toEqual(['b-open', 'stage']);
    expect(text(c, 'b-open')).toBe('2 missões com pessoas estão guardadas. Laços não têm pressa: quando fizer sentido, uma mensagem curta já aproxima.');
    expect(ids(ctx({ kind: 'bardo' }))).toEqual(['b-quiet', 'stage']);
    expect(text(ctx({ kind: 'bardo', facts: facts({ doneThisWeek: 1 }) }), 'b-done')).toBe('Você cuidou de 1 laço nesta semana. Isso já dá uma canção.');
  });

  it('herbalista, ferreira and mestra lines', () => {
    expect(ids(ctx({ kind: 'herbalista', world: world({ mode: 'low', sleepNights: 0, checkinsThisWeek: 2 }) })))
      .toEqual(['h-light', 'h-sleep-start', 'h-checkin', 'stage']);
    expect(text(ctx({ kind: 'herbalista', world: world({ sleepNights: 4 }) }), 'h-sleep'))
      .toBe('4 noites registradas nos últimos 7 dias. Olhar os horários com calma ajuda a ajustar a rotina.');
    expect(text(ctx({ kind: 'ferreira', facts: facts({ focusMin: 95 }) }), 'f-focus')).toBe('1h35 de foco na forja nesta semana.');
    expect(text(ctx({ kind: 'mestra', area: { name: 'Faculdade', attribute: 'Sabedoria' }, facts: facts({ blocksStarted: 2 }) }), 'm-blocks'))
      .toBe('2 blocos começados em Faculdade nesta semana. Esse tempo protegido foi escolha sua.');
  });

  it('shared lines: deadline, journey, open missions, week and the last action', () => {
    const c = ctx({
      journey: { id: 'j', title: 'Tech News', order: 0, done: 3, total: 7, nextTitle: 'Escrever o teste de deduplicação' },
      facts: facts({
        openMissions: 2, weekXp: 45, weekDays: 3, nextDeadline: { title: 'Lista 4', day: '2026-11-14' },
        last: { label: 'Missão concluída', missionTitle: 'Treino A', day: '2026-11-12' },
      }),
    });
    expect(npcLines(c)).toEqual([
      { id: 'deadline', now: true, text: 'Próxima entrega: “Lista 4”, amanhã.' },
      { id: 'journey', now: false, text: 'A jornada “Tech News” está em 3 de 7. Próximo passo: Escrever o teste de deduplicação.' },
      { id: 'open', now: false, text: '2 missões de Corpo em aberto. Escolha a menor, se quiser começar.' },
      { id: 'week', now: false, text: 'Nesta semana, Vigor ganhou 45 XP em 3 dias.' },
      { id: 'last', now: false, text: 'Última marca aqui: Missão concluída (“Treino A”), ontem.' },
      { id: 'stage', now: false, text: 'Mais 40 XP e isto aqui vira uma aldeia.' },
    ]);
    expect(text(ctx({ journey: { id: 'j', title: 'X', order: 0, done: 0, total: 0 } }), 'journey'))
      .toBe('A jornada “X” ainda não tem missões. Um primeiro passo pequeno já abre a estrada.');
    expect(text(ctx({ journey: { id: 'j', title: 'X', order: 0, done: 2, total: 2 } }), 'journey'))
      .toBe('Todas as missões de “X” feitas. Quando quiser, é só concluir a jornada.');
    expect(text(ctx({ facts: facts({ nextDeadline: { title: 'P', day: '2026-11-18' } }) }), 'deadline')).toBe('Próxima entrega: “P”, em 5 dias.');
  });

  it('on a free day nothing nudges: no "open" line and the deadline is not time-sensitive', () => {
    const c = ctx({ world: world({ mode: 'free' }), facts: facts({ openMissions: 3, nextDeadline: { title: 'P', day: TODAY } }) });
    expect(npcLines(c).map((l) => [l.id, l.now])).toEqual([['v-free', true], ['deadline', false], ['stage', false]]);
  });
});

describe('npcStartIndex', () => {
  it('opens on the first time-sensitive line, else rotates by day and territory', () => {
    const lines = [{ id: 'a', text: 'a', now: false }, { id: 'b', text: 'b', now: true }, { id: 'c', text: 'c', now: false }];
    expect(npcStartIndex(lines, TODAY, 0)).toBe(1);
    const calm = lines.map((l) => ({ ...l, now: false }));
    const d0 = npcStartIndex(calm, TODAY, 0);
    expect(npcStartIndex(calm, '2026-11-14', 0)).toBe((d0 + 1) % 3);
    expect(npcStartIndex(calm, TODAY, 1)).toBe((d0 + 1) % 3);
    expect(npcStartIndex([], TODAY, 0)).toBe(0);
  });
});
