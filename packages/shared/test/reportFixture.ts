import type {
  Area, Block, DayPlan, DayState, DiaryEntry, Journey, MonthReview, PlannedBlock, TrainingExercise, TrainingLog,
} from '../src/types';
import type { ReportData } from '../src/reportSections';
import { base, block, checkin, emptyData, event, mission, night, practice, review, session, workout, xp } from './patternFixture';

// Relatórios: one full week (09/11–15/11/2026) seen on Monday 16/11, the day the screen opens on it by default.

export const TODAY = '2026-11-16';
export const at = (day: number, h: number, m = 0): number => new Date(2026, 10, day, h, m).getTime();

/** An empty report input (today 16/11, day start 4, day end 0, rest days Saturday and Sunday). */
export function reportData(p: Partial<ReportData> = {}): ReportData {
  return {
    ...emptyData({ today: TODAY }),
    dayPlans: [], focusSessions: [], journeys: [], restDays: [0, 6], diaryEntries: [], monthReviews: [],
    trainingLogs: [], problemSets: [], subjectTopics: [], decks: [], cards: [], linkNames: {}, strategies: [], goals: [], seasons: [],
    speechSessions: [], speechSituations: [], speechPrograms: [],
    ...p,
  };
}

const area = (id: string, name: string): Area => ({ ...base, id, name, attribute: 'x', color: '#000', icon: 'star', order: 0, archived: false });
const dayState = (id: string, p: Partial<DayState>): DayState => ({ ...base, id, hardDay: false, reviewDone: false, ...p });
const journey = (p: Partial<Journey> & Pick<Journey, 'id' | 'title'>): Journey => ({ ...base, status: 'active', order: 0, ...p });
const diary = (id: string, p: Partial<DiaryEntry> & Pick<DiaryEntry, 'day' | 'at' | 'text'>): DiaryEntry => ({
  ...base, id, kind: 'livre', themes: [], links: [], private: false, ...p,
});
const done = (id: string, name: string): TrainingExercise => ({ id, name, status: 'feito', sets: [{ reps: 10, kg: 40 }] });

export const TECH: Block = block({ id: 'tech', name: 'Tech News', areaId: 'a-tech' });
export const FACUL: Block = block({ id: 'facul', name: 'Faculdade', order: 1, targetStart: '14:00', durationMin: 90, kind: 'study', areaId: 'a-facul' });

const planned = (b: Block): PlannedBlock => ({
  blockId: b.id, name: b.name, kind: b.kind, areaId: b.areaId, targetStart: b.targetStart, durationMin: b.durationMin,
  minimumMin: b.minimumMin, protected: b.protected, order: b.order, createdAt: b.createdAt,
});
const plan = (day: string): DayPlan => ({
  ...base, id: day, day, mode: 'normal', takenAt: at(Number(day.slice(8)), 8), blocks: [planned(TECH), planned(FACUL)], commitments: [],
});

const NO_OBSERVED: MonthReview['observed'] = {
  workdays: 0, activeWorkdays: 0, blocksPlanned: 0, blocksStarted: 0, minimumUsed: 0, resumptions: 0, reviews: 0,
  practiceClosed: 0, workouts: 0, escapes: 0,
};

/** The week: blocks, missions, focus, cards, practice, two subjects, habits, check-ins, sleep, training, tiredness, diary. */
export function weekData(p: Partial<ReportData> = {}): ReportData {
  const trainingLogs: TrainingLog[] = [
    { ...base, id: 'training-2026-11-09', day: '2026-11-09', planName: 'Peito e tríceps', exercises: [
      done('p0', 'Supino'), done('p1', 'Crucifixo'), done('p2', 'Elevação lateral'), done('p3', 'Tríceps'), done('p4', 'Abdominal'),
      { id: 'p5', name: 'Crossover', status: 'pulado', sets: [] },
    ] },
    { ...base, id: 'training-2026-11-10', day: '2026-11-10', planName: 'Costas e bíceps', exercises: [
      done('p0', 'Puxada'), done('p1', 'Remada'), done('p2', 'Rosca'), done('p3', 'Encolhimento'),
      { id: 'p4', name: 'Crucifixo inverso', status: 'trocado', replacedBy: 'Remada baixa', sets: [] },
    ] },
    { ...base, id: 'training-2026-11-11', day: '2026-11-11', exercises: [], cardio: { modality: 'bicicleta', minutes: 20, intensity: 6 } },
  ];
  return reportData({
    areas: [area('a-tech', 'Tech News'), area('a-facul', 'Faculdade')],
    blocks: [TECH, FACUL],
    sessions: [
      session('tech', '2026-11-09', '09:00'),
      { ...session('facul', '2026-11-09', '15:00'), outcome: 'feito', result: 'Lista 3 quase toda' },
      { ...session('tech', '2026-11-10', '09:30', 'minimum'), outcome: 'parcial' },
      { ...base, id: 'bs-facul-2026-11-10', blockId: 'facul', day: '2026-11-10', version: 'normal', skipped: true, endedAt: at(10, 15) },
      session('facul', '2026-11-11', '15:00'),
      session('tech', '2026-11-13', '09:00'),
    ],
    dayStates: [
      dayState('2026-11-09', { startedAt: at(9, 8), tiredness: 'medio' }),
      dayState('2026-11-10', { startedAt: at(10, 8), tiredness: 'muito' }),
      dayState('2026-11-11', { startedAt: at(11, 9), mode: 'low', tiredness: 'muito' }),
      dayState('2026-11-13', { startedAt: at(13, 8) }),
    ],
    dayPlans: [plan('2026-11-09'), plan('2026-11-10')],
    missions: [
      mission({ id: 'm1', title: 'Escrever pauta', status: 'done', completedAt: at(10, 14) }),
      mission({ id: 'm2', title: 'Revisar PR', areaId: 'a-tech' }),
      mission({ id: 'm3', title: 'Ler 20 min', status: 'done', completedAt: at(9, 21), recurrence: { kind: 'daily' } }),
      mission({ id: 'm3-n1', title: 'Ler 20 min', status: 'done', completedAt: at(10, 21), recurrence: { kind: 'daily' } }),
      mission({ id: 'm4', title: 'Lista de Cálculo' }),
      mission({ id: 'prova1', title: 'Prova 1', journeyId: 'calc', assessment: 'prova', date: '2026-11-12', deadline: '2026-11-12' }),
      mission({ id: 'trab2', title: 'Trabalho 2', journeyId: 'calc', assessment: 'trabalho', date: '2026-11-25', deadline: '2026-11-25' }),
    ],
    events: [
      event('completed', 'm1', '2026-11-10', '14:00'),
      event('result', 'm1', '2026-11-10', '14:01', { result: 'Pauta da semana pronta' }),
      event('snoozed', 'm2', '2026-11-09', '10:00', { reason: 'sem-energia' }),
      event('snoozed', 'm2', '2026-11-11', '10:00', { reason: 'sem-tempo' }),
      event('rescheduled', 'm2', '2026-11-12', '18:00', { from: '2026-11-12', to: '2026-11-13' }),
      event('partial', 'm4', '2026-11-11', '16:00', { result: 'Fiz 5 de 10' }),
      event('started', 'm2', '2026-11-13', '10:00'),
    ],
    focusSessions: [{ ...base, id: 'f1', startedAt: at(12, 10), endedAt: at(12, 11), activeMs: 50 * 60_000, mode: 'free', missionId: 'm2', outcome: 'finished' }],
    checkins: [
      checkin('2026-11-09', '09:55', { kind: 'start', feelings: ['ansiedade'], blocker: 'nao-sei-comecar', thought: 'Vai ficar ruim', missionId: 'm2', experimentMin: 10, outcome: 'continued' }),
      checkin('2026-11-10', '11:00', { kind: 'escape', escapedTo: 'youtube' }),
      checkin('2026-11-11', '09:50', { kind: 'start', feelings: ['ansiedade', 'tédio'], missionId: 'm2', experimentMin: 10, outcome: 'stopped' }),
    ],
    xpEvents: [xp('2026-11-09'), xp('2026-11-10'), xp('2026-11-11'), xp('2026-11-13'), xp('2026-11-13', { reason: 'resumption' })],
    reviews: Array.from({ length: 24 }, (_, i) => review(
      ['2026-11-09', '2026-11-10', '2026-11-13'][i % 3]!, i < 4 ? 1 : 3, { cardId: `c${(i % 12) + 1}`, durationMs: 30_000 }, i >= 20 ? 'new' : 'review',
    )),
    practice: [
      practice({
        id: 'p1', title: 'Join de tabelas', createdAt: at(11, 21), endedAt: at(11, 22, 30),
        ratings: { delivered: 2, understood: 1, autonomous: 1 }, explanation: 'Entendi joins, mas travei\npara escrever sem olhar.',
        feedback: [{ id: 'fb1', at: at(11, 21, 30), source: 'ai', text: 'Pista', hint: { step: 'code', level: 1 } }],
        rebuild: { code: 'select 1', startedAt: at(11, 22), comparedAt: at(11, 22, 20) },
      }),
      practice({ id: 'p2', title: 'Agregações', createdAt: at(13, 20), endedAt: at(13, 21), ratings: { delivered: 1 } }),
    ],
    journeys: [
      journey({ id: 'calc', title: 'Matemática Discreta', subject: true, createdAt: at(2, 9) }),
      journey({ id: 'alg', title: 'Banco de Dados', subject: true, order: 1, createdAt: new Date(2026, 9, 1, 9).getTime() }),
    ],
    commitments: [{ ...base, id: 'aula-calc', title: 'Matemática Discreta', date: '2026-11-03', start: '19:30', end: '22:30', weekdays: [2], remind: false }],
    problemSets: [{ ...base, id: 'ps1', journeyId: 'calc', day: '2026-11-11', title: 'Lista 3', done: 8, total: 10, unaided: 5 }],
    subjectTopics: [
      { ...base, id: 't1', journeyId: 'calc', name: 'Limites', marks: [{ at: at(9, 20), level: 'entendi' }] },
      { ...base, id: 't2', journeyId: 'calc', name: 'Derivadas', marks: [{ at: at(10, 20), level: 'vi' }] },
    ],
    weeks: [{
      ...base, id: '2026-11-09', objectives: [], experiment: 'Celular em outro cômodo no bloco Tech',
      review: { worked: 'Blocos curtos', obstacle: '', adjustment: 'Dormir antes', answeredAt: at(9, 9) },
    }],
    monthReviews: [{
      ...base, id: 'month-2026-10', month: '2026-10', answeredAt: at(9, 11), observed: NO_OBSERVED,
      answers: { progress: 'Terminei o módulo de SQL', obstacle: 'Cansaço à noite', next: '' },
    }],
    sleepLogs: [
      { ...night('2026-11-08', '23:30', 450), quality: 4 },
      { ...night('2026-11-09', '00:10', 400), quality: 3 },
      { ...night('2026-11-10', '23:50', 430), quality: 2 },
      night('2026-11-11', '01:00', 360),
      night('2026-11-12', '23:40'),
      night('2026-11-13', '23:20', 480),
    ],
    workouts: [
      workout('2026-11-09', 'musculacao', 60),
      workout('2026-11-10', 'musculacao', 70),
      workout('2026-11-11', 'cardio', 20, { minimum: true }),
    ],
    trainingLogs,
    diaryEntries: [
      diary('d1', { day: '2026-11-10', at: at(10, 21, 5), kind: 'fechamento', text: 'Dia corrido, mas a aula rendeu.', themes: ['faculdade'] }),
      diary('d2', { day: '2026-11-11', at: at(11, 22, 40), text: 'Travei no join.\nAmanhã tento de novo.', themes: ['estudo'], links: [{ kind: 'mission', id: 'm4' }] }),
      diary('d3', { day: '2026-11-12', at: at(12, 23), text: 'Coisa minha.', themes: ['sentimentos'], private: true }),
      diary('d4', { day: '2026-11-14', at: at(14, 10), text: 'Dormi mal.', themes: ['sono'] }),
    ],
    linkNames: { 'mission:m4': 'Lista de Cálculo' },
    ...p,
  });
}
