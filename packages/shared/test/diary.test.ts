import { describe, expect, it } from 'vitest';
import type { DayPlan, DayState, DiaryEntry, MonthReview, TrainingLog, Week } from '../src/types';
import {
  DIARY_EXPORT_DEFAULTS, DIARY_THEMES, DIARY_THEME_LABEL, appDayLine, closeNoteEntry, diaryAppDays, diaryCloseId,
  diaryDayTitle, diaryFileName, diaryFiltering, diaryLinksInUse, diaryMarkdown, diaryMoment, diaryPreview, diaryReviews,
  diaryWeek, diaryWeekLabel, linkKey, sameWeekLastMonth, searchDiary, weekOfDay,
  type DiaryAppDay, type DiaryReviewRef,
} from '../src/diary';
import { weekDays } from '../src/meals';
import { base, block, night, session, workout } from './patternFixture';

const at = (day: number, h: number, m = 0): number => new Date(2026, 10, day, h, m).getTime();
const entry = (id: string, p: Partial<DiaryEntry> & Pick<DiaryEntry, 'day' | 'at'>): DiaryEntry => ({
  ...base, id, kind: 'livre', text: id, themes: [], links: [], private: false, ...p,
});
const MON = '2026-11-09';

describe('closeNoteEntry (Dexie v10)', () => {
  const ds = (p: Partial<DayState>): DayState => ({ ...base, id: '2026-11-10', hardDay: false, reviewDone: false, ...p });
  it('builds the fechamento entry from the DayState alone: id, text, closedAt, timestamps = updatedAt', () => {
    expect(closeNoteEntry(ds({ closeNote: 'Dia corrido.', closedAt: at(10, 23, 5), updatedAt: at(10, 23, 6) }))).toEqual({
      id: 'diary-close-2026-11-10', createdAt: at(10, 23, 6), updatedAt: at(10, 23, 6), deleted: false,
      day: '2026-11-10', at: at(10, 23, 5), kind: 'fechamento', text: 'Dia corrido.', themes: [], links: [], private: false,
    });
  });
  it('without closedAt the moment is 22:00 of the day', () => {
    expect(closeNoteEntry(ds({ closeNote: 'x' }))!.at).toBe(at(10, 22));
  });
  it('nothing for a deleted DayState, a blank note or no note', () => {
    expect(closeNoteEntry(ds({ closeNote: 'x', deleted: true }))).toBeUndefined();
    expect(closeNoteEntry(ds({ closeNote: '   ' }))).toBeUndefined();
    expect(closeNoteEntry(ds({}))).toBeUndefined();
  });
  it('diaryCloseId', () => {
    expect(diaryCloseId('2026-11-10')).toBe('diary-close-2026-11-10');
  });
});

describe('themes, days and weeks', () => {
  it('thirteen themes with their labels', () => {
    expect(DIARY_THEMES.map((t) => DIARY_THEME_LABEL[t])).toEqual([
      'Faculdade', 'Carreira', 'Projetos', 'Estudo', 'Saúde', 'Treino', 'Sono',
      'Relacionamentos', 'Família', 'Lazer', 'Sentimentos', 'Ideias', 'Comunicação',
    ]);
  });
  it('weeks run Monday to Sunday', () => {
    expect(weekOfDay('2026-11-15')).toBe(MON);
    expect(weekOfDay('2026-11-16')).toBe('2026-11-16');
    expect(weekDays(MON)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
    expect(diaryWeekLabel(MON)).toBe('Semana 09/11–15/11');
    expect(diaryWeekLabel('2026-12-28')).toBe('Semana 28/12–03/01');
  });
  it('same week, last month: the week of the same day of the month (clamped)', () => {
    expect(sameWeekLastMonth(MON)).toBe('2026-10-05');
    expect(sameWeekLastMonth('2026-03-30')).toBe('2026-02-23');
    expect(sameWeekLastMonth('2026-01-05')).toBe('2025-12-01');
  });
  it('day titles', () => {
    expect(diaryDayTitle('2026-11-10')).toBe('Terça-feira, 10/11');
    expect(diaryDayTitle('2026-11-14')).toBe('Sábado, 14/11');
    expect(diaryDayTitle('2026-11-15')).toBe('Domingo, 15/11');
  });
  it('diaryMoment: logical day and time; before the day start is the next morning', () => {
    expect(diaryMoment('2026-11-10', '21:05', 4)).toEqual({ day: '2026-11-10', at: at(10, 21, 5) });
    expect(diaryMoment('2026-11-10', '01:30', 4)).toEqual({ day: '2026-11-10', at: at(11, 1, 30) });
    expect(diaryMoment('2026-11-10', '25:00', 4)).toBeUndefined();
    expect(diaryMoment('2026-02-30', '10:00', 4)).toBeUndefined();
    expect(diaryMoment('', '10:00', 4)).toBeUndefined();
  });
  it('diaryPreview: first lines, blanks skipped, cut with an ellipsis', () => {
    expect(diaryPreview('Um\n\n  Dois  \nTrês')).toBe('Um\nDois\nTrês');
    expect(diaryPreview('Um\nDois\nTrês\nQuatro')).toBe('Um\nDois\nTrês…');
    expect(diaryPreview('abcdef', 3, 4)).toBe('abcd…');
    expect(diaryPreview('   ')).toBe('');
  });
  it('diaryFileName', () => {
    expect(diaryFileName(MON)).toBe('diario-2026-11-09_a_2026-11-15.md');
  });
});

describe('diaryReviews', () => {
  const week = (id: string, answeredAt: number, p: Partial<Week['review']> = {}): Week => ({
    ...base, id, objectives: [], review: { worked: 'Blocos curtos de manhã.', obstacle: '', adjustment: ' Dormir antes ', answeredAt, ...p },
  });
  const month = (p: Partial<MonthReview>): MonthReview => ({
    ...base, id: 'month-2026-10', month: '2026-10', observed: {} as MonthReview['observed'], answeredAt: at(11, 9),
    answers: { progress: 'Terminei a lista 3.', obstacle: '', next: '' }, ...p,
  });
  it('keeps only answered questions, by logical day of answeredAt, oldest first', () => {
    const refs = diaryReviews({
      weeks: [week('2026-11-09', at(10, 1, 30)), week('2026-11-02', at(3, 9)), { ...week('2026-11-16', at(16, 9)) }],
      months: [month({})], monday: MON, dayStartHour: 4,
    });
    expect(refs).toEqual([
      { kind: 'week', id: '2026-11-09', day: '2026-11-09', at: at(10, 1, 30), title: 'Nova semana',
        answers: [{ label: 'O que funcionou', text: 'Blocos curtos de manhã.' }, { label: 'Ajuste para testar', text: 'Dormir antes' }] },
      { kind: 'month', id: 'month-2026-10', day: '2026-11-11', at: at(11, 9), title: 'Reflexão de outubro',
        answers: [{ label: 'Avanços', text: 'Terminei a lista 3.' }] },
    ]);
  });
  it('leaves out skipped months, deleted records and reviews with no answer', () => {
    expect(diaryReviews({
      weeks: [{ ...week('2026-11-09', at(10, 9)), deleted: true }, week('2026-11-08', at(10, 9), { worked: '  ', adjustment: '' })],
      months: [month({ skipped: true, answers: undefined }), month({ id: 'month-2026-09', answers: { progress: '', obstacle: '', next: '' } })],
      monday: MON, dayStartHour: 4,
    })).toEqual([]);
  });
});

describe('diaryWeek and searchDiary', () => {
  const entries: DiaryEntry[] = [
    entry('a', { day: '2026-11-10', at: at(10, 21, 5), text: 'Reunião com a orientadora', themes: ['faculdade'], links: [{ kind: 'journey', id: 'j1' }] }),
    entry('b', { day: '2026-11-10', at: at(10, 8, 30), text: 'Acordei cedo', private: true }),
    entry('c', { day: '2026-11-12', at: at(12, 22), text: 'Treino pesado', themes: ['treino'] }),
    entry('d', { day: '2026-11-11', at: at(11, 9), text: 'Reunião apagada', trashedAt: at(11, 10) }),
    entry('e', { day: '2026-11-11', at: at(11, 9), text: '', deleted: true }),
    entry('f', { day: '2026-11-16', at: at(16, 9), text: 'Outra semana, reunião' }),
  ];
  const review: DiaryReviewRef = { kind: 'week', id: MON, day: '2026-11-14', at: at(14, 10), title: 'Nova semana', answers: [] };

  it('groups the week by day, newest day first, entries in time order; a review makes its day appear', () => {
    const groups = diaryWeek(entries, MON, [review]);
    expect(groups.map((g) => [g.day, g.entries.map((e) => e.id), g.reviews.length])).toEqual([
      ['2026-11-14', [], 1], ['2026-11-12', ['c'], 0], ['2026-11-10', ['b', 'a'], 0],
    ]);
    expect(diaryWeek(entries, '2026-11-02')).toEqual([]);
  });
  it('search: every word, accents and case ignored, all weeks, newest first; trashed and deleted never', () => {
    expect(searchDiary(entries, 'reuniao').map((e) => e.id)).toEqual(['f', 'a']);
    expect(searchDiary(entries, 'ORIENTADORA reunião').map((e) => e.id)).toEqual(['a']);
    expect(searchDiary(entries, 'reunião prova')).toEqual([]);
    expect(searchDiary(entries, '').map((e) => e.id)).toEqual(['f', 'c', 'a', 'b']);
  });
  it('filters: theme, link, only private', () => {
    expect(searchDiary(entries, '', { theme: 'treino' }).map((e) => e.id)).toEqual(['c']);
    expect(searchDiary(entries, '', { link: { kind: 'journey', id: 'j1' } }).map((e) => e.id)).toEqual(['a']);
    expect(searchDiary(entries, '', { link: { kind: 'mission', id: 'j1' } })).toEqual([]);
    expect(searchDiary(entries, '', { onlyPrivate: true }).map((e) => e.id)).toEqual(['b']);
    expect(searchDiary(entries, 'cedo', { theme: 'treino' })).toEqual([]);
  });
  it('diaryFiltering and the links in use', () => {
    expect(diaryFiltering('  ', {})).toBe(false);
    expect(diaryFiltering('', { onlyPrivate: false })).toBe(false);
    expect(diaryFiltering('x', {})).toBe(true);
    expect(diaryFiltering('', { theme: 'sono' })).toBe(true);
    expect(diaryLinksInUse([...entries, entry('g', { day: '2026-11-13', at: at(13, 9), links: [{ kind: 'journey', id: 'j1' }, { kind: 'mission', id: 'm1' }] })]))
      .toEqual([{ kind: 'journey', id: 'j1' }, { kind: 'mission', id: 'm1' }]);
    expect(linkKey({ kind: 'mission', id: 'm1' })).toBe('mission:m1');
  });
});

describe('diaryAppDays and appDayLine', () => {
  const blocks = [block({ id: 'b1', targetStart: '09:00' }), block({ id: 'b2', targetStart: '14:00', order: 1 })];
  const log: TrainingLog = {
    ...base, id: 'training-2026-11-10', day: '2026-11-10', planName: 'Peito e tríceps', exercises: [
      { id: 'p0', name: 'Supino', status: 'feito', sets: [] },
      { id: 'p1', name: 'Crucifixo', status: 'trocado', replacedBy: 'Peck deck', sets: [] },
      { id: 'p2', name: 'Paralelas', status: 'pulado', sets: [] },
      { id: 'p3', name: 'Tríceps', sets: [] },
    ],
  };
  const plan: DayPlan = {
    ...base, id: '2026-11-11', day: '2026-11-11', mode: 'normal', takenAt: at(11, 8), commitments: [],
    blocks: [{ blockId: 'b1', name: 'b1', kind: 'focus', targetStart: '09:00', durationMin: 120, minimumMin: 30, protected: false, order: 0, createdAt: 1 }],
  };
  const states: DayState[] = [
    { ...base, id: '2026-11-10', hardDay: false, reviewDone: false, startedAt: at(10, 8), tiredness: 'medio' },
    { ...base, id: '2026-11-12', hardDay: true, reviewDone: false, mode: 'low', startedAt: at(12, 8), deleted: true },
    { ...base, id: '2026-11-13', hardDay: false, reviewDone: false, closeDismissed: true },
    { ...base, id: '2026-11-14', hardDay: false, reviewDone: false, startedAt: at(14, 10) },
  ];
  const days = diaryAppDays({
    days: weekDays(MON), dayStartHour: 4, dayEndHour: 0, dayStates: states, blocks, commitments: [],
    sessions: [session('b1', '2026-11-10')], dayPlans: [plan], trainingLogs: [log],
    workouts: [workout('2026-11-11', 'musculacao', 60), workout('2026-11-10', 'cardio', 20)],
    sleepLogs: [{ ...night('2026-11-09', '23:40', 450), quality: 4 }, night('2026-11-10', '23:50')],
  });

  it('only what exists, day by day', () => {
    expect(days).toEqual({
      '2026-11-10': {
        mode: 'normal', blocks: { started: 1, planned: 2 }, training: { name: 'Peito e tríceps', exercises: 2 },
        sleep: { bedAt: at(9, 23, 40), wakeAt: at(10, 7, 10), quality: 4 }, tiredness: 'medio',
      },
      '2026-11-11': { blocks: { started: 0, planned: 1 }, workouts: [{ kind: 'musculacao', minutes: 60 }] },
      '2026-11-14': { mode: 'free' },
    });
  });
  it('the line: day type, blocks, training, sleep, tiredness', () => {
    expect(appDayLine(days['2026-11-10']!)).toBe(
      'dia Normal · 1 de 2 blocos iniciados · treino: Peito e tríceps (2 exercícios feitos) · sono 23:40–07:10 (qualidade 4) · cansaço: médio',
    );
    expect(appDayLine(days['2026-11-11']!)).toBe('0 de 1 bloco iniciado · treino: Musculação 60 min');
    expect(appDayLine({ training: { exercises: 0, cardioMin: 20 } })).toBe('treino: cardio 20 min');
    expect(appDayLine({ training: { name: 'Pernas', exercises: 1, cardioMin: 15 }, mode: 'low' })).toBe('dia Baixa energia · treino: Pernas (1 exercício feito, cardio 15 min)');
    expect(appDayLine({})).toBeUndefined();
  });
});

describe('diaryMarkdown', () => {
  const entries: DiaryEntry[] = [
    entry('close', { day: '2026-11-10', at: at(10, 21, 5), kind: 'fechamento', text: 'Dia corrido, mas a aula rendeu.\n', themes: ['familia'], links: [{ kind: 'journey', id: 'j-tech' }, { kind: 'mission', id: 'm-gone' }] }),
    entry('morning', { day: '2026-11-10', at: at(10, 8, 30), text: 'Acordei cedo.\n\nCafé com calma.', links: [{ kind: 'mission', id: 'm-gone' }] }),
    entry('mine', { day: '2026-11-12', at: at(12, 22, 10), text: 'Algo só meu.', private: true }),
    entry('trash', { day: '2026-11-13', at: at(13, 9), text: 'Na lixeira', trashedAt: at(13, 10) }),
    entry('next', { day: '2026-11-16', at: at(16, 9), text: 'Outra semana' }),
  ];
  const appDays: Record<string, DiaryAppDay> = {
    '2026-11-10': { mode: 'normal', blocks: { started: 4, planned: 5 }, training: { name: 'Peito e tríceps', exercises: 5 }, sleep: { bedAt: at(9, 23, 40), wakeAt: at(10, 7, 10), quality: 4 }, tiredness: 'medio' },
    '2026-11-11': { mode: 'low' },
  };
  const reviews: DiaryReviewRef[] = [{
    kind: 'week', id: MON, day: '2026-11-10', at: at(10, 9), title: 'Nova semana',
    answers: [{ label: 'O que funcionou', text: 'Blocos curtos de manhã.' }],
  }];
  const input = {
    monday: MON, exportedOn: '2026-11-16', entries, appDays, reviews,
    linkNames: { 'journey:j-tech': 'Tech News' }, options: DIARY_EXPORT_DEFAULTS,
  };

  it('the default export: private out, the app records and the reviews in', () => {
    expect(diaryMarkdown(input)).toBe([
      '# Diário — 09/11 a 15/11/2026',
      'Exportado do LIFE RPG em 16/11/2026. As entradas são minhas palavras, sem edição. "Registrado pelo app" vem dos registros do aplicativo.',
      '',
      '## Terça-feira, 10/11',
      '### 08:30',
      'Acordei cedo.',
      '',
      'Café com calma.',
      '',
      '### 21:05 · fechamento do dia',
      'Dia corrido, mas a aula rendeu.',
      '',
      '_Temas: Família · Ligado a: jornada "Tech News"_',
      '',
      '**Registrado pelo app:** dia Normal · 4 de 5 blocos iniciados · treino: Peito e tríceps (5 exercícios feitos) · sono 23:40–07:10 (qualidade 4) · cansaço: médio',
      '',
      '## Quarta-feira, 11/11',
      '',
      '**Registrado pelo app:** dia Baixa energia',
      '',
      '## Revisões escritas nesta semana',
      '### Nova semana (respondida em 10/11)',
      '- O que funcionou: Blocos curtos de manhã.',
      '',
    ].join('\n'));
  });
  it('private entries only when included; without the app records a day with no entry is left out', () => {
    expect(diaryMarkdown({ ...input, options: { includePrivate: true, includeApp: false, includeReviews: false } })).toBe([
      '# Diário — 09/11 a 15/11/2026',
      'Exportado do LIFE RPG em 16/11/2026. As entradas são minhas palavras, sem edição.',
      '',
      '## Terça-feira, 10/11',
      '### 08:30',
      'Acordei cedo.',
      '',
      'Café com calma.',
      '',
      '### 21:05 · fechamento do dia',
      'Dia corrido, mas a aula rendeu.',
      '',
      '_Temas: Família · Ligado a: jornada "Tech News"_',
      '',
      '## Quinta-feira, 12/11',
      '### 22:10 · privada',
      'Algo só meu.',
      '',
    ].join('\n'));
  });
  it('an empty week says so; a week across two years shows both', () => {
    expect(diaryMarkdown({ ...input, monday: '2026-12-28', entries: [], appDays: {}, reviews: [] })).toBe([
      '# Diário — 28/12/2026 a 03/01/2027',
      'Exportado do LIFE RPG em 16/11/2026. As entradas são minhas palavras, sem edição. "Registrado pelo app" vem dos registros do aplicativo.',
      '',
      'Sem registros nesta semana.',
      '',
    ].join('\n'));
  });
});
