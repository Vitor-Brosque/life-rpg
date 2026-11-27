import type {
  Area, AssessmentKind, BaseRecord, BibItem, BibKind, Block, BlockKind, BlockSession, Commitment, DayKey, DayState, Energy,
  FocusSession, Goal, HHmm, ID, Journey, Mission, Profile, Review, Season, Settings, StudyDoc, SubjectNotebook, SubjectTopic,
  TrainingBlock, TrainingDay, TrainingPlan,
} from './types';
import { AI_LIMITS } from './ai';
import { addDays, dayKeyOf, isValidDayKey, parseHHmm, weekdayOf } from './dates';
import { assessmentDay } from './engine';
import { GOAL_TITLE_MAX } from './goals';
import { keyPoints } from './noteCards';
import {
  BIB_KINDS, BIB_KIND_LABEL, NOTEBOOK_LIMITS, NOTEBOOK_SECTIONS, NOTEBOOK_SECTION_TITLE, bibUrlIssue, charsText, excerpt,
  notebookFilled, type NotebookSection,
} from './notebook';
import { normalize } from './parser';
import { completedWeeks } from './periods';
import { SEASON_TITLE_MAX } from './seasons';
import { ASSESSMENT_LABEL, SUBJECT_TITLE_MAX, TOPIC_NAME_MAX } from './faculty';
import {
  BLOCK_ISSUE_TEXT, EXERCISES_MAX, PLAN_ISSUE_TEXT, TRAINING_NAME_MAX, blockIssue, blockWeekOf, cleanBlock, normalizePlanDays,
  planDaysOf, planIssues, plannedText, targetText,
} from './training';

// Assistentes pelo MCP (2026-11-25): the proposal an assistant (ChatGPT, Claude) sends, its validation, the items the
// person reviews, and the context the assistant reads. Pure functions: the server validates and builds the context,
// the app lists and applies the items. Field names follow the code (English); texts the person reads are pt-BR.

export const ASSIST_LIMITS = {
  // bodyBytes: 256 KB since the caderno (2026-11-26), so an apostila of 40 thousand characters fits with room to spare.
  items: 80, pendingMax: 3, proposalsPerDay: 10, callsPerHour: 60, bodyBytes: 256 * 1024,
  openMissionsInContext: 100, proposalsInContext: 5, historyWeeks: 4, dateAheadDays: 60,
  title: 80, summary: 600, why: 140, areaName: 30, attribute: 20, outcome: 160, goalWhy: 160, horizon: 40,
  focusText: 120, missionTitle: 120, firstStep: 120, blockName: 60, checklistItem: 60, checklistMax: 6,
  commitmentTitle: 60, areas: 8, renames: 8, goals: 5, journeys: 6, journeyMissions: 15, missions: 30, blocks: 20,
  commitments: 10, subjects: 10, trainingDays: 7,
  // Estudo pelos chats (2026-11-25): packages of what a subject chat taught, and what the context shows per subject.
  study: 5, studyTopics: 20, studyCards: 20, studyAssessments: 10, studyMissions: 10, assessmentAheadDays: 200,
  assessmentContent: 200, topicsInContext: 40,
} as const;

export const MISSION_DURATIONS = [5, 15, 30, 60, 90] as const;
export const BLOCK_KINDS: readonly BlockKind[] = ['focus', 'body', 'study', 'light', 'routine'];
export const BLOCK_KIND_TEXT: Record<BlockKind, string> = {
  focus: 'foco', body: 'corpo', study: 'estudo', light: 'leve', routine: 'rotina',
};
export const DAY_END_HOURS = [20, 21, 22, 23, 0] as const;

export interface ProposedArea { name: string; attribute: string; why?: string }
export interface AreaRename { from: string; to: string; why?: string }
export interface ProposedGoal { title: string; why?: string; horizon?: string }
export interface ProposedSeason { title: string; weeks: 6 | 7 | 8; focus: string[]; why?: string }
export interface ProposedMission {
  title: string; area?: string; durationMin?: 5 | 15 | 30 | 60 | 90; energy?: Energy; important?: boolean;
  date?: DayKey; firstStep?: string; why?: string;
}
export interface ProposedJourney { title: string; area?: string; outcome?: string; goal?: string; missions: ProposedMission[]; why?: string }
export interface ProposedBlock {
  name: string; weekdays: number[]; start: HHmm; durationMin: number; minimumMin: number; kind: BlockKind;
  protected?: boolean; area?: string; journey?: string; checklist?: string[]; why?: string;
}
export interface ProposedCommitment { title: string; weekdays: number[]; start: HHmm; end: HHmm; why?: string }
export interface ProposedSubject { title: string; weekday?: number; start?: HHmm; end?: HHmm; why?: string }
export interface ProposedTraining { days: TrainingDay[]; block?: TrainingBlock; why?: string }
export interface ProposedPreferences { dayStartHour?: number; dayEndHour?: number; why?: string }
/** `seen`: studied in the conversation, marks the level "Vi" (the chat never marks "Entendi" or "Resolvo"). */
export interface ProposedStudyTopic { name: string; seen?: boolean; why?: string }
/** basic: question and answer; topic: theme on the front, key points (one per line) on the back. */
export interface ProposedStudyCard { type: 'basic' | 'topic'; front: string; back: string; why?: string }
export interface ProposedStudyAssessment { kind: AssessmentKind; date: DayKey; content?: string; why?: string }
/** Caderno da disciplina (2026-11-26): each text section, when sent, replaces the current one; books merge by title. */
export interface ProposedNotebook {
  plan?: string; studied?: string; difficulties?: string; nextChat?: string; bibliography?: BibItem[];
}
/** An apostila: the same title in the subject replaces its text. */
export interface ProposedStudyDoc { title: string; markdown: string; why?: string }
/** What a subject chat taught, for one subject (by name: existing, or created in `subjects` of the same proposal). */
export interface ProposedStudy {
  subject: string; topics?: ProposedStudyTopic[]; cards?: ProposedStudyCard[]; assessments?: ProposedStudyAssessment[];
  missions?: ProposedMission[]; notebook?: ProposedNotebook; docs?: ProposedStudyDoc[];
}

export interface ProposalPayload {
  title: string;
  summary: string;
  areas?: ProposedArea[];
  renameAreas?: AreaRename[];
  goals?: ProposedGoal[];
  season?: ProposedSeason;
  journeys?: ProposedJourney[];
  missions?: ProposedMission[];
  routine?: { mode: 'add' | 'replace'; blocks: ProposedBlock[] };
  commitments?: ProposedCommitment[];
  training?: ProposedTraining;
  subjects?: ProposedSubject[];
  study?: ProposedStudy[];
  /** Replaces the study profile shared by every subject. */
  studyProfile?: { text: string; why?: string };
  preferences?: ProposedPreferences;
}

export type ProposalStatus = 'pending' | 'applied' | 'partial' | 'rejected' | 'replaced';
export type ItemResult = 'applied' | 'existed' | 'skipped' | 'unchecked';
export interface ItemOutcome { key: string; result: ItemResult; reason?: string }
/** A synced record (table `proposals`): written by the server, decided in the app. */
export interface Proposal extends BaseRecord {
  source: string;                 // the assistant's name
  clientId?: string;              // which connected assistant sent it (server bookkeeping for its daily limit)
  payload: ProposalPayload;
  status: ProposalStatus;
  decidedAt?: number;
  outcome?: ItemOutcome[];
}

// ------------------------------------------------------------------ small helpers

export const nameKey = (s: string): string => normalize(s.trim()).replace(/\s+/g, ' ');
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isHHmm = (s: unknown): s is HHmm => typeof s === 'string' && HHMM.test(s);
const WEEKDAY_ABBR = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

/** "seg a sex", "seg, qua e sex", "sáb e dom", "todos os dias". */
export function weekdaysText(days: readonly number[]): string {
  const set = new Set(days);
  const order = MON_FIRST.filter((d) => set.has(d));
  if (order.length === 7) return 'todos os dias';
  const runs: number[][] = [];
  for (const d of order) {
    const run = runs[runs.length - 1];
    if (run && MON_FIRST.indexOf(d) === MON_FIRST.indexOf(run[run.length - 1]!) + 1) run.push(d);
    else runs.push([d]);
  }
  const parts = runs.flatMap((r) => (r.length >= 3 ? [`${WEEKDAY_ABBR[r[0]!]} a ${WEEKDAY_ABBR[r[r.length - 1]!]}`] : r.map((d) => WEEKDAY_ABBR[d]!)));
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

const durationText = (min: number): string =>
  (min < 60 ? `${min} min` : min % 60 === 0 ? `${min / 60}h` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`);

const ddmm = (day: DayKey): string => `${WEEKDAY_ABBR[weekdayOf(day)]} ${day.slice(8, 10)}/${day.slice(5, 7)}`;
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ validation

export interface ProposalIssue { path: string; message: string }
/** Names that already exist in the app (live, unarchived), for references by name. */
export interface ProposalNames { areas: string[]; journeys: string[]; goals: string[]; subjects: string[] }

/**
 * Validates what an assistant sent. Returns the payload as stored (strings trimmed, empty optional fields gone) and
 * the problems (path + a sentence for the assistant). Nothing is fixed silently except whitespace and the plan's
 * normalisation (`normalizePlanDays`), which never changes a valid value.
 */
export function validateProposal(input: unknown, names: ProposalNames, today: DayKey): { payload?: ProposalPayload; issues: ProposalIssue[] } {
  const issues: ProposalIssue[] = [];
  const bad = (path: string, message: string) => { issues.push({ path, message }); };
  const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!obj(input)) return { issues: [{ path: '', message: 'A proposta precisa ser um objeto.' }] };

  const text = (v: unknown, path: string, max: number, required = true): string | undefined => {
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '' && !required)) {
      if (required) bad(path, 'Campo obrigatório.');
      return undefined;
    }
    if (typeof v !== 'string') { bad(path, 'Precisa ser texto.'); return undefined; }
    const t = v.trim();
    if (t === '') { bad(path, 'Não pode ficar vazio.'); return undefined; }
    if (t.length > max) { bad(path, `No máximo ${max} caracteres.`); return undefined; }
    return t;
  };
  const list = <T>(v: unknown, path: string, max: number, each: (x: unknown, p: string) => T | undefined): T[] | undefined => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v)) { bad(path, 'Precisa ser uma lista.'); return undefined; }
    if (v.length > max) { bad(path, `No máximo ${max} itens.`); return undefined; }
    return v.map((x, i) => each(x, `${path}.${i}`)).filter((x): x is T => x !== undefined);
  };
  const why = (o: Record<string, unknown>, path: string) => {
    const w = text(o.why, `${path}.why`, ASSIST_LIMITS.why, false);
    return w ? { why: w } : {};
  };
  const weekdays = (v: unknown, path: string): number[] | undefined => {
    if (!Array.isArray(v) || v.length === 0 || v.some((d) => !Number.isInteger(d) || d < 0 || d > 6) || new Set(v).size !== v.length) {
      bad(path, 'Dias da semana: lista de números de 0 (domingo) a 6 (sábado), sem repetir, com pelo menos um.');
      return undefined;
    }
    return [...v].sort((a, b) => MON_FIRST.indexOf(a) - MON_FIRST.indexOf(b));
  };

  const title = text(input.title, 'title', ASSIST_LIMITS.title);
  const summary = text(input.summary, 'summary', ASSIST_LIMITS.summary);

  // Names that can be cited: what exists, what this proposal creates, and renamed areas' new names.
  const areaNames = new Set(names.areas.map(nameKey));
  const journeyNames = new Set(names.journeys.map(nameKey));
  const goalNames = new Set(names.goals.map(nameKey));

  const out: ProposalPayload = { title: title ?? '', summary: summary ?? '' };

  const areas = list(input.areas, 'areas', ASSIST_LIMITS.areas, (x, p) => {
    if (!obj(x)) { bad(p, 'Precisa ser um objeto.'); return undefined; }
    const name = text(x.name, `${p}.name`, ASSIST_LIMITS.areaName);
    const attribute = text(x.attribute, `${p}.attribute`, ASSIST_LIMITS.attribute);
    if (!name || !attribute) return undefined;
    areaNames.add(nameKey(name));
    return { name, attribute, ...why(x, p) };
  });
  if (areas?.length) out.areas = areas;

  const renameAreas = list(input.renameAreas, 'renameAreas', ASSIST_LIMITS.renames, (x, p) => {
    if (!obj(x)) { bad(p, 'Precisa ser um objeto.'); return undefined; }
    const from = text(x.from, `${p}.from`, ASSIST_LIMITS.areaName * 2);
    const to = text(x.to, `${p}.to`, ASSIST_LIMITS.areaName);
    if (!from || !to) return undefined;
    if (!names.areas.some((a) => nameKey(a) === nameKey(from))) { bad(`${p}.from`, `Não existe área chamada "${from}".`); return undefined; }
    areaNames.add(nameKey(to));
    return { from, to, ...why(x, p) };
  });
  if (renameAreas?.length) out.renameAreas = renameAreas;

  const goals = list(input.goals, 'goals', ASSIST_LIMITS.goals, (x, p) => {
    if (!obj(x)) { bad(p, 'Precisa ser um objeto.'); return undefined; }
    const t = text(x.title, `${p}.title`, GOAL_TITLE_MAX);
    if (!t) return undefined;
    goalNames.add(nameKey(t));
    const w = text(x.why, `${p}.why`, ASSIST_LIMITS.goalWhy, false);
    const h = text(x.horizon, `${p}.horizon`, ASSIST_LIMITS.horizon, false);
    return { title: t, ...(w ? { why: w } : {}), ...(h ? { horizon: h } : {}) };
  });
  if (goals?.length) out.goals = goals;

  if (input.season !== undefined) {
    const s = input.season;
    if (!obj(s)) bad('season', 'Precisa ser um objeto.');
    else {
      const t = text(s.title, 'season.title', SEASON_TITLE_MAX);
      const weeks = s.weeks;
      if (weeks !== 6 && weeks !== 7 && weeks !== 8) bad('season.weeks', 'Semanas: 6, 7 ou 8.');
      const focus = list(s.focus ?? [], 'season.focus', 2, (f, p) => text(f, p, ASSIST_LIMITS.focusText));
      if (t && (weeks === 6 || weeks === 7 || weeks === 8) && focus) out.season = { title: t, weeks, focus, ...why(s, 'season') };
    }
  }

  const area = (v: unknown, path: string): { area?: string } => {
    const a = text(v, path, ASSIST_LIMITS.areaName * 2, false);
    if (!a) return {};
    if (!areaNames.has(nameKey(a))) { bad(path, `Área "${a}" não existe nem é criada nesta proposta.`); return {}; }
    return { area: a };
  };

  // `withArea` false (study missions): the mission takes the subject's area when applied, so a sent `area` is ignored.
  const missionOf = (withArea: boolean) => (x: unknown, p: string): ProposedMission | undefined => {
    if (!obj(x)) { bad(p, 'Precisa ser um objeto.'); return undefined; }
    const t = text(x.title, `${p}.title`, ASSIST_LIMITS.missionTitle);
    if (!t) return undefined;
    const m: ProposedMission = { title: t, ...(withArea ? area(x.area, `${p}.area`) : {}) };
    if (x.durationMin !== undefined) {
      if (!(MISSION_DURATIONS as readonly unknown[]).includes(x.durationMin)) bad(`${p}.durationMin`, 'Duração: 5, 15, 30, 60 ou 90 minutos.');
      else m.durationMin = x.durationMin as ProposedMission['durationMin'];
    }
    if (x.energy !== undefined) {
      if (x.energy !== 'light' && x.energy !== 'medium' && x.energy !== 'heavy') bad(`${p}.energy`, 'Energia: light, medium ou heavy.');
      else m.energy = x.energy;
    }
    if (x.important !== undefined) {
      if (typeof x.important !== 'boolean') bad(`${p}.important`, 'Precisa ser true ou false.');
      else if (x.important) m.important = true;
    }
    if (x.date !== undefined) {
      if (typeof x.date !== 'string' || !isValidDayKey(x.date) || x.date < today || x.date > addDays(today, ASSIST_LIMITS.dateAheadDays)) {
        bad(`${p}.date`, `Data no formato AAAA-MM-DD, de hoje (${today}) até ${ASSIST_LIMITS.dateAheadDays} dias.`);
      } else m.date = x.date;
    }
    const fs = text(x.firstStep, `${p}.firstStep`, ASSIST_LIMITS.firstStep, false);
    if (fs) m.firstStep = fs;
    return { ...m, ...why(x, p) };
  };
  const mission = missionOf(true);
  const studyMission = missionOf(false);

  // Journeys are named before blocks can cite them.
  if (Array.isArray(input.journeys)) {
    for (const j of input.journeys) if (obj(j) && typeof j.title === 'string' && j.title.trim()) journeyNames.add(nameKey(j.title));
  }
  const journeys = list(input.journeys, 'journeys', ASSIST_LIMITS.journeys, (x, p) => {
    if (!obj(x)) { bad(p, 'Precisa ser um objeto.'); return undefined; }
    const t = text(x.title, `${p}.title`, ASSIST_LIMITS.title);
    if (!t) return undefined;
    const outcome = text(x.outcome, `${p}.outcome`, ASSIST_LIMITS.outcome, false);
    const g = text(x.goal, `${p}.goal`, GOAL_TITLE_MAX, false);
    if (g && !goalNames.has(nameKey(g))) bad(`${p}.goal`, `Objetivo "${g}" não existe nem é criado nesta proposta.`);
    const missions = list(x.missions ?? [], `${p}.missions`, ASSIST_LIMITS.journeyMissions, mission) ?? [];
    return {
      title: t, ...area(x.area, `${p}.area`), ...(outcome ? { outcome } : {}), ...(g && goalNames.has(nameKey(g)) ? { goal: g } : {}),
      missions, ...why(x, p),
    };
  });
  if (journeys?.length) out.journeys = journeys;

  const missions = list(input.missions, 'missions', ASSIST_LIMITS.missions, mission);
  if (missions?.length) out.missions = missions;

  if (input.routine !== undefined) {
    const r = input.routine;
    if (!obj(r)) bad('routine', 'Precisa ser um objeto.');
    else {
      if (r.mode !== 'add' && r.mode !== 'replace') bad('routine.mode', 'Modo: add (somar à rotina atual) ou replace (arquivar a atual).');
      const blocks = list(r.blocks, 'routine.blocks', ASSIST_LIMITS.blocks, (x, p) => {
        if (!obj(x)) { bad(p, 'Precisa ser um objeto.'); return undefined; }
        const name = text(x.name, `${p}.name`, ASSIST_LIMITS.blockName);
        const days = weekdays(x.weekdays, `${p}.weekdays`);
        if (!isHHmm(x.start)) bad(`${p}.start`, 'Início no formato HH:mm.');
        const dur = x.durationMin;
        const min = x.minimumMin;
        if (!Number.isInteger(dur) || (dur as number) < 5 || (dur as number) > 480) bad(`${p}.durationMin`, 'Duração: de 5 a 480 minutos.');
        if (!Number.isInteger(min) || (min as number) < 5 || (Number.isInteger(dur) && (min as number) > (dur as number))) {
          bad(`${p}.minimumMin`, 'Versão mínima: de 5 minutos até a duração.');
        }
        if (!BLOCK_KINDS.includes(x.kind as BlockKind)) bad(`${p}.kind`, `Tipo: ${BLOCK_KINDS.join(', ')}.`);
        const j = text(x.journey, `${p}.journey`, ASSIST_LIMITS.title, false);
        if (j && !journeyNames.has(nameKey(j))) bad(`${p}.journey`, `Jornada "${j}" não existe nem é criada nesta proposta.`);
        const checklist = list(x.checklist, `${p}.checklist`, ASSIST_LIMITS.checklistMax, (c, cp) => text(c, cp, ASSIST_LIMITS.checklistItem));
        if (x.protected !== undefined && typeof x.protected !== 'boolean') bad(`${p}.protected`, 'Precisa ser true ou false.');
        if (!name || !days || !isHHmm(x.start) || !Number.isInteger(dur) || !Number.isInteger(min) || !BLOCK_KINDS.includes(x.kind as BlockKind)) return undefined;
        return {
          name, weekdays: days, start: x.start, durationMin: dur as number, minimumMin: min as number, kind: x.kind as BlockKind,
          ...(x.protected === true ? { protected: true } : {}), ...area(x.area, `${p}.area`),
          ...(j && journeyNames.has(nameKey(j)) ? { journey: j } : {}), ...(checklist?.length ? { checklist } : {}), ...why(x, p),
        };
      });
      if ((r.mode === 'add' || r.mode === 'replace') && blocks && blocks.length > 0) out.routine = { mode: r.mode, blocks };
    }
  }

  const commitments = list(input.commitments, 'commitments', ASSIST_LIMITS.commitments, (x, p) => {
    if (!obj(x)) { bad(p, 'Precisa ser um objeto.'); return undefined; }
    const t = text(x.title, `${p}.title`, ASSIST_LIMITS.commitmentTitle);
    const days = weekdays(x.weekdays, `${p}.weekdays`);
    if (!isHHmm(x.start) || !isHHmm(x.end) || parseHHmm(x.start) >= parseHHmm(x.end)) {
      bad(p, 'Início e fim no formato HH:mm, com o início antes do fim.');
      return undefined;
    }
    if (!t || !days) return undefined;
    return { title: t, weekdays: days, start: x.start, end: x.end, ...why(x, p) };
  });
  if (commitments?.length) out.commitments = commitments;

  if (input.training !== undefined) {
    const tr = input.training;
    if (!obj(tr) || !Array.isArray(tr.days) || tr.days.length === 0 || tr.days.length > ASSIST_LIMITS.trainingDays) {
      bad('training.days', `Plano de treino: de 1 a ${ASSIST_LIMITS.trainingDays} dias.`);
    } else {
      const raw = tr.days as unknown[];
      const okShape = raw.every((d) => obj(d) && Number.isInteger(d.weekday) && (d.weekday as number) >= 0 && (d.weekday as number) <= 6
        && typeof d.name === 'string' && d.name.trim().length > 0 && d.name.trim().length <= TRAINING_NAME_MAX
        && Array.isArray(d.exercises) && d.exercises.length <= EXERCISES_MAX
        && d.exercises.every((e: unknown) => obj(e) && typeof e.name === 'string' && e.name.trim().length > 0));
      if (!okShape || new Set(raw.map((d) => (d as { weekday: number }).weekday)).size !== raw.length) {
        bad('training.days', `Cada dia: weekday de 0 a 6 (sem repetir), name de 1 a ${TRAINING_NAME_MAX} caracteres e exercises (até ${EXERCISES_MAX}, cada um com name).`);
      } else {
        const days = raw as TrainingDay[];
        const pi = planIssues(days)[0];
        let block: TrainingBlock | undefined;
        if (pi) bad(`training.days.${days.findIndex((d) => d.weekday === pi.weekday)}.exercises.${pi.index}`, PLAN_ISSUE_TEXT[pi.kind]);
        if (tr.block !== undefined) {
          const bi = obj(tr.block) ? blockIssue(tr.block as unknown as TrainingBlock) : { kind: 'weeks' as const };
          if (bi) bad(`training.block${bi.week ? `.weeks.${bi.week - 1}` : ''}`, BLOCK_ISSUE_TEXT[bi.kind]);
          else block = cleanBlock(tr.block as unknown as TrainingBlock);
        }
        if (!pi) out.training = { days: normalizePlanDays(days), ...(block ? { block } : {}), ...why(tr, 'training') };
      }
    }
  }

  const subjects = list(input.subjects, 'subjects', ASSIST_LIMITS.subjects, (x, p) => {
    if (!obj(x)) { bad(p, 'Precisa ser um objeto.'); return undefined; }
    const t = text(x.title, `${p}.title`, SUBJECT_TITLE_MAX);
    if (!t) return undefined;
    const s: ProposedSubject = { title: t };
    if (x.weekday !== undefined) {
      if (!Number.isInteger(x.weekday) || (x.weekday as number) < 0 || (x.weekday as number) > 6) { bad(`${p}.weekday`, 'Dia da semana de 0 (domingo) a 6 (sábado).'); return undefined; }
      s.weekday = x.weekday as number;
    }
    if (x.start !== undefined || x.end !== undefined) {
      if (!isHHmm(x.start) || !isHHmm(x.end) || parseHHmm(x.start) >= parseHHmm(x.end)) { bad(p, 'Início e fim no formato HH:mm, com o início antes do fim.'); return undefined; }
      s.start = x.start; s.end = x.end;
    }
    return { ...s, ...why(x, p) };
  });
  if (subjects?.length) out.subjects = subjects;

  // Study packages cite a subject that exists or that this proposal creates (named before validation, like journeys).
  const subjectNames = new Set(names.subjects.map(nameKey));
  if (Array.isArray(input.subjects)) {
    for (const s of input.subjects) if (obj(s) && typeof s.title === 'string' && s.title.trim()) subjectNames.add(nameKey(s.title));
  }
  const study = list(input.study, 'study', ASSIST_LIMITS.study, (x, p) => {
    if (!obj(x)) { bad(p, 'Precisa ser um objeto.'); return undefined; }
    const subject = text(x.subject, `${p}.subject`, SUBJECT_TITLE_MAX);
    if (subject && !subjectNames.has(nameKey(subject))) {
      bad(`${p}.subject`, `Disciplina "${subject}" não existe. Use o nome de uma disciplina do contexto ou crie a disciplina em subjects nesta proposta.`);
      return undefined;
    }
    const parts = [x.topics, x.cards, x.assessments, x.missions, x.docs];
    const noNotebook = x.notebook === undefined || (obj(x.notebook) && Object.keys(x.notebook).length === 0);
    if (noNotebook && parts.every((v) => v === undefined || (Array.isArray(v) && v.length === 0))) {
      bad(p, 'O pacote precisa de pelo menos um assunto (topics), card (cards), prova ou trabalho (assessments), missão (missions), seção do caderno (notebook) ou apostila (docs).');
      return undefined;
    }
    const topics = list(x.topics, `${p}.topics`, ASSIST_LIMITS.studyTopics, (t, tp) => {
      if (!obj(t)) { bad(tp, 'Precisa ser um objeto.'); return undefined; }
      const name = text(t.name, `${tp}.name`, TOPIC_NAME_MAX);
      if (t.seen !== undefined && typeof t.seen !== 'boolean') { bad(`${tp}.seen`, 'Precisa ser true ou false.'); return undefined; }
      return name ? { name, ...(t.seen === true ? { seen: true } : {}), ...why(t, tp) } : undefined;
    });
    const cards = list(x.cards, `${p}.cards`, ASSIST_LIMITS.studyCards, (c, cp): ProposedStudyCard | undefined => {
      if (!obj(c)) { bad(cp, 'Precisa ser um objeto.'); return undefined; }
      const typeOk = c.type === 'basic' || c.type === 'topic';
      if (!typeOk) bad(`${cp}.type`, 'Tipo: basic (pergunta e resposta) ou topic (tema na frente, pontos-chave no verso, um por linha).');
      const front = text(c.front, `${cp}.front`, AI_LIMITS.cardField);
      const back = text(c.back, `${cp}.back`, AI_LIMITS.cardField);
      if (typeOk && c.type === 'topic' && back && keyPoints(back).length === 0) bad(`${cp}.back`, 'Card de tema: liste ao menos um ponto-chave no verso, um por linha.');
      const pointsOk = c.type !== 'topic' || !back || keyPoints(back).length > 0;
      return typeOk && front && back && pointsOk ? { type: c.type as ProposedStudyCard['type'], front, back, ...why(c, cp) } : undefined;
    });
    const assessments = list(x.assessments, `${p}.assessments`, ASSIST_LIMITS.studyAssessments, (a, ap): ProposedStudyAssessment | undefined => {
      if (!obj(a)) { bad(ap, 'Precisa ser um objeto.'); return undefined; }
      const kindOk = a.kind === 'prova' || a.kind === 'trabalho';
      if (!kindOk) bad(`${ap}.kind`, 'Tipo: prova ou trabalho.');
      const dateOk = typeof a.date === 'string' && isValidDayKey(a.date) && a.date >= today && a.date <= addDays(today, ASSIST_LIMITS.assessmentAheadDays);
      if (!dateOk) bad(`${ap}.date`, `Data no formato AAAA-MM-DD, de hoje (${today}) até ${ASSIST_LIMITS.assessmentAheadDays} dias.`);
      const content = text(a.content, `${ap}.content`, ASSIST_LIMITS.assessmentContent, false);
      return kindOk && dateOk
        ? { kind: a.kind as AssessmentKind, date: a.date as DayKey, ...(content ? { content } : {}), ...why(a, ap) }
        : undefined;
    });
    const missions = list(x.missions, `${p}.missions`, ASSIST_LIMITS.studyMissions, studyMission);
    let notebook: ProposedNotebook | undefined;
    if (x.notebook !== undefined) {
      const nb = x.notebook;
      if (!obj(nb)) bad(`${p}.notebook`, 'Precisa ser um objeto.');
      // Mirrors the schema's minProperties: 1 (an empty notebook alone already fails the package rule above).
      else if (Object.keys(nb).length === 0) bad(`${p}.notebook`, 'Mande pelo menos uma seção ou a bibliografia, ou deixe notebook de fora.');
      else {
        const n: ProposedNotebook = {};
        for (const section of NOTEBOOK_SECTIONS) {
          const v = text(nb[section], `${p}.notebook.${section}`, NOTEBOOK_LIMITS[section], false);
          if (v) n[section] = v;
        }
        const books = list(nb.bibliography, `${p}.notebook.bibliography`, NOTEBOOK_LIMITS.bibliography, (b, bp): BibItem | undefined => {
          if (!obj(b)) { bad(bp, 'Precisa ser um objeto.'); return undefined; }
          const t = text(b.title, `${bp}.title`, NOTEBOOK_LIMITS.bibTitle);
          const authors = text(b.authors, `${bp}.authors`, NOTEBOOK_LIMITS.bibAuthors, false);
          const kindOk = BIB_KINDS.includes(b.kind as BibKind);
          if (!kindOk) bad(`${bp}.kind`, 'Tipo: basica, complementar ou outra.');
          const url = text(b.url, `${bp}.url`, NOTEBOOK_LIMITS.bibUrl, false);
          const urlIssue = url ? bibUrlIssue(url) : undefined;
          if (urlIssue) bad(`${bp}.url`, urlIssue);
          const note = text(b.note, `${bp}.note`, NOTEBOOK_LIMITS.bibNote, false);
          if (!t || !kindOk || urlIssue) return undefined;
          return { title: t, ...(authors ? { authors } : {}), kind: b.kind as BibKind, ...(url ? { url } : {}), ...(note ? { note } : {}) };
        });
        if (books?.length) n.bibliography = books;
        if (Object.keys(n).length > 0) notebook = n;
      }
    }
    const docs = list(x.docs, `${p}.docs`, NOTEBOOK_LIMITS.docs, (d, dp): ProposedStudyDoc | undefined => {
      if (!obj(d)) { bad(dp, 'Precisa ser um objeto.'); return undefined; }
      const t = text(d.title, `${dp}.title`, NOTEBOOK_LIMITS.docTitle);
      const markdown = text(d.markdown, `${dp}.markdown`, NOTEBOOK_LIMITS.docMarkdown);
      return t && markdown ? { title: t, markdown, ...why(d, dp) } : undefined;
    });
    if (!subject) return undefined;
    return {
      subject, ...(topics?.length ? { topics } : {}), ...(cards?.length ? { cards } : {}),
      ...(assessments?.length ? { assessments } : {}), ...(missions?.length ? { missions } : {}),
      ...(notebook ? { notebook } : {}), ...(docs?.length ? { docs } : {}),
    };
  });
  if (study?.length) out.study = study;

  if (input.studyProfile !== undefined) {
    const sp = input.studyProfile;
    if (!obj(sp)) bad('studyProfile', 'Precisa ser um objeto.');
    else {
      const t = text(sp.text, 'studyProfile.text', NOTEBOOK_LIMITS.studyProfile);
      if (t) out.studyProfile = { text: t, ...why(sp, 'studyProfile') };
    }
  }

  if (input.preferences !== undefined) {
    const pr = input.preferences;
    if (!obj(pr)) bad('preferences', 'Precisa ser um objeto.');
    else {
      const p: ProposedPreferences = {};
      if (pr.dayStartHour !== undefined) {
        if (!Number.isInteger(pr.dayStartHour) || (pr.dayStartHour as number) < 0 || (pr.dayStartHour as number) > 6) bad('preferences.dayStartHour', 'Início do dia: de 0 a 6 (hora).');
        else p.dayStartHour = pr.dayStartHour as number;
      }
      if (pr.dayEndHour !== undefined) {
        if (!(DAY_END_HOURS as readonly unknown[]).includes(pr.dayEndHour)) bad('preferences.dayEndHour', 'Fim do dia: 20, 21, 22, 23 ou 0 (meia-noite).');
        else p.dayEndHour = pr.dayEndHour as number;
      }
      if (p.dayStartHour !== undefined || p.dayEndHour !== undefined) out.preferences = { ...p, ...why(pr, 'preferences') };
    }
  }

  const count = proposalItems(out).length + (out.journeys ?? []).reduce((n, j) => n + j.missions.length, 0);
  if (count === 0 && issues.length === 0) bad('', 'A proposta não tem nenhum item.');
  if (count > ASSIST_LIMITS.items) bad('', `No máximo ${ASSIST_LIMITS.items} itens por proposta (esta tem ${count}).`);
  return issues.length > 0 ? { issues } : { payload: out, issues };
}

// ------------------------------------------------------------------ the items the person reviews

export type ProposalGroup =
  | 'preferences' | 'areas' | 'goals' | 'journeys' | 'missions' | 'routine' | 'commitments' | 'training' | 'subjects' | 'study';
export const PROPOSAL_GROUP_TITLE: Record<ProposalGroup, string> = {
  preferences: 'Preferências', areas: 'Áreas', goals: 'Objetivos e temporada', journeys: 'Jornadas e missões',
  missions: 'Missões', routine: 'Rotina', commitments: 'Compromissos fixos', training: 'Treino', subjects: 'Disciplinas',
  study: 'Estudo',
};
export interface ProposalItem { key: string; group: ProposalGroup; text: string; detail?: string[]; why?: string }

const missionText = (m: ProposedMission): string => [
  m.title, m.durationMin ? durationText(m.durationMin) : '', m.area ? `área ${m.area}` : '', m.date ? ddmm(m.date) : '',
  m.important ? 'importante' : '',
].filter(Boolean).join(' · ');

/** Every item of a proposal, in the order they are applied (the review lists them in this order). */
export function proposalItems(p: ProposalPayload): ProposalItem[] {
  const out: ProposalItem[] = [];
  const w = (why?: string) => (why ? { why } : {});
  if (p.preferences) {
    const parts = [
      p.preferences.dayStartHour !== undefined ? `o dia começa às ${String(p.preferences.dayStartHour).padStart(2, '0')}:00` : '',
      p.preferences.dayEndHour !== undefined ? `o dia termina às ${String(p.preferences.dayEndHour).padStart(2, '0')}:00` : '',
    ].filter(Boolean);
    out.push({ key: 'preferences', group: 'preferences', text: `${parts.join(' e ').replace(/^o/, 'O')}.`, ...w(p.preferences.why) });
  }
  p.renameAreas?.forEach((r, i) => out.push({ key: `renameAreas.${i}`, group: 'areas', text: `Renomear área: ${r.from} → ${r.to}`, ...w(r.why) }));
  p.areas?.forEach((a, i) => out.push({ key: `areas.${i}`, group: 'areas', text: `Nova área: ${a.name} (atributo ${a.attribute})`, ...w(a.why) }));
  p.goals?.forEach((g, i) => out.push({
    key: `goals.${i}`, group: 'goals', text: `Objetivo: ${g.title}${g.horizon ? ` · ${g.horizon}` : ''}`,
    ...(g.why ? { detail: [`Por que importa: ${g.why}`] } : {}),
  }));
  if (p.season) {
    out.push({
      key: 'season', group: 'goals', text: `Temporada: ${p.season.title} · ${p.season.weeks} semanas`,
      ...(p.season.focus.length ? { detail: p.season.focus.map((f) => `Foco: ${f}`) } : {}), ...w(p.season.why),
    });
  }
  p.journeys?.forEach((j, i) => out.push({
    key: `journeys.${i}`, group: 'journeys',
    text: [`Jornada: ${j.title}`, j.area ? `área ${j.area}` : '', j.goal ? `objetivo ${j.goal}` : '', `${j.missions.length} ${j.missions.length === 1 ? 'missão' : 'missões'}`].filter(Boolean).join(' · '),
    detail: [...(j.outcome ? [`Resultado esperado: ${j.outcome}`] : []), ...j.missions.map((m) => missionText(m))], ...w(j.why),
  }));
  p.missions?.forEach((m, i) => out.push({ key: `missions.${i}`, group: 'missions', text: missionText(m), ...(m.firstStep ? { detail: [`Primeiro passo: ${m.firstStep}`] } : {}), ...w(m.why) }));
  p.routine?.blocks.forEach((b, i) => out.push({
    key: `routine.blocks.${i}`, group: 'routine',
    text: [weekdaysText(b.weekdays), b.start, b.name, `${durationText(b.durationMin)}, mínimo ${durationText(b.minimumMin)}`, BLOCK_KIND_TEXT[b.kind], b.area ?? b.journey ?? '', b.protected ? 'protegido' : ''].filter(Boolean).join(' · '),
    ...(b.checklist?.length ? { detail: [`Checklist: ${b.checklist.join(', ')}`] } : {}), ...w(b.why),
  }));
  p.commitments?.forEach((c, i) => out.push({ key: `commitments.${i}`, group: 'commitments', text: `${weekdaysText(c.weekdays)} · ${c.start}–${c.end} · ${c.title}`, ...w(c.why) }));
  if (p.training) {
    const days = [...p.training.days].sort((a, b) => MON_FIRST.indexOf(a.weekday) - MON_FIRST.indexOf(b.weekday));
    out.push({
      key: 'training', group: 'training',
      text: `Plano de treino: ${days.map((d) => `${WEEKDAY_ABBR[d.weekday]} ${d.name}`).join(', ')}${p.training.block ? ` · bloco de ${p.training.block.weeks.length} ${p.training.block.weeks.length === 1 ? 'semana' : 'semanas'}` : ''}`,
      detail: days.map((d) => `${WEEKDAY_ABBR[d.weekday]}: ${d.exercises.map((e) => [e.name, plannedText(e), e.note ? `(${e.note})` : ''].filter(Boolean).join(' ')).join('; ')}`),
      ...w(p.training.why),
    });
  }
  p.subjects?.forEach((s, i) => out.push({
    key: `subjects.${i}`, group: 'subjects',
    text: `Disciplina: ${s.title}${s.weekday !== undefined ? ` · ${WEEKDAY_ABBR[s.weekday]}` : ''}${s.start ? ` ${s.start}–${s.end}` : ''}`, ...w(s.why),
  }));
  // The study profile opens the Estudo group (it is shared by every subject).
  if (p.studyProfile) {
    out.push({ key: 'studyProfile', group: 'study', text: 'Perfil de estudo (substitui o atual)', detail: [excerpt(p.studyProfile.text)], ...w(p.studyProfile.why) });
  }
  // After the subjects, so a subject created by this proposal exists when its study is applied.
  p.study?.forEach((s, i) => {
    const key = (kind: string, k: number) => `study.${i}.${kind}.${k}`;
    s.topics?.forEach((t, k) => out.push({
      key: key('topics', k), group: 'study', text: `Assunto · ${s.subject}: ${t.name}${t.seen ? ' (já visto)' : ''}`, ...w(t.why),
    }));
    s.cards?.forEach((c, k) => {
      const lines = c.type === 'topic' ? keyPoints(c.back) : c.back.split('\n').map((l) => l.trim()).filter(Boolean);
      out.push({
        key: key('cards', k), group: 'study', text: `Card · ${s.subject}: ${oneLine(c.front)}`,
        detail: [c.type === 'topic' ? `Pontos-chave: ${lines.join('; ')}` : `Verso: ${lines.join(' ')}`], ...w(c.why),
      });
    });
    s.assessments?.forEach((a, k) => out.push({
      key: key('assessments', k), group: 'study', text: `${ASSESSMENT_LABEL[a.kind]} · ${s.subject} · ${ddmm(a.date)}`,
      ...(a.content ? { detail: [`Conteúdo: ${a.content}`] } : {}), ...w(a.why),
    }));
    s.missions?.forEach((m, k) => out.push({
      key: key('missions', k), group: 'study',
      text: `Missão · ${s.subject}: ${[m.title, m.durationMin ? durationText(m.durationMin) : '', m.date ? ddmm(m.date) : '', m.important ? 'importante' : ''].filter(Boolean).join(' · ')}`,
      ...(m.firstStep ? { detail: [`Primeiro passo: ${m.firstStep}`] } : {}), ...w(m.why),
    }));
    for (const section of NOTEBOOK_SECTIONS) {
      const v = s.notebook?.[section];
      if (v) {
        out.push({
          key: key(section, 0), group: 'study', text: `Caderno · ${s.subject}: ${NOTEBOOK_SECTION_TITLE[section]} (substitui o atual)`,
          detail: [excerpt(v)],
        });
      }
    }
    s.notebook?.bibliography?.forEach((b, k) => {
      const detail = [b.url ? `Link: ${b.url}` : '', b.note ? `Observação: ${b.note}` : ''].filter(Boolean);
      out.push({
        key: key('bibliography', k), group: 'study',
        text: `Bibliografia · ${s.subject}: ${b.title}${b.authors ? ` — ${b.authors}` : ''} (${BIB_KIND_LABEL[b.kind]})`,
        ...(detail.length ? { detail } : {}),
      });
    });
    s.docs?.forEach((d, k) => out.push({
      key: key('docs', k), group: 'study', text: `Apostila · ${s.subject}: ${d.title} · ${charsText(d.markdown.length)}`,
      detail: [excerpt(d.markdown)], ...w(d.why),
    }));
  });
  return out;
}

/** The notebook section of a review item (`study.<package>.<section>.0`), if it is one. */
export function notebookSectionOfKey(key: string): NotebookSection | undefined {
  const [kind, , section] = key.split('.');
  return kind === 'study' && (NOTEBOOK_SECTIONS as readonly string[]).includes(section ?? '') ? section as NotebookSection : undefined;
}

// ------------------------------------------------------------------ the context the assistant reads

export type AssistTables = {
  profile?: Profile[]; settings?: Settings[]; areas?: Area[]; blocks?: Block[]; commitments?: Commitment[];
  journeys?: Journey[]; missions?: Mission[]; goals?: Goal[]; seasons?: Season[]; trainingPlans?: TrainingPlan[];
  blockSessions?: BlockSession[]; dayState?: DayState[]; reviews?: Review[]; focusSessions?: FocusSession[];
  dayPlans?: { day: DayKey; blocks: unknown[]; deleted: boolean }[]; proposals?: Proposal[]; subjectTopics?: SubjectTopic[];
  subjectNotebooks?: SubjectNotebook[]; studyDocs?: Pick<StudyDoc, (typeof ASSIST_STUDY_DOC_FIELDS)[number]>[];
};

/**
 * The context only counts the apostilas: of `studyDocs` it needs just these fields, never the Markdown (the server
 * reads them with an SQLite projection; IndexedDB in the app always returns whole records).
 */
export const ASSIST_STUDY_DOC_FIELDS = ['id', 'journeyId', 'deleted'] as const;

/** The tables `buildAssistContext` reads. Nothing else is ever sent to an assistant. */
export const ASSIST_CONTEXT_TABLES = [
  'profile', 'settings', 'areas', 'blocks', 'commitments', 'journeys', 'missions', 'goals', 'seasons', 'trainingPlans',
  'blockSessions', 'dayState', 'reviews', 'focusSessions', 'dayPlans', 'proposals', 'subjectTopics',
  'subjectNotebooks', 'studyDocs',
] as const;

const NOTEBOOK_RULE_BODY = 'O caderno é a memória entre as conversas: plan (plano de ensino: ementa, objetivos, cronograma e critérios de avaliação), studied (o que já foi estudado), difficulties (dificuldades), nextChat (o que um chat novo precisa saber para continuar, inclusive como ensinar a pessoa) e bibliography (title, authors, kind basica, complementar ou outra, url https:// e note; mesclada pelo título). Ao terminar, mande as seções atualizadas: o texto novo substitui o antigo, então mande a seção inteira, não só o que mudou. Escreva em nextChat o que o próximo chat precisa saber. studyProfile (fora do pacote): como a pessoa aprende melhor, comum a todas as disciplinas; o texto novo substitui o atual. docs: apostilas (resumo, explicação, lista de exercícios) em Markdown, com títulos com #, listas, fórmulas entre $ e código entre crases triplas, até 40 mil caracteres; uma apostila com o mesmo título na disciplina tem o texto substituído. Nada disso dá XP.';

export const ASSIST_RULES = {
  howItWorks: 'Você só envia propostas com enviar_proposta. A pessoa revisa no app, desmarca o que não quer e aplica; nada muda antes disso. Itens com o mesmo nome de algo que já existe são reaproveitados, sem duplicar.',
  formats: 'Horário HH:mm (24 h). Dia da semana: 0 = domingo, 1 = segunda … 6 = sábado. Datas AAAA-MM-DD. Áreas, jornadas, objetivos e disciplinas são citados pelo nome.',
  blockKinds: 'focus: trabalho de foco profundo; study: estudo; body: corpo e treino; light: tarefas leves e complementos; routine: rotina com checklist (início e fim do dia).',
  blocks: 'Um bloco tem duração normal e versão mínima (usada em dia difícil). Bloco protegido não some em dia de recuperação.',
  missions: 'Missões são pequenas: duração 5, 15, 30, 60 ou 90 minutos; energia light, medium ou heavy; primeiro passo opcional.',
  training: 'Plano de treino: um dia por weekday, cada exercício com name e, se quiser, sets (1–10), repsMin/repsMax (1–100), restMinSec/restMaxSec (15–600) e note. Bloco opcional: startDay e weeks (1–8) com rirMin/rirMax (0–5) e cardioMin/cardioMax em minutos.',
  study: 'Estudo (study): quando a pessoa pedir para mandar ao LIFE RPG o que estudaram na conversa, envie um pacote por disciplina, com subject = o nome de uma disciplina do contexto (ou criada em subjects na mesma proposta), só com o que foi de fato visto ou combinado. topics: assuntos; seen: true quando o assunto já foi estudado na conversa (marca o nível "Vi"; nunca marque mais que isso, o resto é autoavaliação da pessoa). cards: basic (pergunta e resposta) ou topic (tema na frente, pontos-chave no verso, um por linha); entram como rascunho para a pessoa completar. assessments: provas e trabalhos com data. missions: tarefas da disciplina (dúvidas viram missões, como "Perguntar ao professor sobre …"). Não repita assuntos nem avaliações que o contexto já mostra.',
  notebook: `Caderno da disciplina (notebook, dentro do pacote study): antes de ensinar ou propor estudo de uma disciplina, chame ler_disciplina. ler_disciplina lista os PDFs da aula da disciplina em files (slides, plano de ensino, capítulos): leia os PDFs da disciplina com ler_material antes de montar apostilas a partir deles; cite a página. ${NOTEBOOK_RULE_BODY}`,
  privacy: 'Você lê o estudo das disciplinas (caderno, apostilas, PDFs, assuntos, provas e trabalhos e os cards dos baralhos ligados a elas) e o perfil de estudo. Nunca lê diário, sono, nutrição, check-ins, registros de energia, estratégias, baralhos fora das disciplinas nem PDFs fora das disciplinas (os de "Sem disciplina" não são lidos). Não peça esses dados pelo app.',
};

/** The notebook rule of the copied request ("Sem conector"): there is no tool there, the memory comes in the text. */
export const PASTE_NOTEBOOK_RULE = `Caderno da disciplina (notebook, dentro do pacote study): quando este pedido traz a memória de uma disciplina, leia antes de ensinar ou propor estudo. Os PDFs da aula (files) vêm só com o título e o número de páginas, sem o texto: peça à pessoa o trecho de que precisar. ${NOTEBOOK_RULE_BODY}`;

const live = <T extends { deleted: boolean }>(xs: readonly T[] | undefined): T[] => (xs ?? []).filter((x) => !x.deleted);

/**
 * What an assistant reads (`ler_contexto`): the structure of the app and a summary in counts of the last 4 complete
 * weeks. Only the tables of ASSIST_CONTEXT_TABLES are read, and of them only the fields listed here.
 */
export function buildAssistContext(t: AssistTables, today: DayKey) {
  const settings = live(t.settings)[0];
  const startHour = settings?.dayStartHour ?? 4;
  const profile = live(t.profile)[0];
  const areas = live(t.areas);
  const areaName = (id?: ID) => areas.find((a) => a.id === id)?.name;
  const journeys = live(t.journeys);
  const journeyTitle = (id?: ID) => journeys.find((j) => j.id === id)?.title;
  const goals = live(t.goals);
  const missions = live(t.missions);
  const commitments = live(t.commitments).filter((c) => c.weekdays?.length && (c.untilDate === undefined || c.untilDate >= today));
  const open = (m: Mission) => m.status === 'open' || m.status === 'doing';

  const subjects = journeys.filter((j) => j.subject && j.status === 'active');
  const plan = live(t.trainingPlans)[0];
  const week = plan ? blockWeekOf(plan.block, today) : undefined;

  const weeks = completedWeeks(today, ASSIST_LIMITS.historyWeeks);
  const inWeek = (day: DayKey | undefined, w: { start: DayKey; end: DayKey }) => day !== undefined && day >= w.start && day <= w.end;
  const history = weeks.map((w) => {
    const done: Record<string, number> = {};
    for (const m of missions) {
      if (m.status !== 'done' || m.completedAt === undefined || !inWeek(dayKeyOf(m.completedAt, startHour), w)) continue;
      const k = areaName(m.areaId) ?? (m.journeyId ? areaName(journeys.find((j) => j.id === m.journeyId)?.areaId) : undefined) ?? 'sem área';
      done[k] = (done[k] ?? 0) + 1;
    }
    const modes = { normal: 0, low: 0, recovery: 0, free: 0 };
    for (const d of live(t.dayState)) if (inWeek(d.id, w) && d.mode) modes[d.mode] += 1;
    return {
      week: `${w.start} a ${w.end}`,
      missionsDoneByArea: done,
      blocksStarted: live(t.blockSessions).filter((s) => inWeek(s.day, w) && s.startedAt !== undefined).length,
      blocksPlanned: live(t.dayPlans).filter((d) => inWeek(d.day, w)).reduce((n, d) => n + d.blocks.length, 0),
      daysByMode: modes,
      reviews: live(t.reviews).filter((r) => inWeek(r.day, w)).length,
      focusMinutes: Math.round(live(t.focusSessions).filter((f) => inWeek(dayKeyOf(f.startedAt, startHour), w)).reduce((s, f) => s + f.activeMs, 0) / 60_000),
    };
  });

  const proposals = live(t.proposals).sort((a, b) => b.createdAt - a.createdAt).slice(0, ASSIST_LIMITS.proposalsInContext).map((p) => {
    const count = (r: ItemResult) => (p.outcome ?? []).filter((o) => o.result === r).length;
    return {
      title: p.payload?.title, sentAt: new Date(p.createdAt).toISOString().slice(0, 10), status: p.status,
      applied: count('applied'), existed: count('existed'), skipped: count('skipped'), unchecked: count('unchecked'),
      skippedReasons: (p.outcome ?? []).filter((o) => o.result === 'skipped' && o.reason).map((o) => `${o.key}: ${o.reason}`),
    };
  });

  return {
    today,
    profile: { name: profile?.name ?? '', companion: profile?.companionName ?? '' },
    preferences: { dayStartHour: startHour, dayEndHour: settings?.dayEndHour ?? 23 },
    areas: areas.map((a) => ({ name: a.name, attribute: a.attribute, archived: a.archived })),
    routine: live(t.blocks).filter((b) => !b.archived).sort((a, b) => a.order - b.order).map((b) => ({
      name: b.name, weekdays: b.weekdays, days: weekdaysText(b.weekdays), start: b.targetStart, durationMin: b.durationMin,
      minimumMin: b.minimumMin, kind: b.kind, protected: b.protected,
      ...(areaName(b.areaId) ? { area: areaName(b.areaId) } : {}), ...(journeyTitle(b.journeyId) ? { journey: journeyTitle(b.journeyId) } : {}),
    })),
    commitments: commitments.map((c) => ({ title: c.title, weekdays: c.weekdays!, days: weekdaysText(c.weekdays!), start: c.start, end: c.end })),
    journeys: journeys.filter((j) => j.status === 'active' && !j.subject).sort((a, b) => a.order - b.order).map((j) => {
      const own = missions.filter((m) => m.journeyId === j.id && m.status !== 'dropped');
      return {
        title: j.title, ...(areaName(j.areaId) ? { area: areaName(j.areaId) } : {}), ...(j.outcome ? { outcome: j.outcome } : {}),
        ...(j.goalId ? { goal: goals.find((g) => g.id === j.goalId)?.title } : {}),
        missionsDone: own.filter((m) => m.status === 'done').length, missionsTotal: own.length,
        openMissions: own.filter(open).map((m) => ({ title: m.title, ...(m.durationMin ? { durationMin: m.durationMin } : {}) })),
      };
    }),
    goals: goals.filter((g) => g.status === 'ativo' || g.status === 'pausado').map((g) => ({
      title: g.title, status: g.status, ...(g.why ? { why: g.why } : {}), ...(g.horizon ? { horizon: g.horizon } : {}),
    })),
    season: (() => {
      const s = live(t.seasons).find((x) => x.status === 'ativa');
      return s ? { title: s.title, startDay: s.startDay, plannedWeeks: s.plannedWeeks, focus: s.focus.map((f) => f.text).filter(Boolean) } : null;
    })(),
    missions: missions.filter((m) => open(m) && !m.journeyId && !m.assessment)
      .sort((a, b) => (a.date ?? '9999') < (b.date ?? '9999') ? -1 : (a.date ?? '9999') > (b.date ?? '9999') ? 1 : a.createdAt - b.createdAt)
      .slice(0, ASSIST_LIMITS.openMissionsInContext)
      .map((m) => ({
        title: m.title, ...(areaName(m.areaId) ? { area: areaName(m.areaId) } : {}), ...(m.date ? { date: m.date } : {}),
        ...(m.durationMin ? { durationMin: m.durationMin } : {}), ...(m.important ? { important: true } : {}),
      })),
    training: plan ? {
      days: planDaysOf(plan).map((d) => ({ weekday: d.weekday, name: d.name, exercises: d.exercises })),
      ...(plan.block ? { block: { ...plan.block, ...(week ? { thisWeek: targetText(week) } : {}) } } : {}),
    } : null,
    // Topic names and open avaliações, so a subject chat does not send them again. Never the chat link (`chatUrl`).
    subjects: subjects.map((j) => {
      const cls = commitments.find((c) => nameKey(c.title) === nameKey(j.title));
      const assessments = missions
        .filter((m) => m.journeyId === j.id && m.assessment && open(m))
        .map((m) => ({ kind: m.assessment!, date: assessmentDay(m) }))
        .filter((a): a is { kind: AssessmentKind; date: DayKey } => a.date !== undefined && a.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date));
      const topics = live(t.subjectTopics).filter((x) => x.journeyId === j.id).map((x) => x.name)
        .sort((a, b) => a.localeCompare(b, 'pt-BR')).slice(0, ASSIST_LIMITS.topicsInContext);
      // Whether the caderno has anything and how many apostilas: the contents come from ler_disciplina.
      const notebook = notebookFilled(live(t.subjectNotebooks).find((n) => n.journeyId === j.id));
      const docs = live(t.studyDocs).filter((d) => d.journeyId === j.id).length;
      return {
        title: j.title, ...(cls ? { class: `${weekdaysText(cls.weekdays!)} ${cls.start}–${cls.end}` } : {}),
        topics, assessments, notebook, docs,
      };
    }),
    history,
    proposals,
    rules: ASSIST_RULES,
  };
}

export type AssistContext = ReturnType<typeof buildAssistContext>;

/** The names a proposal can cite (live, unarchived areas; active journeys; active or paused goals; active subjects). */
export function proposalNamesOf(t: Pick<AssistTables, 'areas' | 'journeys' | 'goals'>): ProposalNames {
  const journeys = live(t.journeys).filter((j) => j.status === 'active');
  return {
    areas: live(t.areas).filter((a) => !a.archived).map((a) => a.name),
    journeys: journeys.map((j) => j.title),
    goals: live(t.goals).filter((g) => g.status === 'ativo' || g.status === 'pausado').map((g) => g.title),
    subjects: journeys.filter((j) => j.subject === true).map((j) => j.title),
  };
}
