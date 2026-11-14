import type {
  Area, AssessmentKind, DayKey, ID, Journey, Mission, ProblemSet, SubjectTemplate, SubjectTopic, TopicLevel,
} from '@life/shared';
import {
  PROBLEM_ISSUE_TEXT, SUBJECT_TITLE_MAX, TOPIC_NAME_MAX, assessmentTitle, classOf, dayKeyToDate, facultyAreaOf,
  journeyByTitle, problemSetIssue, withTopicLevel,
} from '@life/shared';
import { db } from '../db/db';
import { mutate, newRecord, patch, put } from '../db/repo';
import { getToday, upsertDayState, withLock } from './common';
import { createCommitment, createMission } from './missionActions';
import { FACUL_AREA } from './routineDefaults';

/** A faculty input the user can fix: the message is shown as is. */
export class FacultyValidationError extends Error {}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isDay(day: string): boolean {
  if (!DAY.test(day)) return false;
  const d = dayKeyToDate(day);
  return d.getFullYear() === Number(day.slice(0, 4)) && d.getMonth() + 1 === Number(day.slice(5, 7)) && d.getDate() === Number(day.slice(8));
}

function checkTemplate(t: SubjectTemplate): SubjectTemplate {
  const title = t.title.trim();
  if (title === '' || title.length > SUBJECT_TITLE_MAX) throw new FacultyValidationError('Dê um nome à disciplina.');
  if (t.weekdays.length > 0 && (!HHMM.test(t.start) || !HHMM.test(t.end) || t.end <= t.start)) {
    throw new FacultyValidationError('O fim da aula precisa ser depois do início.');
  }
  return { ...t, title };
}

/** The shared body of "Confirmar" and "Nova disciplina": reuse what exists, create what is missing. */
async function applySetup(items: readonly SubjectTemplate[]): Promise<{ journeys: number; classes: number; last?: Journey }> {
  const templates = items.map(checkTemplate);
  const today = await getToday();
  const [areasAll, journeysAll, commitmentsAll] = await Promise.all([
    db.areas.toArray(), db.journeys.toArray(), db.commitments.toArray(),
  ]);
  const areas = areasAll.filter((a) => !a.deleted);
  const journeys = journeysAll.filter((j) => !j.deleted);
  const commitments = commitmentsAll.filter((c) => !c.deleted);

  let area = facultyAreaOf(areas);
  if (!area) {
    const order = areas.reduce((mx, a) => Math.max(mx, a.order + 1), 0);
    area = await put('areas', newRecord<Area>({ ...FACUL_AREA, order, archived: false }));
  }
  let order = journeys.reduce((mx, j) => Math.max(mx, j.order + 1), 0);
  let createdJourneys = 0;
  let createdClasses = 0;
  let last: Journey | undefined;
  for (const t of templates) {
    let journey = journeyByTitle(journeys, t.title);
    if (journey) {
      const changes: Partial<Journey> = {
        ...(journey.subject === true ? {} : { subject: true }),
        ...(journey.areaId === undefined ? { areaId: area.id } : {}),
      };
      if (Object.keys(changes).length > 0) {
        const id = journey.id;
        journey = await patch<Journey>('journeys', id, changes);
        journeys[journeys.findIndex((j) => j.id === id)] = journey;
      }
    } else {
      journey = await put('journeys', newRecord<Journey>({
        title: t.title, status: 'active', order: order++, areaId: area.id, subject: true,
      }));
      journeys.push(journey);
      createdJourneys += 1;
    }
    last = journey;
    if (t.weekdays.length > 0 && !classOf(t.title, commitments, today)) {
      commitments.push(await createCommitment({
        title: t.title, date: today, start: t.start, end: t.end, weekdays: [...t.weekdays],
      }));
      createdClasses += 1;
    }
  }
  return { journeys: createdJourneys, classes: createdClasses, ...(last ? { last } : {}) };
}

/** "Confirmar" of the semester grade: nothing is duplicated; the generic "Aula" commitment is never touched. */
export const setupSemester = (items: SubjectTemplate[]): Promise<{ journeys: number; classes: number }> =>
  withLock('faculty', async () => {
    const { journeys, classes } = await applySetup(items);
    return { journeys, classes };
  });

/** "Nova disciplina": one item of the grade. */
export const createSubject = (t: SubjectTemplate): Promise<Journey> =>
  withLock('faculty', async () => (await applySetup([t])).last!);

export async function createAssessment(
  input: { kind: AssessmentKind; journeyId: ID; date: DayKey; content?: string },
): Promise<Mission> {
  const journey = await db.journeys.get(input.journeyId);
  if (!journey || journey.deleted || journey.status !== 'active' || journey.subject !== true) {
    throw new FacultyValidationError('Escolha a disciplina.');
  }
  if (!isDay(input.date)) throw new FacultyValidationError('Escolha a data.');
  const content = input.content?.trim();
  return createMission({
    title: assessmentTitle(input.kind, '', journey.title),
    journeyId: journey.id,
    ...(journey.areaId ? { areaId: journey.areaId } : {}),
    date: input.date,
    deadline: input.date,
    assessment: input.kind,
    ...(content ? { notes: content } : {}),
  });
}

export interface ProblemSetFields {
  id?: ID; journeyId: ID; day: DayKey; title: string; done: number; total?: number; unaided?: number;
}

export async function saveProblemSet(fields: ProblemSetFields): Promise<ProblemSet> {
  const issue = problemSetIssue(fields);
  if (issue) throw new FacultyValidationError(PROBLEM_ISSUE_TEXT[issue]);
  const body = {
    journeyId: fields.journeyId, day: fields.day, title: fields.title.trim(), done: fields.done,
    total: fields.total, unaided: fields.unaided,
  };
  const prev = fields.id ? await db.problemSets.get(fields.id) : undefined;
  if (prev && !prev.deleted) return patch<ProblemSet>('problemSets', prev.id, body);
  const { total, unaided, ...rest } = body;
  return put('problemSets', newRecord<ProblemSet>({
    ...rest, ...(total !== undefined ? { total } : {}), ...(unaided !== undefined ? { unaided } : {}),
  }));
}

export async function deleteProblemSet(id: ID): Promise<ProblemSet | undefined> {
  const prev = await db.problemSets.get(id);
  if (!prev || prev.deleted) return undefined;
  return patch<ProblemSet>('problemSets', id, { deleted: true });
}

export async function restoreProblemSet(id: ID): Promise<void> {
  await patch<ProblemSet>('problemSets', id, { deleted: false });
}

export async function addTopic(journeyId: ID, name: string): Promise<SubjectTopic> {
  const n = name.replace(/\s+/g, ' ').trim();
  if (n === '' || n.length > TOPIC_NAME_MAX) throw new FacultyValidationError('Dê um nome ao assunto.');
  return put('subjectTopics', newRecord<SubjectTopic>({ journeyId, name: n, marks: [] }));
}

/** Appends a mark (never rewrites the history); the same level again writes nothing. */
export async function setTopicLevel(topicId: ID, level: TopicLevel): Promise<void> {
  const at = Date.now();
  await mutate<SubjectTopic>('subjectTopics', topicId, (t) => withTopicLevel(t, level, at));
}

export async function deleteTopic(id: ID): Promise<void> {
  await patch<SubjectTopic>('subjectTopics', id, { deleted: true });
}

/** "Usar" / "Escolher outra" of the Faculdade block suggestion: the day's choice for a block. */
export async function pickSubject(blockId: ID, journeyId: ID | null): Promise<void> {
  const today = await getToday();
  const prev = await db.dayState.get(today);
  const picks = { ...(prev && !prev.deleted ? prev.subjectPicks ?? {} : {}) };
  if (journeyId === null) delete picks[blockId];
  else picks[blockId] = journeyId;
  await upsertDayState(today, { subjectPicks: picks });
}
