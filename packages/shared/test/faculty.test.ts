import { describe, expect, it } from 'vitest';
import type { Area, Commitment, Journey, ProblemSet, SubjectTopic } from '../src/types';
import { timestampAt } from '../src/dates';
import { suggest } from '../src/engine';
import { subjectsOf } from '../src/subjects';
import {
  SEMESTER_GRADE, assessmentKindOf, assessmentTitle, assessmentWhen, classOf, daysWithoutContact, facultyAreaOf, genericClass,
  isFacultyBlock, journeyByTitle, lastContactDay, nextAssessment, semesterSetup, studyDaysBetween, subjectHead,
  subjectSuggestions, problemSetIssue, problemSetText, topicLevelOf, topicsByLevel, topicsSummary, withTopicLevel, type ContactData,
} from '../src/faculty';
import { base, mission, practice, review } from './patternFixture';

const WED = '2026-11-11';
const created = timestampAt('2026-11-02', '10:00');
const j = (id: string, title: string, order: number, p: Partial<Journey> = {}): Journey =>
  ({ ...base, createdAt: created, id, title, status: 'active', order, subject: true, areaId: 'area-facul', ...p });
const subjects = [
  j('j1', 'Estruturas de Dados', 0), j('j2', 'Matemática Discreta', 1), j('j3', 'Banco de Dados', 2),
  j('j4', 'Redes de Computadores', 3), j('j5', 'Engenharia de Software', 4),
];
const cls = (id: string, title: string, wd: number, p: Partial<Commitment> = {}): Commitment =>
  ({ ...base, id, title, date: '2026-08-03', start: '19:00', end: '23:00', weekdays: [wd], remind: true, ...p });
const classes = SEMESTER_GRADE.map((t, i) => cls(`c${i + 1}`, t.title, t.weekdays[0]!));
const area = (id: string, name: string): Area => ({ ...base, id, name, attribute: 'x', color: '#000', icon: 'book', order: 0, archived: false });
const empty: ContactData = { dayStartHour: 4, decks: [], cards: [], reviews: [], practice: [], missions: [], focus: [], problemSets: [], topics: [] };
const ps = (journeyId: string, day: string, p: Partial<ProblemSet> = {}): ProblemSet => ({ ...base, id: `ps-${journeyId}-${day}`, journeyId, day, title: 'Lista', done: 5, ...p });

describe('subjects and classes', () => {
  it('facultyAreaOf: by id, else by name', () => {
    expect(facultyAreaOf([area('a1', 'Estudo'), area('area-facul', 'Uni')])?.id).toBe('area-facul');
    expect(facultyAreaOf([area('a2', ' faculdade ')])?.id).toBe('a2');
    expect(facultyAreaOf([area('a3', 'Estudo')])).toBeUndefined();
  });
  it('journeyByTitle and classOf: same compacted title, else starting with it; expired and one-off classes never', () => {
    expect(journeyByTitle([j('x', 'Matematica Discreta', 9, { subject: false })], 'Matemática Discreta')?.id).toBe('x');
    expect(journeyByTitle([j('x', 'Cálculo', 9, { status: 'done' })], 'Cálculo')).toBeUndefined();
    expect(classOf('Matemática Discreta', [cls('a', 'Matemática Discreta (sala 3)', 2)], WED)?.id).toBe('a');
    expect(classOf('Matemática Discreta', [cls('a', 'Matemática Discreta', 2, { untilDate: '2026-11-01' })], WED)).toBeUndefined();
    expect(classOf('Matemática Discreta', [cls('a', 'Matemática Discreta', 2, { weekdays: undefined })], WED)).toBeUndefined();
    expect(classOf('Matemática Discreta', [cls('a', 'Cálculo', 2)], WED)).toBeUndefined();
  });
  it('semesterSetup reuses a matching journey and class; genericClass finds "Aula"', () => {
    const items = semesterSetup(SEMESTER_GRADE, [j('old', 'Matematica Discreta', 9, { subject: false })], [classes[0]!], WED);
    expect(items.map((i) => [i.template.title, i.journeyId, i.classId])).toEqual([
      ['Estruturas de Dados', undefined, 'c1'], ['Matemática Discreta', 'old', undefined], ['Banco de Dados', undefined, undefined],
      ['Redes de Computadores', undefined, undefined], ['Engenharia de Software', undefined, undefined],
    ]);
    expect(genericClass([cls('aula', 'Aula', 1, { weekdays: [1, 2, 3, 4, 5] })], WED)?.id).toBe('aula');
    expect(genericClass(classes, WED)).toBeUndefined();
  });
  it('subjectsOf lists a disciplina without decks; "Próxima entrega" skips avaliações', () => {
    const out = subjectsOf({
      dayStartHour: 4, journeys: [j('j2', 'Matemática Discreta', 1), j('plain', 'Sem nada', 2, { subject: false })], decks: [], cards: [], notes: [],
      reviews: [], practice: [],
      missions: [mission({ id: 'p', title: 'Prova de Matemática Discreta', journeyId: 'j2', assessment: 'prova', date: '2026-11-20', deadline: '2026-11-20' })],
    }, WED);
    expect(out.map((s) => s.title)).toEqual(['Matemática Discreta']);
    expect(out[0]!.nextDeadline).toBeUndefined();
  });
});

describe('avaliações', () => {
  it('assessmentKindOf / assessmentTitle / assessmentWhen', () => {
    expect(assessmentKindOf('Prova')).toBe('prova');
    expect(assessmentKindOf('trabalho final')).toBe('trabalho');
    expect(assessmentKindOf('estudar para a prova')).toBeUndefined();
    expect(assessmentTitle('prova', 'prova', 'Matemática Discreta')).toBe('Prova de Matemática Discreta');
    expect(assessmentTitle('trabalho', 'trabalho relatório', 'ISI')).toBe('Trabalho relatório');
    expect([assessmentWhen('prova', 0), assessmentWhen('prova', 1), assessmentWhen('trabalho', 5)]).toEqual(['Prova hoje', 'Prova amanhã', 'Trabalho em 5 dias']);
  });
  it('nextAssessment: the nearest open one from today on', () => {
    const ms = [
      mission({ id: 'a', title: 'Prova 2', journeyId: 'j2', assessment: 'prova', date: '2026-12-03' }),
      mission({ id: 'b', title: 'Prova 1', journeyId: 'j2', assessment: 'prova', date: '2026-11-20' }),
      mission({ id: 'c', title: 'Velha', journeyId: 'j2', assessment: 'prova', date: '2026-11-01' }),
      mission({ id: 'd', title: 'Feita', journeyId: 'j2', assessment: 'trabalho', date: '2026-11-12', status: 'done' }),
      mission({ id: 'e', title: 'Lista', journeyId: 'j2', date: '2026-11-12' }),
    ];
    expect(nextAssessment(ms, 'j2', WED)).toEqual({ missionId: 'b', kind: 'prova', title: 'Prova 1', day: '2026-11-20', inDays: 9 });
    expect(nextAssessment(ms, 'j3', WED)).toBeUndefined();
  });
  it('subjectHead never returns an avaliação; the engine never makes one the journey head', () => {
    const prova = mission({ id: 'p', title: 'Prova', journeyId: 'j2', assessment: 'prova', date: '2026-11-20', createdAt: 0 });
    const step = mission({ id: 's', title: 'Lista 4, questão 1', journeyId: 'j2', createdAt: 5 });
    expect(subjectHead([prova, step], 'j2')?.id).toBe('s');
    const out = suggest({
      now: timestampAt(WED, '15:30'), dayStartHour: 4, dayEndHour: 23, missions: [prova, step], journeys: [subjects[1]!],
      commitments: [], hardDay: false, lastCompletionByArea: {},
    });
    expect(out.ranked.map((s) => s.mission.id)).toEqual(['s']);
  });
});

describe('contact', () => {
  it('lastContactDay: reviews in its decks, practice, concluded missions, focus on its missions, exercises, topic marks', () => {
    const data: ContactData = {
      ...empty,
      decks: [{ ...base, id: 'd2', name: 'Cálculo', journeyId: 'j2', order: 0, archived: false }],
      reviews: [review('2026-11-05', 3, { deckId: 'd2' }), review('2026-11-09', 3, { deckId: 'outro' })],
      missions: [mission({ id: 'm', title: 'x', journeyId: 'j2', status: 'done', completedAt: timestampAt('2026-11-06', '10:00') })],
    };
    expect(lastContactDay('j2', data)).toBe('2026-11-06');
    expect(lastContactDay('j2', { ...data, practice: [practice({ journeyId: 'j2', createdAt: timestampAt('2026-11-04', '10:00'), endedAt: timestampAt('2026-11-07', '10:00') })] })).toBe('2026-11-07');
    expect(lastContactDay('j2', { ...data, focus: [{ ...base, id: 'f', startedAt: timestampAt('2026-11-09', '15:00'), endedAt: timestampAt('2026-11-09', '16:00'), activeMs: 1, mode: 'free', outcome: 'finished', missionId: 'm' }] })).toBe('2026-11-09');
    expect(lastContactDay('j2', { ...data, problemSets: [ps('j2', '2026-11-10')] })).toBe('2026-11-10');
    const topic: SubjectTopic = { ...base, id: 't', journeyId: 'j2', name: 'Integrais', marks: [{ at: timestampAt('2026-11-10', '21:00'), level: 'vi' }] };
    expect(lastContactDay('j2', { ...data, topics: [topic] })).toBe('2026-11-10');
    expect(lastContactDay('j3', data)).toBeUndefined();
  });
  it('studyDaysBetween and daysWithoutContact count study days only (rest days out, today out)', () => {
    expect(studyDaysBetween('2026-11-02', WED, [0, 6])).toBe(6);
    expect(studyDaysBetween('2026-11-10', WED, [0, 6])).toBe(0);
    expect(daysWithoutContact(subjects[2]!, empty, WED, [0, 6])).toBe(6);
    expect(daysWithoutContact(subjects[0]!, { ...empty, problemSets: [ps('j1', '2026-11-09')] }, WED, [0, 6])).toBe(1);
    expect(daysWithoutContact({ id: 'new', createdAt: timestampAt(WED, '10:00') }, empty, WED, [0, 6])).toBe(0);
  });
});

describe('Faculdade block suggestion', () => {
  const contact: ContactData = {
    ...empty,
    problemSets: [ps('j1', '2026-11-09'), ps('j2', '2026-11-10'), ps('j5', '2026-11-04'), ps('j4', '2026-11-10')],
  };
  const input = {
    today: WED, journeys: subjects, commitments: classes, contact, restDays: [0, 6],
    missions: [
      mission({ id: 'p', title: 'Prova de Probabilidade', journeyId: 'j4', assessment: 'prova' as const, date: '2026-11-16' }),
      mission({ id: 'far', title: 'Prova longe', journeyId: 'j1', assessment: 'prova' as const, date: '2026-12-01' }),
    ],
  };
  it('priority: avaliação within 14 days, then no contact, then class today, then the previous class day', () => {
    expect(subjectSuggestions(input).map((s) => [s.journey.id, s.text])).toEqual([
      ['j4', 'Prova em 5 dias'], ['j3', 'Sem contato há 6 dias de estudo'], ['j2', 'Revisar a aula de ontem'],
    ]);
  });
  it('class today, and the previous class day across the weekend', () => {
    const fresh = { ...input, missions: [], contact: { ...empty, problemSets: subjects.map((s) => ps(s.id, '2026-11-06')) } };
    expect(subjectSuggestions({ ...fresh, today: '2026-11-09' }).map((s) => [s.journey.id, s.text])).toEqual([
      ['j1', 'Aula hoje à noite'], ['j5', 'Revisar a aula de sexta-feira'],
    ]);
  });
  it('weekends: nothing; no subjects: nothing', () => {
    expect(subjectSuggestions({ ...input, today: '2026-11-14' })).toEqual([]);
    expect(subjectSuggestions({ ...input, journeys: subjects.map((s) => ({ ...s, subject: false })) })).toEqual([]);
  });
  it('isFacultyBlock: the area, or a journey of the area', () => {
    expect(isFacultyBlock({ areaId: 'area-facul' }, 'area-facul', [])).toBe(true);
    expect(isFacultyBlock({ journeyId: 'j2' }, 'area-facul', subjects)).toBe(true);
    expect(isFacultyBlock({ areaId: 'area-intelecto' }, 'area-facul', subjects)).toBe(false);
    expect(isFacultyBlock({ areaId: 'area-facul' }, undefined, [])).toBe(false);
  });
});

describe('exercícios e assuntos', () => {
  it('problemSetIssue and problemSetText', () => {
    expect(problemSetIssue({ title: 'Lista 4', done: 8, total: 10, unaided: 5 })).toBeUndefined();
    expect(problemSetIssue({ title: '  ', done: 8 })).toBe('title');
    expect(problemSetIssue({ title: 'L', done: 2.5 })).toBe('done');
    expect(problemSetIssue({ title: 'L', done: 8, total: 6 })).toBe('total');
    expect(problemSetIssue({ title: 'L', done: 8, unaided: 9 })).toBe('unaided');
    expect(problemSetText({ title: 'Lista 4', done: 8, total: 10, unaided: 5 })).toBe('Lista 4 · 8 de 10 · 5 sem ajuda');
    expect(problemSetText({ title: 'Lista 4', done: 1 })).toBe('Lista 4 · 1 feito');
  });
  it('topic levels: history only appended; same level is a no-op; grouped and summarised', () => {
    const t: SubjectTopic = { ...base, id: 't1', journeyId: 'j2', name: 'Integrais', marks: [] };
    expect(topicLevelOf(t)).toBe('nenhum');
    const a = withTopicLevel(t, 'vi', 10)!;
    const b = withTopicLevel({ marks: a.marks }, 'entendi', 20)!;
    expect(b.marks).toEqual([{ at: 10, level: 'vi' }, { at: 20, level: 'entendi' }]);
    expect(withTopicLevel({ marks: b.marks }, 'entendi', 30)).toBeUndefined();
    const groups = topicsByLevel([
      { ...t, marks: b.marks }, { ...t, id: 't2', name: 'Derivadas', marks: [{ at: 1, level: 'resolvo' }] },
      { ...t, id: 't3', name: 'Séries', marks: [] }, { ...t, id: 't4', name: 'Apagado', deleted: true, marks: [] },
      { ...t, id: 't5', journeyId: 'j3', name: 'Outra', marks: [] },
    ], 'j2');
    expect(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.map((x) => x.name)])))
      .toEqual({ nenhum: ['Séries'], vi: [], entendi: ['Integrais'], resolvo: ['Derivadas'] });
    expect(topicsSummary(groups)).toBe('1 resolvo sem ajuda · 1 entendi · 1 ainda não');
  });
});
