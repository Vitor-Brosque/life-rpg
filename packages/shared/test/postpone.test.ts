import { describe, expect, it } from 'vitest';
import { classifyEvent, postponeHypotheses, postponeObserved, strongestBucket, type Bucket } from '../src/postpone';
import { base, checkin, emptyData, event, mission } from './patternFixture';

const areas = [
  { ...base, id: 'area-facul', name: 'Faculdade', attribute: 'Sabedoria', color: '#7bc96f', icon: 'book', order: 0, archived: false },
  { ...base, id: 'area-intelecto', name: 'Estudo', attribute: 'Intelecto', color: '#6fb3e0', icon: 'book', order: 1, archived: false },
];
const missions = [
  mission({ id: 'mH1', title: 'Lista de cálculo', energy: 'heavy', areaId: 'area-facul' }),
  mission({ id: 'mH2', title: 'Relatório de física', energy: 'heavy', areaId: 'area-facul' }),
  mission({ id: 'mL', title: 'Ler capítulo', energy: 'light', areaId: 'area-intelecto' }),
  mission({ id: 'mM', title: 'Organizar notas', energy: 'medium' }),
  mission({ id: 'mDel', title: 'Apagada', deleted: true }),
];
const later = (from: string, to: string) => ({ from, to });
const events = [
  // heavy (Faculdade), afternoons: 6 postponements, 2 starts, 1 shrink
  ...['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map((d) => event('snoozed', 'mH1', d, '15:00', { option: 'tomorrow' })),
  event('snoozed', 'mH2', '2026-11-09', '15:00'), event('snoozed', 'mH2', '2026-11-10', '15:00'),
  event('started', 'mH2', '2026-11-11', '15:00'), event('started', 'mH2', '2026-11-12', '15:00'),
  event('shrunk', 'mH2', '2026-11-09', '15:05'),
  // light (Estudo) and medium (no area), mornings: 3 postponements, 9 starts, 1 drop
  event('snoozed', 'mL', '2026-11-02', '10:00'),
  ...['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09'].map((d) => event('started', 'mL', d, '10:00')),
  event('rescheduled', 'mM', '2026-11-10', '10:00', later('2026-11-10', '2026-11-11')),
  event('rescheduled', 'mM', '2026-11-11', '10:00', later('2026-11-11', '2026-11-12')),
  ...['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map((d) => event('started', 'mM', d, '10:00')),
  event('dropped', 'mM', '2026-11-12', '10:00'),
  // never counted
  event('snoozed', 'mL', '2026-10-16', '10:00'),                 // before the 28-day window
  event('snoozed', 'mDel', '2026-11-02', '10:00'),               // deleted mission
  { ...event('snoozed', 'mL', '2026-11-02', '11:00'), deleted: true },
  event('skipped', 'mL', '2026-11-02', '11:00'),                 // "Outra"
];
const data = emptyData({ missions, areas, events });

describe('classifyEvent', () => {
  const e = (type: Parameters<typeof event>[0], data?: Record<string, unknown>, time = '10:00', day = '2026-11-13') =>
    classifyEvent(event(type, 'mL', day, time, data), 4);
  it('"Adiar" and a move from today (or before) to a later day are postponements', () => {
    expect(e('snoozed', { option: 'later' })).toBe('postponed');
    expect(e('rescheduled', later('2026-11-13', '2026-11-14'))).toBe('postponed');
    expect(e('rescheduled', later('2026-11-12', '2026-11-14'))).toBe('postponed');
    expect(e('rescheduled', later('2026-11-13', '2026-11-14'), '02:00', '2026-11-14')).toBe('postponed');
  });
  it('moving a future day, moving earlier or planning an undated mission is not', () => {
    expect(e('rescheduled', later('2026-11-14', '2026-11-16'))).toBeUndefined();
    expect(e('rescheduled', later('2026-11-13', '2026-11-12'))).toBeUndefined();
    expect(e('rescheduled', { from: null, to: '2026-11-14' })).toBeUndefined();
    expect(e('rescheduled', { from: '2026-11-13', to: null })).toBeUndefined();
  });
  it('started, shrunk and dropped; everything else does not count', () => {
    expect(e('started')).toBe('started');
    expect(e('shrunk')).toBe('shrunk');
    expect(e('dropped')).toBe('dropped');
    expect(e('created')).toBeUndefined();
    expect(e('completed')).toBeUndefined();
    expect(e('skipped')).toBeUndefined();
  });
});

describe('postponeObserved', () => {
  const o = postponeObserved(data);
  it('totals of the last 28 days, live missions only', () => {
    expect([o.from, o.to]).toEqual(['2026-10-17', '2026-11-13']);
    expect({ p: o.postponed, s: o.started, sh: o.shrunk, d: o.dropped }).toEqual({ p: 9, s: 11, sh: 1, d: 1 });
  });
  it('groups of every dimension, by postponements then label', () => {
    const rows = (dim: keyof typeof o.byDim) => o.byDim[dim].map((b) => [b.label, b.postponed, b.started]);
    expect(rows('energy')).toEqual([['Pesadas', 6, 2], ['Médias', 2, 4], ['Leves', 1, 5]]);
    expect(rows('area')).toEqual([['Faculdade', 6, 2], ['Sem área', 2, 4], ['Estudo', 1, 5]]);
    expect(rows('part')).toEqual([['Tarde', 6, 2], ['Manhã', 3, 9]]);
    expect(rows('weekday')).toEqual([
      ['Segunda-feira', 3, 2], ['Terça-feira', 3, 2], ['Quarta-feira', 2, 3], ['Quinta-feira', 1, 3], ['Sexta-feira', 0, 1],
    ]);
    expect(rows('mode')).toEqual([['Normal', 9, 11]]);
    expect(o.byDim.energy[0]).toMatchObject({ key: 'heavy', shrunk: 1, dropped: 0 });
    expect(o.byDim.area[1]).toMatchObject({ key: '', dropped: 1 });
  });
  it('missions with 2 postponements or more, most postponed first, then by title', () => {
    expect(o.missions.map((m) => [m.title, m.postponed, m.started, m.open])).toEqual([
      ['Lista de cálculo', 4, 0, true], ['Organizar notas', 2, 4, true], ['Relatório de física', 2, 2, true],
    ]);
  });
});

describe('strongestBucket', () => {
  const b = (key: string, postponed: number, started: number): Bucket => ({ key, label: key, postponed, started, shrunk: 0, dropped: 0 });
  it('needs 5 postponements, 6 events, a rest with 6 events and a gap of 0.25', () => {
    expect(strongestBucket('energy', [b('heavy', 5, 1)], 8, 10)?.gap).toBeCloseTo(5 / 6 - 3 / 12, 6);
    expect(strongestBucket('energy', [b('heavy', 4, 0)], 7, 9)).toBeUndefined();
    expect(strongestBucket('energy', [b('heavy', 5, 0)], 8, 9)).toBeUndefined();
    expect(strongestBucket('energy', [b('heavy', 5, 1)], 7, 4)).toBeUndefined();
    expect(strongestBucket('energy', [b('heavy', 5, 5)], 8, 14)?.gap).toBeCloseTo(0.25, 6);
    expect(strongestBucket('energy', [b('heavy', 6, 4)], 15, 20)).toBeUndefined();
  });
  it('only candidate groups', () => {
    expect(strongestBucket('energy', [b('medium', 9, 1)], 12, 10)).toBeUndefined();
    expect(strongestBucket('area', [b('', 9, 1)], 12, 10)).toBeUndefined();
    expect(strongestBucket('weekday', [b('6', 9, 1)], 12, 10)).toBeUndefined();
    expect(strongestBucket('mode', [b('normal', 9, 1)], 12, 10)).toBeUndefined();
    expect(strongestBucket('mode', [b('low', 9, 1)], 12, 10)?.bucket.key).toBe('low');
  });
});

describe('postponeHypotheses', () => {
  it('mission first, then the strongest groups; at most 3', () => {
    const h = postponeHypotheses(postponeObserved(data));
    expect(h.map((x) => x.id)).toEqual(['mission:mH1', 'energy:heavy', 'area:area-facul']);
    expect(h[0]).toEqual({
      id: 'mission:mH1', missionId: 'mH1',
      basis: '“Lista de cálculo” foi adiada 4 vezes nas últimas 4 semanas e não foi começada.',
      text: 'Pode ser que “Lista de cálculo” esteja grande ou pouco clara.',
      experiment: 'Nesta semana, reescreva o primeiro passo de “Lista de cálculo” como uma ação de 5 minutos, ou divida a missão em etapas.',
    });
    expect(h[1]!.basis).toBe('Missões pesadas: adiou 6 e começou 2 (75% de adiamentos). As outras: adiou 3 e começou 9 (25%).');
    expect(h[1]!.text).toBe('Pode ser que missões pesadas sejam mais difíceis de começar do jeito que estão escritas.');
    expect(h[2]!.basis).toBe('Faculdade: adiou 6 e começou 2 (75% de adiamentos). Outras áreas: adiou 3 e começou 9 (25%).');
    expect(h[2]!.experiment).toBe('Nesta semana, escolha um horário fixo para uma missão de Faculdade e comece só pelo primeiro passo.');
  });
  it('part of the day, weekday and day type texts', () => {
    const o = postponeObserved(data);
    const only = (dim: 'part' | 'weekday' | 'mode', bucket: Bucket) => postponeHypotheses({
      ...o, missions: [], byDim: { energy: [], area: [], part: [], weekday: [], mode: [], [dim]: [bucket] },
    })[0]!;
    const tarde = only('part', o.byDim.part[0]!);
    expect(tarde.basis).toBe('À tarde: adiou 6 e começou 2 (75% de adiamentos). Em outros horários: adiou 3 e começou 9 (25%).');
    expect(tarde.text).toBe('Pode ser que a tarde seja um horário mais difícil para começar.');
    expect(tarde.experiment).toBe('Nesta semana, deixe para a tarde as missões leves e comece as pesadas em outro horário.');
    const mon = only('weekday', { key: '1', label: 'Segunda-feira', postponed: 6, started: 2, shrunk: 0, dropped: 0 });
    expect(mon.basis).toBe('Nas segundas-feiras: adiou 6 e começou 2 (75% de adiamentos). Nos outros dias: adiou 3 e começou 9 (25%).');
    expect(mon.text).toBe('Pode ser que a segunda-feira concentre mais adiamentos.');
    expect(mon.experiment).toBe('Na próxima segunda-feira, planeje uma missão a menos e use a versão mínima do primeiro bloco.');
    const low = only('mode', { key: 'low', label: 'Baixa energia', postponed: 6, started: 2, shrunk: 0, dropped: 0 });
    expect(low.basis).toBe('Em dias de Baixa energia: adiou 6 e começou 2 (75% de adiamentos). Nos outros dias: adiou 3 e começou 9 (25%).');
    expect(low.text).toBe('Pode ser que, em dias de Baixa energia, o plano ainda fique grande demais.');
    expect(low.experiment).toBe('Nos dias de Baixa energia desta semana, deixe só uma missão planejada por bloco.');
  });
  it('nothing about missions or groups below 8 postponements', () => {
    const fewer = emptyData({ missions, areas, events: events.filter((e, i) => !(e.missionId === 'mH1' && i < 2)) });
    const o = postponeObserved(fewer);
    expect(o.postponed).toBe(7);
    expect(postponeHypotheses(o)).toEqual([]);
  });
  it('the feeling rule: 4 cards with an outcome, "continuou" in half or more; never "outro"', () => {
    const cards = [
      ...['continued', 'continued', 'continued', 'stopped'].map((outcome) =>
        checkin('2026-11-10', '10:00', { kind: 'start', feelings: ['ansiedade'], outcome: outcome as 'continued' | 'stopped' })),
      checkin('2026-11-10', '10:00', { kind: 'start', feelings: ['ansiedade'] }),
      ...['continued', 'stopped', 'stopped', 'stopped'].map((outcome) =>
        checkin('2026-11-11', '10:00', { kind: 'start', feelings: ['tédio'], outcome: outcome as 'continued' | 'stopped' })),
      ...Array.from({ length: 5 }, () => checkin('2026-11-12', '10:00', { kind: 'start', feelings: ['outro'], outcome: 'continued' })),
    ];
    const o = postponeObserved(emptyData({ checkins: cards }));
    expect(o.feelings.map((f) => [f.feeling, f.count, f.withOutcome, f.continued])).toEqual([
      ['ansiedade', 5, 4, 3], ['outro', 5, 5, 5], ['tédio', 4, 4, 1],
    ]);
    expect(postponeHypotheses(o)).toEqual([{
      id: 'feeling:ansiedade',
      basis: 'Nos cards de início com ansiedade, você continuou depois dos 10 minutos em 3 de 4.',
      text: 'Pode ser que começar com 10 minutos ajude quando aparece ansiedade.',
      experiment: 'Quando aparecer ansiedade nesta semana, use “Começar 10 min” no card de início.',
    }]);
  });
});
