import type {
  Area, AssessmentKind, Block, Card, Commitment, DayKey, Deck, FocusSession, HHmm, ID, Journey, Mission, PracticeSession,
  ProblemSet, Review, SubjectTopic, TopicLevel,
} from './types';
import { addDays, dayKeyOf, diffDays, weekdayOf } from './dates';
import { assessmentDay, occurrencesOn } from './engine';
import { compactTitle, normalize } from './parser';
import { WEEKDAY_NAMES } from './periods';

// Faculdade como disciplinas (Acompanhamento E): a subject is an active journey flagged `subject`;
// its class is the weekly commitment with the same (compacted) title; provas and trabalhos are its
// missions with `assessment`. Everything observed; the Faculdade block suggestion needs "Usar".

/** The evening class window of the examples (the suggested routine and the example grade); any class can use other times. */
export const CLASS_START: HHmm = '19:30';
export const CLASS_END: HHmm = '22:30';
export const FACULTY_AREA_ID = 'area-facul';
export const SUBJECT_TITLE_MAX = 60;
export const PROBLEM_TITLE_MAX = 60;
export const PROBLEM_MAX = 999;
export const TOPIC_NAME_MAX = 80;
/** "Sem contato há N dias de estudo" appears from this many study days. */
export const NO_CONTACT_MIN = 5;
/** An avaliação this close raises its subject in the Faculdade block. */
export const ASSESSMENT_WINDOW_DAYS = 14;
/** Look-back of the contact search (bounds the loops). */
export const CONTACT_LOOKBACK_DAYS = 180;

export interface SubjectTemplate { title: string; weekdays: number[]; start: HHmm; end: HHmm }

/** An example grade (invented subjects and days; no professors, no exam dates), editable before it is created. */
export const SEMESTER_GRADE: readonly SubjectTemplate[] = [
  { title: 'Estruturas de Dados', weekdays: [1], start: CLASS_START, end: CLASS_END },
  { title: 'Matemática Discreta', weekdays: [2], start: CLASS_START, end: CLASS_END },
  { title: 'Banco de Dados', weekdays: [3], start: CLASS_START, end: CLASS_END },
  { title: 'Redes de Computadores', weekdays: [4], start: CLASS_START, end: CLASS_END },
  { title: 'Engenharia de Software', weekdays: [5], start: CLASS_START, end: CLASS_END },
];

export const ASSESSMENT_LABEL: Record<AssessmentKind, string> = { prova: 'Prova', trabalho: 'Trabalho' };
export const TOPIC_LEVELS: readonly TopicLevel[] = ['nenhum', 'vi', 'entendi', 'resolvo'];
export const TOPIC_LEVEL_LABEL: Record<TopicLevel, string> = {
  nenhum: 'Ainda não', vi: 'Vi na aula', entendi: 'Entendi', resolvo: 'Resolvo sem ajuda',
};

/** The Faculdade area: id 'area-facul', else the live area named "Faculdade" (case/accent-insensitive). */
export function facultyAreaOf(areas: readonly Area[]): Area | undefined {
  const live = areas.filter((a) => !a.deleted);
  return live.find((a) => a.id === FACULTY_AREA_ID) ?? live.find((a) => normalize(a.name.trim()) === 'faculdade');
}

/** Active subject journeys, in journey order. */
export function subjectJourneys(journeys: readonly Journey[]): Journey[] {
  return journeys.filter((j) => !j.deleted && j.status === 'active' && j.subject === true).sort((a, b) => a.order - b.order);
}

/** A live, active journey whose compacted title equals `title`'s, else starts with it; the most recently updated wins. */
export function journeyByTitle(journeys: readonly Journey[], title: string): Journey | undefined {
  const key = compactTitle(title);
  if (!key) return undefined;
  const pool = journeys.filter((j) => !j.deleted && j.status === 'active').map((j) => ({ j, t: compactTitle(j.title) }));
  const newest = (xs: typeof pool): Journey | undefined => [...xs].sort((a, b) => b.j.updatedAt - a.j.updatedAt)[0]?.j;
  return newest(pool.filter((x) => x.t === key)) ?? newest(pool.filter((x) => x.t.startsWith(key)));
}

/**
 * A subject's class: the live weekly commitment (not expired on `today`) whose compacted title equals the
 * subject's, else starts with it; the most recently updated wins.
 */
export function classOf(title: string, commitments: readonly Commitment[], today: DayKey): Commitment | undefined {
  const key = compactTitle(title);
  if (!key) return undefined;
  const pool = commitments
    .filter((c) => !c.deleted && (c.weekdays?.length ?? 0) > 0 && (c.untilDate === undefined || c.untilDate >= today))
    .map((c) => ({ c, t: compactTitle(c.title) }));
  const newest = (xs: typeof pool): Commitment | undefined => [...xs].sort((a, b) => b.c.updatedAt - a.c.updatedAt)[0]?.c;
  return newest(pool.filter((x) => x.t === key)) ?? newest(pool.filter((x) => x.t.startsWith(key)));
}

export interface SetupItem { template: SubjectTemplate; journeyId?: ID; classId?: ID }

/** What "Confirmar" will do per subject: reuse a matching journey and class, or create them. */
export function semesterSetup(
  templates: readonly SubjectTemplate[], journeys: readonly Journey[], commitments: readonly Commitment[], today: DayKey,
): SetupItem[] {
  return templates.map((template) => {
    const j = journeyByTitle(journeys, template.title);
    const c = classOf(template.title, commitments, today);
    return { template, ...(j ? { journeyId: j.id } : {}), ...(c ? { classId: c.id } : {}) };
  });
}

/** A weekly class titled "Aula" (the routine's generic one) that the grade would double. */
export function genericClass(commitments: readonly Commitment[], today: DayKey): Commitment | undefined {
  return commitments.find((c) => !c.deleted && (c.weekdays?.length ?? 0) > 0
    && (c.untilDate === undefined || c.untilDate >= today) && compactTitle(c.title) === 'aula');
}

// ------------------------------------------------------------------ avaliações

/** 'prova' / 'trabalho' when a captured title starts with that word (any case or accent). */
export function assessmentKindOf(title: string): AssessmentKind | undefined {
  const first = normalize(title.trim()).split(/\s+/)[0];
  return first === 'prova' || first === 'trabalho' ? first : undefined;
}

/** "Prova de Cálculo II" when the title is only the word; otherwise the typed title, capitalised. */
export function assessmentTitle(kind: AssessmentKind, typed: string, subjectTitle: string): string {
  const t = typed.trim();
  if (normalize(t) === kind || t === '') return `${ASSESSMENT_LABEL[kind]} de ${subjectTitle}`;
  return t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1);
}

export interface NextAssessment { missionId: ID; kind: AssessmentKind; title: string; day: DayKey; inDays: number }

/** The subject's nearest open avaliação from today on (its day is `assessmentDay`: the deadline). */
export function nextAssessment(missions: readonly Mission[], journeyId: ID, today: DayKey): NextAssessment | undefined {
  const m = missions
    .filter((x) => !x.deleted && x.journeyId === journeyId && x.assessment && (x.status === 'open' || x.status === 'doing'))
    .map((x) => ({ x, day: assessmentDay(x) }))
    .filter((e): e is { x: Mission; day: DayKey } => e.day !== undefined && e.day >= today)
    .sort((a, b) => a.day.localeCompare(b.day) || a.x.createdAt - b.x.createdAt)[0];
  return m ? { missionId: m.x.id, kind: m.x.assessment!, title: m.x.title, day: m.day, inDays: diffDays(today, m.day) } : undefined;
}

/** "Prova hoje" · "Prova amanhã" · "Trabalho em 5 dias". */
export function assessmentWhen(kind: AssessmentKind, inDays: number): string {
  const label = ASSESSMENT_LABEL[kind];
  return inDays === 0 ? `${label} hoje` : inDays === 1 ? `${label} amanhã` : `${label} em ${inDays} dias`;
}

// ------------------------------------------------------------------ contact

/** Everything that counts as contact with a subject (soft-deleted rows are ignored here). */
export interface ContactData {
  dayStartHour: number;
  decks: readonly Deck[];
  cards: readonly Card[];
  reviews: readonly Review[];
  practice: readonly PracticeSession[];
  missions: readonly Mission[];
  focus: readonly FocusSession[];
  problemSets: readonly ProblemSet[];
  topics: readonly SubjectTopic[];
}

/**
 * Last day with contact: a review in its decks, a practice session (created or ended), a mission of it
 * concluded, a focus session on one of its missions, an exercise log, or a topic level change.
 */
export function lastContactDay(journeyId: ID, data: ContactData): DayKey | undefined {
  const day = (ts: number): DayKey => dayKeyOf(ts, data.dayStartHour);
  const decks = new Set(data.decks.filter((d) => !d.deleted && d.journeyId === journeyId).map((d) => d.id));
  const deckOfCard = new Map(data.cards.map((c) => [c.id, c.deckId]));
  const missionIds = new Set(data.missions.filter((m) => !m.deleted && m.journeyId === journeyId).map((m) => m.id));
  const days: DayKey[] = [];
  for (const r of data.reviews) {
    const deckId = r.deckId ?? deckOfCard.get(r.cardId);
    if (!r.deleted && deckId !== undefined && decks.has(deckId)) days.push(r.day);
  }
  for (const p of data.practice) {
    if (p.deleted || p.journeyId !== journeyId) continue;
    days.push(day(p.createdAt));
    if (p.endedAt !== undefined) days.push(day(p.endedAt));
  }
  for (const m of data.missions) {
    if (!m.deleted && m.journeyId === journeyId && m.status === 'done' && m.completedAt !== undefined) days.push(day(m.completedAt));
  }
  for (const f of data.focus) if (!f.deleted && f.missionId !== undefined && missionIds.has(f.missionId)) days.push(day(f.startedAt));
  for (const s of data.problemSets) if (!s.deleted && s.journeyId === journeyId) days.push(s.day);
  for (const t of data.topics) {
    if (t.deleted || t.journeyId !== journeyId) continue;
    for (const mark of t.marks) days.push(day(mark.at));
  }
  return days.reduce<DayKey | undefined>((max, d) => (max === undefined || d > max ? d : max), undefined);
}

/** Study days (weekdays not in `restDays`) strictly after `from` and before `today`, at most CONTACT_LOOKBACK_DAYS back. */
export function studyDaysBetween(from: DayKey, today: DayKey, restDays: readonly number[]): number {
  const rest = new Set(restDays);
  let n = 0;
  const start = diffDays(from, today) > CONTACT_LOOKBACK_DAYS ? addDays(today, -CONTACT_LOOKBACK_DAYS) : from;
  for (let d = addDays(start, 1); d < today; d = addDays(d, 1)) if (!rest.has(weekdayOf(d))) n += 1;
  return n;
}

/** Study days without contact: since the last contact, or since the subject was created when it never had one. */
export function daysWithoutContact(
  journey: Pick<Journey, 'id' | 'createdAt'>, data: ContactData, today: DayKey, restDays: readonly number[],
): number {
  const since = lastContactDay(journey.id, data) ?? dayKeyOf(journey.createdAt, data.dayStartHour);
  return since >= today ? 0 : studyDaysBetween(since, today, restDays);
}

/** The subject's next mission: its open journey head (lowest order, then oldest), never an avaliação. */
export function subjectHead(missions: readonly Mission[], journeyId: ID): Mission | undefined {
  return missions
    .filter((m) => !m.deleted && m.journeyId === journeyId && !m.assessment && (m.status === 'open' || m.status === 'doing'))
    .sort((a, b) => (a.journeyOrder ?? Infinity) - (b.journeyOrder ?? Infinity) || a.createdAt - b.createdAt)[0];
}

// ------------------------------------------------------------------ the Faculdade block

/** A block of the Faculdade area: its own area, or the area of the journey it is linked to. */
export function isFacultyBlock(block: Pick<Block, 'areaId' | 'journeyId'>, facultyAreaId: ID | undefined, journeys: readonly Journey[]): boolean {
  if (!facultyAreaId) return false;
  if (block.areaId === facultyAreaId) return true;
  return block.journeyId !== undefined && journeys.some((j) => j.id === block.journeyId && j.areaId === facultyAreaId);
}

export type SuggestionReason =
  | { code: 'assessment'; kind: AssessmentKind; inDays: number }
  | { code: 'no-contact'; days: number }
  | { code: 'class-today'; start: HHmm }
  | { code: 'class-before'; day: DayKey };

export interface SubjectSuggestion { journey: Journey; reason: SuggestionReason; text: string }

export function suggestionText(r: SuggestionReason, today: DayKey): string {
  switch (r.code) {
    case 'assessment': return assessmentWhen(r.kind, r.inDays);
    case 'no-contact': return `Sem contato há ${r.days} dias de estudo`;
    case 'class-today': return r.start >= '18:00' ? 'Aula hoje à noite' : `Aula hoje às ${r.start}`;
    case 'class-before': return r.day === addDays(today, -1) ? 'Revisar a aula de ontem' : `Revisar a aula de ${WEEKDAY_NAMES[weekdayOf(r.day)]}`;
  }
}

export interface SuggestionInput {
  today: DayKey;
  journeys: readonly Journey[];
  missions: readonly Mission[];
  commitments: readonly Commitment[];
  contact: ContactData;
  restDays: readonly number[];
}

/**
 * Subjects for a Faculdade block, in priority order, each once with its first reason: (1) an avaliação
 * within 14 days, nearest first; (2) 5+ study days without contact, most first; (3) a class today;
 * (4) the class of the previous class day. Weekends: none (free days). "Trocar" walks this list.
 */
export function subjectSuggestions(input: SuggestionInput): SubjectSuggestion[] {
  const { today } = input;
  const wd = weekdayOf(today);
  if (wd === 0 || wd === 6) return [];
  const subjects = subjectJourneys(input.journeys);
  const out: SubjectSuggestion[] = [];
  const used = new Set<ID>();
  const push = (journey: Journey, reason: SuggestionReason): void => {
    if (used.has(journey.id)) return;
    used.add(journey.id);
    out.push({ journey, reason, text: suggestionText(reason, today) });
  };
  const byId = new Map(subjects.map((j) => [j.id, j]));

  const soon = input.missions
    .filter((m) => !m.deleted && m.assessment && m.journeyId !== undefined && byId.has(m.journeyId)
      && (m.status === 'open' || m.status === 'doing'))
    .map((m) => ({ m, day: assessmentDay(m) }))
    .filter((e): e is { m: Mission; day: DayKey } => e.day !== undefined && e.day >= today && diffDays(today, e.day) <= ASSESSMENT_WINDOW_DAYS)
    .sort((a, b) => a.day.localeCompare(b.day) || a.m.createdAt - b.m.createdAt);
  for (const { m, day } of soon) push(byId.get(m.journeyId!)!, { code: 'assessment', kind: m.assessment!, inDays: diffDays(today, day) });

  subjects
    .map((j) => ({ j, days: daysWithoutContact(j, input.contact, today, input.restDays) }))
    .filter((x) => x.days >= NO_CONTACT_MIN)
    .sort((a, b) => b.days - a.days || a.j.order - b.j.order)
    .forEach((x) => push(x.j, { code: 'no-contact', days: x.days }));

  const classes = subjects.flatMap((j) => {
    const c = classOf(j.title, input.commitments, today);
    return c ? [{ j, c }] : [];
  });
  for (const { j, c } of classes) {
    const occ = occurrencesOn([c], today, input.contact.dayStartHour)[0];
    if (occ) push(j, { code: 'class-today', start: c.start });
  }
  for (let i = 1; i <= 7; i++) {
    const day = addDays(today, -i);
    const that = classes.filter(({ c }) => occurrencesOn([c], day, input.contact.dayStartHour).length > 0);
    if (that.length === 0) continue;
    for (const { j } of that) push(j, { code: 'class-before', day });
    break;
  }
  return out;
}

// ------------------------------------------------------------------ exercícios e assuntos

export type ProblemIssue = 'title' | 'done' | 'total' | 'unaided';
export const PROBLEM_ISSUE_TEXT: Record<ProblemIssue, string> = {
  title: 'Dê um nome curto, como “Lista 4”.',
  done: 'Feitos: um número inteiro de 0 a 999.',
  total: 'Total: um número inteiro, maior ou igual aos feitos.',
  unaided: 'Sem ajuda: um número inteiro, até o número de feitos.',
};

const isCount = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= PROBLEM_MAX;

/** What is wrong with an exercise log, if anything. */
export function problemSetIssue(p: Pick<ProblemSet, 'title' | 'done' | 'total' | 'unaided'>): ProblemIssue | undefined {
  const title = p.title.trim();
  if (title === '' || title.length > PROBLEM_TITLE_MAX) return 'title';
  if (!isCount(p.done)) return 'done';
  if (p.total !== undefined && (!isCount(p.total) || p.total < p.done)) return 'total';
  if (p.unaided !== undefined && (!isCount(p.unaided) || p.unaided > p.done)) return 'unaided';
  return undefined;
}

/** "Lista 4 · 8 de 10 · 5 sem ajuda" · "Lista 4 · 8 feitos" · "Lista 4 · 1 feito". */
export function problemSetText(p: Pick<ProblemSet, 'title' | 'done' | 'total' | 'unaided'>): string {
  const count = p.total !== undefined ? `${p.done} de ${p.total}` : `${p.done} ${p.done === 1 ? 'feito' : 'feitos'}`;
  return `${p.title} · ${count}${p.unaided !== undefined ? ` · ${p.unaided} sem ajuda` : ''}`;
}

/** The topic's current level: its last mark ('nenhum' without one). */
export const topicLevelOf = (t: Pick<SubjectTopic, 'marks'>): TopicLevel => t.marks[t.marks.length - 1]?.level ?? 'nenhum';

/** A level change this close to the last mark replaces it (arrow keys in the radio group write one mark per step). */
export const TOPIC_MERGE_MS = 2 * 60_000;

/**
 * Marks with `level` appended; the same level again changes nothing. A change under TOPIC_MERGE_MS after the last
 * mark merges into it (its level and `at` are replaced), and drops it when that brings back the level before it.
 */
export function withTopicLevel(t: Pick<SubjectTopic, 'marks'>, level: TopicLevel, at: number): Pick<SubjectTopic, 'marks'> | undefined {
  if (topicLevelOf(t) === level) return undefined;
  const last = t.marks[t.marks.length - 1];
  if (last === undefined || at - last.at >= TOPIC_MERGE_MS) return { marks: [...t.marks, { at, level }] };
  const before = t.marks.slice(0, -1);
  return { marks: topicLevelOf({ marks: before }) === level ? before : [...before, { at, level }] };
}

/** Live topics of a subject grouped by current level (each group by name). */
export function topicsByLevel(topics: readonly SubjectTopic[], journeyId: ID): Record<TopicLevel, SubjectTopic[]> {
  const out: Record<TopicLevel, SubjectTopic[]> = { nenhum: [], vi: [], entendi: [], resolvo: [] };
  for (const t of topics) if (!t.deleted && t.journeyId === journeyId) out[topicLevelOf(t)].push(t);
  for (const level of TOPIC_LEVELS) out[level].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return out;
}

/** "2 resolvo sem ajuda · 3 entendi · 1 vi na aula · 1 ainda não" (only the levels with topics, highest first). */
export function topicsSummary(groups: Record<TopicLevel, readonly SubjectTopic[]>): string {
  return [...TOPIC_LEVELS].reverse().filter((l) => groups[l].length > 0)
    .map((l) => `${groups[l].length} ${TOPIC_LEVEL_LABEL[l].toLocaleLowerCase('pt-BR')}`).join(' · ');
}
