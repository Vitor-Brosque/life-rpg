import type {
  AssessmentKind, Commitment, DayKey, Deck, ID, Journey, Mission, Note, NoteType, Profile, Settings, StudyDoc, StudyFile,
  SubjectNotebook, SubjectTopic,
} from './types';
import { ASSIST_LIMITS, nameKey, weekdaysText } from './assist';
import { dayKeyOf } from './dates';
import { assessmentDay } from './engine';
import { TOPIC_LEVEL_LABEL, classOf, subjectJourneys, topicLevelOf } from './faculty';
import { NOTEBOOK_LIMITS, NOTEBOOK_SECTIONS, cutText, type NotebookSection } from './notebook';

// Caderno da disciplina (2026-11-26 §4): what `ler_disciplina` and `ler_apostila` give an assistant, and what the
// "Copiar pedido de estudo" of a subject carries. Pure: the server and the app pass the tables they read. Only the
// subject's study is read (its notebook, apostilas, PDFs, topics, avaliações and the notes of decks linked to it) and
// the study profile. Never the diary, sleep, nutrition, check-ins, energy, strategies, decks outside the subjects or
// PDFs without a subject.

/** The tables `buildSubjectContext` reads (settings only for the logical day of a change). */
export const SUBJECT_CONTEXT_TABLES = [
  'profile', 'settings', 'journeys', 'commitments', 'missions', 'subjectTopics', 'subjectNotebooks', 'studyDocs', 'decks',
  'notes', 'studyFiles',
] as const;
/** The tables `buildStudyDocView` reads. */
export const STUDY_DOC_TABLES = ['journeys', 'studyDocs'] as const;

export type SubjectTables = {
  profile?: Profile[]; settings?: Settings[]; journeys?: Journey[]; commitments?: Commitment[]; missions?: Mission[];
  subjectTopics?: SubjectTopic[]; subjectNotebooks?: SubjectNotebook[]; studyDocs?: StudyDoc[]; decks?: Deck[]; notes?: Note[];
  studyFiles?: StudyFile[];
};

const live = <T extends { deleted: boolean }>(xs: readonly T[] | undefined): T[] => (xs ?? []).filter((x) => !x.deleted);

/** The active subject with this name (accents, case and extra spaces ignored), as the study items find it. */
export function findSubjectByName(journeys: readonly Journey[], name: string): Journey | undefined {
  const key = nameKey(name);
  return key === '' ? undefined : subjectJourneys(journeys).find((j) => nameKey(j.title) === key);
}

export interface SubjectContext {
  subject: string;
  class?: string;
  studyProfile: string;
  notebook: Record<NotebookSection, string> & {
    bibliography: { title: string; authors?: string; kind: string; url?: string; note?: string }[];
  };
  topics: { name: string; level: string }[];
  assessments: { kind: AssessmentKind; date: DayKey; content?: string; done: boolean; past: boolean }[];
  docs: { id: ID; title: string; chars: number; updated: DayKey }[];
  /** PDFs da aula (2026-11-26 §3.1): the subject's PDFs, without their text (ler_material reads it). */
  files: { id: ID; title: string; pages: number; hasText: boolean; textChars: number }[];
  cards: { total: number; items: { type: NoteType; front: string; back: string }[] };
  otherSubjects: string[];
}

export type SubjectContextResult =
  | { ok: true; context: SubjectContext }
  | { ok: false; message: string; subjects: string[] };

/**
 * `ler_disciplina`: the notebook, the study profile, the topics with their current level, the avaliações by date, the
 * apostilas and the PDFs (without their text) and up to 150 notes of the decks linked to the subject (newest first, drafts and
 * deleted ones left out), each side cut to 240 characters. A name that is not a subject gets the list of subjects.
 */
export function buildSubjectContext(t: SubjectTables, subjectName: string, today: DayKey): SubjectContextResult {
  const journeys = live(t.journeys);
  const subjects = subjectJourneys(journeys);
  const j = findSubjectByName(journeys, subjectName);
  if (!j) {
    const titles = subjects.map((s) => s.title);
    const name = cutText(subjectName.trim(), 80);
    // A missing or blank name (the input is not checked against the schema) asks for one instead of quoting "".
    if (name === '') {
      return {
        ok: false, subjects: titles,
        message: titles.length > 0 ? `Informe o nome de uma disciplina: ${titles.join(', ')}.` : 'Informe o nome de uma disciplina. O app ainda não tem disciplinas.',
      };
    }
    return {
      ok: false, subjects: titles,
      message: titles.length > 0
        ? `Disciplina "${name}" não existe. As disciplinas do app são: ${titles.join(', ')}.`
        : `Disciplina "${name}" não existe. O app ainda não tem disciplinas.`,
    };
  }
  const startHour = live(t.settings)[0]?.dayStartHour ?? 4;
  const profile = live(t.profile).find((p) => p.id === 'me') ?? live(t.profile)[0];
  const nb = live(t.subjectNotebooks).find((n) => n.journeyId === j.id);
  const cls = classOf(j.title, live(t.commitments), today);

  const sections = Object.fromEntries(NOTEBOOK_SECTIONS.map((s) => [s, nb?.[s] ?? ''])) as Record<NotebookSection, string>;
  const bibliography = (nb?.bibliography ?? []).map((b) => ({
    title: b.title, ...(b.authors ? { authors: b.authors } : {}), kind: b.kind, ...(b.url ? { url: b.url } : {}), ...(b.note ? { note: b.note } : {}),
  }));

  const topics = live(t.subjectTopics).filter((x) => x.journeyId === j.id)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map((x) => ({ name: x.name, level: TOPIC_LEVEL_LABEL[topicLevelOf(x)] }));

  const assessments = live(t.missions)
    .filter((m) => m.journeyId === j.id && m.assessment !== undefined && m.status !== 'dropped')
    .flatMap((m) => { const date = assessmentDay(m); return date ? [{ m, date }] : []; })
    .sort((a, b) => a.date.localeCompare(b.date) || a.m.createdAt - b.m.createdAt)
    .map(({ m, date }) => {
      const content = m.notes?.trim();
      return {
        kind: m.assessment!, date, ...(content ? { content: cutText(content, ASSIST_LIMITS.assessmentContent) } : {}),
        done: m.status === 'done', past: date < today,
      };
    });

  const docs = live(t.studyDocs).filter((d) => d.journeyId === j.id)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((d) => ({ id: d.id, title: d.title, chars: d.markdown.length, updated: dayKeyOf(d.updatedAt, startHour) }));

  // Only the PDFs linked to this subject: a "Sem disciplina" PDF has no journeyId and never shows up.
  const files = live(t.studyFiles).filter((f) => f.journeyId === j.id)
    .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR') || a.createdAt - b.createdAt)
    .map((f) => ({ id: f.id, title: f.title, pages: f.pages, hasText: f.hasText, textChars: f.hasText ? f.textChars ?? 0 : 0 }));

  // Only decks linked to this subject; a note's deck decides (inbox drafts have none and are drafts anyway).
  const deckIds = new Set(live(t.decks).filter((d) => d.journeyId === j.id).map((d) => d.id));
  const notes = live(t.notes).filter((n) => !n.draft && n.deckId !== undefined && deckIds.has(n.deckId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const side = (s: string) => cutText(s, NOTEBOOK_LIMITS.cardSide);

  return {
    ok: true,
    context: {
      subject: j.title,
      ...(cls ? { class: `${weekdaysText(cls.weekdays!)} ${cls.start}–${cls.end}` } : {}),
      studyProfile: profile?.studyProfile ?? '',
      notebook: { ...sections, bibliography },
      topics,
      assessments,
      docs,
      files,
      cards: {
        total: notes.length,
        items: notes.slice(0, NOTEBOOK_LIMITS.cards).map((n) => ({ type: n.type, front: side(n.front), back: side(n.back) })),
      },
      otherSubjects: subjects.filter((s) => s.id !== j.id).map((s) => s.title),
    },
  };
}

export interface StudyDocView { id: ID; title: string; subject: string; markdown: string }
export type StudyDocResult = { ok: true; doc: StudyDocView } | { ok: false; message: string };

/** `ler_apostila`: the title, the subject and the whole Markdown of a live apostila of a subject. */
export function buildStudyDocView(t: Pick<SubjectTables, 'journeys' | 'studyDocs'>, id: string): StudyDocResult {
  const doc = live(t.studyDocs).find((d) => d.id === id);
  const subject = doc ? live(t.journeys).find((j) => j.id === doc.journeyId && j.subject === true) : undefined;
  if (!doc || !subject) {
    return { ok: false, message: `Apostila "${cutText(id.trim(), 64)}" não existe. Use o id que ler_disciplina mostra em docs.` };
  }
  return { ok: true, doc: { id: doc.id, title: doc.title, subject: subject.title, markdown: doc.markdown } };
}
