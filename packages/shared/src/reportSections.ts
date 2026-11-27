import type {
  Block, BlockOutcome, BlockSession, Card, DayKey, DayMode, DayPlan, Deck, DiaryEntry, FocusSession, Goal, ID, Journey, LifeEvent,
  Mission, MonthReview, PracticeSession, ProblemSet, Season, SnoozeReason, SpeechProgram, SpeechSession, SpeechSituation, Strategy,
  SubjectTopic, TrainingLog,
} from './types';
import { addDays, dayKeyOf, timestampAt } from './dates';
import { periodDays } from './periods';
import { ACCURACY_MIN, ESCAPE_PLACE_LABEL, dayIndex, type DayIndex, type PatternData } from './trends';
import { planVsDone } from './planVsDone';
import { MISSION_LIST_MIN, classifyEvent, postponeHypotheses, postponeObserved } from './postpone';
import { METHOD_LABEL, reviewMethods, sleepVsBlocks, sleepVsDayMode } from './associations';
import {
  BLOCKERS, BLOCK_OUTCOMES, BLOCK_OUTCOME_LABEL, SNOOZE_REASONS, SNOOZE_REASON_LABEL, investigatedPartial, isSnoozeReason,
} from './outcomes';
import { INDICATORS, hintCount, type Indicator } from './practice';
import { creditedMs } from './studyPlan';
import {
  NO_CONTACT_MIN, classOf, daysWithoutContact, nextAssessment, subjectJourneys, topicsByLevel, topicsSummary, type ContactData,
} from './faculty';
import { assessmentDay } from './engine';
import { SLEEP_MIN_NIGHTS, clockFromNoon, sleepQualityOf, sleepWindow } from './sleep';
import {
  CONCENTRATIONS, CONCENTRATION_LABEL, LOADS, LOAD_LABEL, MOODS, MOOD_LABEL, TIREDNESS, TIREDNESS_LABEL,
} from './dayClose';
import { STRATEGY_DECIDED_LABEL, STRATEGY_SOURCE_LABEL, strategiesInRange } from './strategy';
import { GOAL_PROGRESS_LABEL, GOAL_STATUS_TAG, goalAnswers, goalCountText, goalCounts, sortedGoals } from './goals';
import { seasonFocusTexts, seasonsInRange } from './seasons';
import { WORKOUT_KINDS, WORKOUT_LABEL } from './workouts';
import { trainingCounts } from './training';
import { diaryVisible, reviewsBetween } from './diary';
import { speechReportBlock } from './speechReport';
import {
  REPORT_SECTION_TITLE, REPORT_WEEKDAY_ABBR, renderReportBlock, renderReportDiary, renderReportReviews,
  reportCount, reportDay, reportDecimal, reportDiaryEntries, reportDuration, reportEmpty, reportHeader, reportList, reportPct,
  reportQuote, reportRange, reportSaid, reportSectionsOf, reportShortDay,
  type ReportBlock, type ReportOptions, type ReportPeriod, type ReportRange, type ReportSection,
} from './report';

// Relatórios para IAs (2026-11-23): the sections that read the app's records, and the whole report. Every number
// reuses a rule the app already shows (weekly review, Padrões, Matérias, Corpo); interpretations are only Padrões'
// own rules, written as interpretation. Block counts never read the day in progress (like Padrões).

/** How far before the report's first day the reader loads records (contact: 180 days; associations: 90). */
export const REPORT_LOOKBACK_DAYS = 200;

/** Everything a report reads, live records only (diary entries as stored: the rules pick the visible ones). */
export interface ReportData extends PatternData {
  dayPlans: DayPlan[];
  focusSessions: FocusSession[];
  journeys: Journey[];
  restDays: readonly number[];           // study settings: days without "dias de estudo"
  diaryEntries: DiaryEntry[];
  monthReviews: MonthReview[];
  trainingLogs: TrainingLog[];
  problemSets: ProblemSet[];
  subjectTopics: SubjectTopic[];
  decks: Deck[];
  cards: Card[];
  linkNames: Readonly<Record<string, string>>;   // linkKey → mission or journey title
  strategies: Strategy[];                        // live (trashed ones included: the rules pick the visible ones)
  goals: Goal[];                                 // live (Objetivos, 2026-11-23)
  seasons: Season[];                             // live (Temporadas, 2026-11-23)
  speechSessions: SpeechSession[];               // live (Comunicação oral, 2026-11-23)
  speechSituations: SpeechSituation[];           // live
  speechPrograms: SpeechProgram[];               // live
}

export interface ReportInput { data: ReportData; period: ReportPeriod; options: ReportOptions }

interface Ctx {
  data: ReportData;
  options: ReportOptions;
  range: ReportRange;
  days: DayKey[];          // the range, oldest first
  blockDays: DayKey[];     // the range's days before today: block counts never read the day in progress
  asOfNext: DayKey;        // the first day not read: the day after the range, or today while it is in progress
  idx: DayIndex;
  inRange(day: DayKey): boolean;
  dayOf(ts: number): DayKey;
  missions: Map<ID, Mission>;   // live
  blocks: Map<ID, Block>;       // live, archived included
}

function context(input: ReportInput): Ctx {
  const { data, options } = input;
  const range = reportRange(input.period, data.today);
  const days = periodDays(range);
  return {
    data, options, range, days,
    blockDays: days.filter((d) => d < data.today),
    asOfNext: range.end < data.today ? addDays(range.end, 1) : data.today,
    idx: dayIndex(data),
    inRange: (day) => day >= range.start && day <= range.end,
    dayOf: (ts) => dayKeyOf(ts, data.dayStartHour),
    missions: new Map(data.missions.filter((m) => !m.deleted).map((m) => [m.id, m])),
    blocks: new Map(data.blocks.filter((b) => !b.deleted).map((b) => [b.id, b])),
  };
}

const MIN = 60_000;
const byText = (a: string, b: string): number => a.localeCompare(b, 'pt-BR');

/** "ansiedade 3 · tédio 1": how many times each value appears, most frequent first (ties by text). */
function tally(values: readonly string[]): string {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || byText(a[0], b[0])).map(([v, n]) => `${v} ${n}`).join(' · ');
}

/** ["Ler", "Pauta", "Ler"] → ["Ler 2×", "Pauta"]: each title once, in first-seen order, with how many times when repeated. */
function timesEach(titles: readonly string[]): string[] {
  const m = new Map<string, number>();
  for (const t of titles) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].map(([t, n]) => (n > 1 ? `${t} ${n}×` : t));
}

/** "sono", "sono ou treino", "sono, treino ou cansaço". */
const orList = (xs: readonly string[]): string =>
  (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} ou ${xs[xs.length - 1]}`);

// ------------------------------------------------------------------ Visão geral

const DAY_MODES: readonly DayMode[] = ['normal', 'low', 'recovery', 'free'];
const DAY_MODE_TEXT: Record<DayMode, string> = { normal: 'Normal', low: 'Baixa energia', recovery: 'Recuperação', free: 'Livre' };

/**
 * Days of the range with some record: the day started, typed or closed; a block session, focus, mission event,
 * card, review, practice, exercise log or topic mark; a sleep night (on the morning it ends), a workout or a
 * training log (each only with its health switch on); a review answered (week, month, season); a diary entry that could go in.
 */
function recordedDays(c: Ctx): Set<DayKey> {
  const { data, options: { health, includePrivate } } = c;
  const out = new Set<DayKey>();
  const add = (day: DayKey): void => {
    if (c.inRange(day)) out.add(day);
  };
  for (const s of data.dayStates) {
    if (s.deleted) continue;
    const state = s.tiredness !== undefined || s.mood !== undefined || s.load !== undefined || s.concentration !== undefined;
    if (s.startedAt !== undefined || s.mode !== undefined || s.closedAt !== undefined || (health.estado && state)) add(s.id);
  }
  for (const s of data.sessions) if (!s.deleted) add(s.day);
  for (const f of data.focusSessions) if (!f.deleted) add(c.dayOf(f.startedAt));
  for (const e of data.events) if (!e.deleted) add(c.dayOf(e.at));
  for (const k of data.checkins) if (!k.deleted) add(c.dayOf(k.at));
  for (const r of data.reviews) if (!r.deleted) add(r.day);
  for (const p of data.practice) {
    if (p.deleted) continue;
    add(c.dayOf(p.createdAt));
    if (p.endedAt !== undefined) add(c.dayOf(p.endedAt));
  }
  for (const s of data.problemSets) if (!s.deleted) add(s.day);
  for (const t of data.subjectTopics) if (!t.deleted) for (const m of t.marks) add(c.dayOf(m.at));
  if (health.sono) {
    for (const l of data.sleepLogs) if (!l.deleted && (l.bedAt !== undefined || l.wakeAt !== undefined)) add(addDays(l.night, 1));
  }
  if (health.treino) {
    for (const w of data.workouts) if (!w.deleted) add(w.day);
    for (const l of data.trainingLogs) if (!l.deleted) add(l.day);
  }
  for (const w of data.weeks) if (!w.deleted && w.review) add(c.dayOf(w.review.answeredAt));
  for (const m of data.monthReviews) if (!m.deleted && !m.skipped && m.answers) add(c.dayOf(m.answeredAt));
  for (const x of data.seasons) if (!x.deleted && x.review) add(c.dayOf(x.review.answeredAt));
  for (const e of data.diaryEntries) if (diaryVisible(e) && (includePrivate || !e.private)) add(e.day);
  return out;
}

/**
 * The goals' lines of Visão geral: every active or paused goal, and any other goal with something linked or a "Avançou?"
 * answer in the period. Linked counts come from the journeys (goalCounts); a goal with nothing linked goes to Sem dados.
 */
function goalLines(c: Ctx): Pick<ReportBlock, 'facts' | 'mine' | 'missing'> & { answered: boolean } {
  const { data, range } = c;
  const counts = goalCounts({
    goals: data.goals, journeys: data.journeys, missions: data.missions, sessions: data.sessions, blocks: data.blocks,
    dayStates: data.dayStates, from: range.start, to: range.end, dayStartHour: data.dayStartHour,
  });
  const out = { facts: [] as string[], mine: [] as string[], missing: [] as string[], answered: false };
  for (const g of sortedGoals(data.goals)) {
    const answers = goalAnswers(data.weeks, g.id, { from: range.start, to: range.end }, data.dayStartHour);
    const linked = goalCountText(counts.get(g.id));
    if (g.status !== 'ativo' && g.status !== 'pausado' && !linked && answers.length === 0) continue;
    const name = `${reportQuote(g.title)} (${GOAL_STATUS_TAG[g.status]}${g.horizon ? `, ${g.horizon}` : ''})`;
    if (linked) out.facts.push(`Ligado ao objetivo ${name}: ${linked}.`);
    else out.missing.push(`Objetivo ${name}: sem registro ligado a ele neste período.`);
    if (g.why) out.mine.push(reportSaid(`Por que ${reportQuote(g.title)} importa`, g.why));
    // His "Avançou?" answers are his reading of the week: a perception, never a recorded fact.
    if (answers.length > 0) {
      out.answered = true;
      out.mine.push(`Avançou em ${reportQuote(g.title)}? `
        + `${answers.map((a) => `semana de ${reportDay(a.week)}: ${GOAL_PROGRESS_LABEL[a.progress]}`).join(' · ')}.`);
    }
  }
  return out;
}

function visaoBlock(c: Ctx): ReportBlock {
  const recorded = recordedDays(c);
  const atypical = c.data.weeks
    .filter((w) => !w.deleted && w.atypical && w.id <= c.range.end && addDays(w.id, 6) >= c.range.start)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const goals = goalLines(c);
  if (recorded.size === 0 && atypical.length === 0 && goals.facts.length === 0 && !goals.answered) return reportEmpty('Nenhum registro neste período.');
  const modes = new Map<DayMode, number>();
  const startedDays = new Set(c.data.dayStates.filter((s) => !s.deleted && s.startedAt !== undefined).map((s) => s.id));
  let untyped = 0;
  for (const d of c.days) {
    const m = c.idx.recordedMode(d) ?? (startedDays.has(d) ? c.idx.mode(d) : undefined);
    if (m === undefined) untyped += 1;
    else modes.set(m, (modes.get(m) ?? 0) + 1);
  }
  const withRecords = recorded.size > 0;
  return {
    facts: [
      ...(withRecords ? [`Dias com algum registro: ${recorded.size} de ${c.days.length}.`] : []),
      ...(modes.size > 0 ? [`Tipo dos dias: ${DAY_MODES.filter((m) => modes.has(m)).map((m) => `${modes.get(m)} ${DAY_MODE_TEXT[m]}`).join(' · ')}.`] : []),
      ...atypical.map((w) => `Semana atípica: ${reportDay(w.id)} a ${reportDay(addDays(w.id, 6))}`
        + `${w.atypical!.returnDay ? ` (volta ao ritmo em ${reportDay(w.atypical!.returnDay)})` : ''}.`),
      ...goals.facts,
    ],
    mine: [
      ...atypical.filter((w) => w.atypical!.reason.trim() !== '')
        .map((w) => reportSaid(`Motivo da semana atípica de ${reportDay(w.id)}`, w.atypical!.reason)),
      ...goals.mine,
    ],
    missing: [
      ...(withRecords && untyped > 0 ? [`Tipo do dia não registrado em ${reportCount(untyped, 'dia', 'dias')}.`] : []),
      ...goals.missing,
    ],
    ideas: [],
  };
}

// ------------------------------------------------------------------ Execução

/** His "O que saiu?" words in the range: the newest Parcial and conclusion result of each mission, and each block's; by time. */
function executionWords(c: Ctx, events: readonly LifeEvent[], sessions: readonly BlockSession[]): string[] {
  const said: Array<{ at: number; line: string }> = [];
  const newest = new Map<string, LifeEvent>();
  for (const e of events) {
    if ((e.type !== 'partial' && e.type !== 'result') || typeof e.data?.result !== 'string') continue;
    const key = `${e.type}:${e.missionId}`;
    const cur = newest.get(key);
    if (!cur || e.at > cur.at) newest.set(key, e);
  }
  for (const e of newest.values()) {
    const text = (e.data!.result as string).trim();
    if (text === '') continue;   // a newer blank result cleared it
    const title = c.missions.get(e.missionId!)!.title;
    const day = reportShortDay(c.dayOf(e.at));
    const lead = e.type === 'result' ? `O que saiu de "${title}" (${day})`
      : investigatedPartial(e) ? `Investiguei em "${title}" (${day})` : `Parcial em "${title}" (${day})`;
    said.push({ at: e.at, line: reportSaid(lead, text) });
  }
  for (const s of sessions) {
    const text = s.result?.trim();
    if (!text) continue;
    const name = c.blocks.get(s.blockId)?.name;
    said.push({
      at: s.endedAt ?? s.startedAt ?? timestampAt(s.day, '12:00'),
      line: reportSaid(`O que saiu ${name ? `do bloco "${name}"` : 'de um bloco'} (${reportShortDay(s.day)})`, text),
    });
  }
  return said.sort((a, b) => a.at - b.at).map((x) => x.line);
}

/** "Médio 1 · Muito 2": how many days each level was marked, in the levels' order. */
function levelCounts<T extends string>(marked: readonly T[], order: readonly T[], label: Record<T, string>): string {
  return order.filter((v) => marked.includes(v)).map((v) => `${label[v]} ${marked.filter((x) => x === v).length}`).join(' · ');
}

/** The data as if no training block existed: plans, routine and sessions without `body` blocks. */
function withoutBody(data: ReportData): ReportData {
  const body = new Set(data.blocks.filter((b) => b.kind === 'body').map((b) => b.id));
  for (const p of data.dayPlans ?? []) for (const b of p.blocks) if (b.kind === 'body') body.add(b.blockId);
  return {
    ...data,
    blocks: data.blocks.filter((b) => b.kind !== 'body'),
    sessions: data.sessions.filter((x) => !body.has(x.blockId)),
    dayPlans: (data.dayPlans ?? []).map((p) => ({ ...p, blocks: p.blocks.filter((b) => b.kind !== 'body') })),
  };
}

function execucaoBlock(c: Ctx): ReportBlock {
  const { data } = c;
  const study = c.options.theme === 'aprendizagem';
  // Treino off: training blocks leave Execução too (counts, outcomes, words, planned × executed).
  const noBody = !c.options.health.treino;
  const counts = (b: Block | undefined): boolean => b !== undefined && (!study || b.kind === 'study') && !(noBody && b.kind === 'body');
  const idx = noBody ? dayIndex(withoutBody(data)) : c.idx;
  let planned = 0;
  let started = 0;
  let minimum = 0;
  for (const d of c.blockDays) {
    for (const cb of idx.blocks(d)) {
      if (!counts(cb.block)) continue;
      planned += 1;
      if (cb.started) {
        started += 1;
        if (cb.minimum) minimum += 1;
      }
    }
  }
  const sessions = data.sessions.filter((s) => !s.deleted && c.inRange(s.day) && counts(c.blocks.get(s.blockId)));
  const blocksLine = `Blocos${study ? ' de estudo' : ''}: ${started} de ${planned} ${planned === 1 ? 'iniciado' : 'iniciados'}`
    + `${minimum > 0 ? ` (versão mínima em ${minimum})` : ''}.`;
  // Without a block session before today there is nothing to count against: no "0 de N", only "Sem dados".
  const hasSessions = sessions.some((s) => s.day < data.today);
  const outcomeLine = (): string[] => {
    const outcomes = new Map<BlockOutcome, number>();
    for (const s of sessions) if (s.outcome) outcomes.set(s.outcome, (outcomes.get(s.outcome) ?? 0) + 1);
    return outcomes.size > 0
      ? [`Como foi o bloco: ${BLOCK_OUTCOMES.filter((o) => outcomes.has(o)).map((o) => `${BLOCK_OUTCOME_LABEL[o]} ${outcomes.get(o)}`).join(' · ')}.`]
      : [];
  };
  const inProgress = c.range.end === data.today ? ['Os blocos contam até ontem; hoje ainda está em andamento.'] : [];
  if (study) {
    if (!hasSessions) return reportEmpty('Nenhum bloco de estudo registrado neste período.');
    if (planned === 0) return reportEmpty('Nenhum bloco de estudo planejado neste período.');
    return { facts: [blocksLine], mine: [...outcomeLine(), ...executionWords(c, [], sessions)], missing: inProgress, ideas: [] };
  }

  const events = data.events.filter((e) => !e.deleted && e.missionId !== undefined && c.missions.has(e.missionId)
    && c.inRange(c.dayOf(e.at)));
  const completed = data.missions
    .filter((m) => !m.deleted && m.status === 'done' && m.completedAt !== undefined && c.inRange(c.dayOf(m.completedAt)))
    .sort((a, b) => a.completedAt! - b.completedAt!);
  // A Parcial marked "Investiguei" is counted apart: research without a delivery yet, never a "não deu".
  const partial = new Set(events.filter((e) => e.type === 'partial' && !investigatedPartial(e)).map((e) => e.missionId!));
  const explored = new Set(events.filter((e) => e.type === 'partial' && investigatedPartial(e)).map((e) => e.missionId!));
  const postponed = events.filter((e) => classifyEvent(e, data.dayStartHour) === 'postponed');
  const focus = data.focusSessions.filter((f) => !f.deleted && c.inRange(c.dayOf(f.startedAt)));
  const escapes = data.checkins.filter((k) => !k.deleted && k.kind === 'escape' && c.inRange(c.dayOf(k.at)));
  const mine = executionWords(c, events, sessions);
  if (sessions.length === 0 && completed.length === 0 && partial.size === 0 && explored.size === 0 && postponed.length === 0
    && focus.length === 0 && escapes.length === 0 && mine.length === 0) {
    return reportEmpty('Nenhum bloco, missão, foco ou adiamento registrado neste período.');
  }

  const facts: string[] = [];
  const missing: string[] = [];
  if (planned > 0 && hasSessions) facts.push(blocksLine);
  facts.push(...outcomeLine());
  if (c.blockDays.length > 0 && hasSessions) {
    const p = planVsDone(noBody ? withoutBody(data) : data, [{ kind: 'week', key: c.range.start, start: c.range.start, end: c.range.end, label: '' }], idx)[0]!;
    if (p.daysWithPlan > 0) {
      facts.push(`Planejado × executado (${reportCount(p.daysWithPlan, 'dia', 'dias')} com foto do plano): `
        + `${reportDuration(p.executedMin)} executados de ${reportDuration(p.plannedMin)} planejados.`);
      if (p.areas.length > 0) {
        facts.push(`Por área: ${reportList(p.areas.map((a) => `${a.name} ${reportDuration(a.executedMin)} de ${reportDuration(a.plannedMin)}`))}.`);
      }
    } else if (planned > 0) {
      missing.push('Nenhum dia com foto do plano para comparar planejado × executado.');
    }
  }
  if (completed.length > 0) facts.push(`Missões concluídas: ${completed.length} — ${reportList(timesEach(completed.map((m) => m.title.trim())))}.`);
  if (partial.size > 0) facts.push(`Parcial em ${reportCount(partial.size, 'missão', 'missões')}.`);
  if (explored.size > 0) {
    facts.push(`Investiguei (pesquisa ou exploração, sem entrega ainda) em ${reportCount(explored.size, 'missão', 'missões')}.`);
  }
  if (postponed.length > 0) {
    const reasons = new Map<SnoozeReason, number>();
    for (const e of postponed) {
      const r = e.type === 'snoozed' ? e.data?.reason : undefined;
      if (isSnoozeReason(r)) reasons.set(r, (reasons.get(r) ?? 0) + 1);
    }
    const marked = SNOOZE_REASONS.filter((r) => reasons.has(r))
      .sort((a, b) => reasons.get(b)! - reasons.get(a)!)   // stable: equal counts keep the chips' order
      .map((r) => `${SNOOZE_REASON_LABEL[r]} ${reasons.get(r)}`);
    facts.push(`Adiamentos: ${postponed.length}${marked.length > 0 ? ` (motivos marcados: ${marked.join(' · ')})` : ''}.`);
  }
  if (focus.length > 0) {
    const min = Math.round(focus.reduce((s, f) => s + f.activeMs, 0) / MIN);
    facts.push(`Foco cronometrado: ${reportDuration(min)} em ${reportCount(focus.length, 'sessão', 'sessões')}.`);
  }
  if (escapes.length > 0) {
    facts.push(`Escapei: ${escapes.length} (${tally(escapes.map((k) => ESCAPE_PLACE_LABEL[k.escapedTo ?? 'outro'] ?? k.escapedTo!))}).`);
  }
  return { facts, mine, missing: [...missing, ...inProgress], ideas: [] };
}

// ------------------------------------------------------------------ Aprendizagem

/** "sim 1, parcial 1, sem resposta 1": the closed sessions' answers to one indicator, highest first. */
function ratingParts(sessions: readonly PracticeSession[], i: Indicator): string {
  const parts = ([2, 1, 0] as const).flatMap((v) => {
    const n = sessions.filter((p) => p.ratings[i.key] === v).length;
    return n > 0 ? [`${i.options[v].toLowerCase()} ${n}`] : [];
  });
  const none = sessions.filter((p) => p.ratings[i.key] === undefined).length;
  if (none > 0) parts.push(`sem resposta ${none}`);
  return parts.join(', ');
}

function aprendizagemBlock(c: Ctx): ReportBlock {
  const { data } = c;
  const reviews = data.reviews.filter((r) => !r.deleted && c.inRange(r.day));
  const learned = reviews.filter((r) => r.before.state === 'review');
  const closed = data.practice
    .filter((p) => !p.deleted && p.status === 'done' && p.endedAt !== undefined && c.inRange(c.dayOf(p.endedAt)))
    .sort((a, b) => a.endedAt! - b.endedAt!);
  const rebuilds = data.practice
    .filter((p) => !p.deleted && p.rebuild?.comparedAt !== undefined && c.inRange(c.dayOf(p.rebuild.comparedAt)));
  if (reviews.length === 0 && closed.length === 0 && rebuilds.length === 0) {
    return reportEmpty('Nenhuma revisão nem prática técnica registrada neste período.');
  }
  const facts: string[] = [];
  const missing: string[] = [];
  if (reviews.length > 0) {
    const days = new Set(reviews.map((r) => r.day)).size;
    const cards = new Set(reviews.map((r) => r.cardId)).size;
    const min = Math.round(reviews.reduce((s, r) => s + creditedMs(r), 0) / MIN);
    facts.push(`Revisões: ${reviews.length} em ${reportCount(days, 'dia', 'dias')} `
      + `(${reportDuration(min)}, ${reportCount(cards, 'card diferente', 'cards diferentes')}).`);
    if (learned.length >= ACCURACY_MIN) {
      facts.push(`Acerto em cards já aprendidos: ${reportPct(learned.filter((r) => r.rating > 1).length / learned.length)} (${learned.length} revisões).`);
    } else {
      missing.push(`O acerto aparece com ${ACCURACY_MIN} revisões de cards já aprendidos; neste período: ${learned.length}.`);
    }
  }
  if (closed.length > 0) {
    facts.push(`Prática técnica: ${reportCount(closed.length, 'sessão encerrada', 'sessões encerradas')}.`);
    facts.push(`Autoavaliação: ${INDICATORS.map((i) => `${i.label}: ${ratingParts(closed, i)}`).join(' · ')}.`);
    const hints = closed.reduce((s, p) => s + hintCount(p), 0);
    if (hints > 0) facts.push(`Pistas pedidas: ${hints}.`);
  }
  if (rebuilds.length > 0) {
    const blind = rebuilds.filter((p) => !p.rebuild!.peeked).length;
    facts.push(`Reconstruções comparadas: ${rebuilds.length} (${blind} sem olhar a implementação).`);
  }
  const mine = closed.filter((p) => p.explanation.trim() !== '')
    .map((p) => reportSaid(`Explicação de "${p.title}" (${reportShortDay(c.dayOf(p.endedAt!))})`, p.explanation));
  const ideas: string[] = [];
  const methods = reviewMethods({ reviews: data.reviews, today: c.asOfNext });
  if (reviews.length > 0 && methods.enough) {
    ideas.push(`Jeito de responder e acerto (90 dias até ${reportDay(addDays(c.asOfNext, -1))}): `
      + `${methods.rows.map((r) => `${METHOD_LABEL[r.method]} ${reportPct(r.correct / r.reviews)} em ${r.reviews} revisões`).join(' · ')}. `
      + 'Associação, não causa.');
  }
  return { facts, mine, missing, ideas };
}

// ------------------------------------------------------------------ Matérias

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** The contact records up to `end` (a past report counts the days without contact as they were at its end). */
function contactUntil(c: Ctx): ContactData {
  const { data } = c;
  const end = c.range.end;
  return {
    dayStartHour: data.dayStartHour,
    decks: data.decks,
    cards: data.cards,
    reviews: data.reviews.filter((r) => r.day <= end),
    practice: data.practice.filter((p) => c.dayOf(p.createdAt) <= end)
      .map((p) => (p.endedAt !== undefined && c.dayOf(p.endedAt) > end ? { ...p, endedAt: undefined } : p)),
    missions: data.missions.map((m) => (m.completedAt !== undefined && c.dayOf(m.completedAt) > end ? { ...m, completedAt: undefined } : m)),
    focus: data.focusSessions.filter((f) => c.dayOf(f.startedAt) <= end),
    problemSets: data.problemSets.filter((s) => s.day <= end),
    topics: data.subjectTopics.map((t) => ({ ...t, marks: t.marks.filter((mk) => c.dayOf(mk.at) <= end) })),
  };
}

function materiasBlock(c: Ctx): ReportBlock {
  const { data, range } = c;
  const subjects = subjectJourneys(data.journeys).filter((j) => c.dayOf(j.createdAt) <= range.end);
  if (subjects.length === 0) return reportEmpty('Nenhuma disciplina cadastrada.');
  const contact = contactUntil(c);
  const facts = subjects.map((j) => {
    const parts: string[] = [];
    const cls = classOf(j.title, data.commitments, range.end);
    parts.push(cls
      ? `aula ${WEEK_ORDER.filter((d) => cls.weekdays?.includes(d)).map((d) => REPORT_WEEKDAY_ABBR[d]).join(', ')} · ${cls.start}–${cls.end}`
      : 'aula ainda sem horário');
    const exams = data.missions
      .filter((m) => !m.deleted && m.journeyId === j.id && m.assessment !== undefined && m.status !== 'dropped')
      .map((m) => ({ m, day: assessmentDay(m) }))
      .filter((x): x is { m: Mission; day: DayKey } => x.day !== undefined && c.inRange(x.day))
      .sort((a, b) => a.day.localeCompare(b.day) || a.m.createdAt - b.m.createdAt);
    if (exams.length > 0) {
      parts.push(`${exams.length === 1 ? 'avaliação' : 'avaliações'} no período: ${exams.map((x) => `${x.m.title} (${reportDay(x.day)})`).join(' · ')}`);
    }
    const next = nextAssessment(data.missions, j.id, addDays(range.end, 1));
    if (next) parts.push(`próxima avaliação: ${next.title} (${reportDay(next.day)})`);
    const sets = data.problemSets.filter((s) => !s.deleted && s.journeyId === j.id && c.inRange(s.day));
    if (sets.length > 0) {
      const done = sets.reduce((s, p) => s + p.done, 0);
      const total = sets.every((p) => p.total !== undefined) ? sets.reduce((s, p) => s + p.total!, 0) : undefined;
      const aided = sets.filter((p) => p.unaided !== undefined);
      parts.push(`exercícios: ${reportCount(sets.length, 'lista', 'listas')}, `
        + `${total !== undefined ? `${done} de ${total} feitos` : `${done} ${done === 1 ? 'feito' : 'feitos'}`}`
        + `${aided.length > 0 ? `, ${aided.reduce((s, p) => s + p.unaided!, 0)} sem ajuda` : ''}`);
    }
    const topics = topicsSummary(topicsByLevel(contact.topics, j.id));
    if (topics !== '') parts.push(`assuntos: ${topics}`);
    const away = daysWithoutContact(j, contact, c.asOfNext, data.restDays);
    if (away >= NO_CONTACT_MIN) parts.push(`sem contato há ${away} dias de estudo`);
    return `${j.title}: ${parts.join('; ')}.`;
  });
  return { facts, mine: [], missing: [], ideas: [] };
}

// ------------------------------------------------------------------ Hábitos

const nameKey = (name: string): string => name.trim().toLocaleLowerCase('pt-BR');

/**
 * One strategy of the range: what it is, where it came from, its link, its state, and what the records show while it
 * was tested inside the range (the days before today from its start to its decision): block counts only when such a
 * day has a block session (never "0 de N"), of the linked block (every block of the same name) or of all blocks;
 * escapes when there are any. Treino off: a strategy linked to a training block shows neither the block nor numbers,
 * and the other strategies count no training block.
 */
function strategyFact(c: Ctx, s: Strategy, blockData: ReportData, blockIdx: DayIndex): { line: string; observed: boolean } {
  const { data, options: { health } } = c;
  const block = s.link?.kind === 'block' ? c.blocks.get(s.link.id) : undefined;
  // A link to a block that is gone shows no numbers: never every block's numbers as if they were the linked one's.
  const hidden = s.link?.kind === 'block' && (block === undefined || (block.kind === 'body' && !health.treino));
  const journey = s.link?.kind === 'journey' ? data.journeys.find((j) => j.id === s.link!.id) : undefined;
  const origin = `${STRATEGY_SOURCE_LABEL[s.source]}${s.sourceNote ? `: ${reportQuote(s.sourceNote)}` : ''}`;
  const link = block && !hidden ? ` · bloco "${block.name.trim()}"` : journey ? ` · jornada "${journey.title.trim()}"` : '';
  const state = s.status === 'testando'
    ? `em teste desde ${reportDay(s.startDay)} (decidir em ${reportDay(s.reviewDay)})`
    : `testada de ${reportDay(s.startDay)} a ${reportDay(s.decidedDay!)}, ${STRATEGY_DECIDED_LABEL[s.status].toLowerCase()}`;
  const observed: string[] = [];
  if (!hidden) {
    const days = c.blockDays.filter((d) => d >= s.startDay && (s.decidedDay === undefined || d <= s.decidedDay));
    const daySet = new Set(days);
    const group = block
      ? new Set([...c.blocks.values()].filter((b) => nameKey(b.name) === nameKey(block.name)).map((b) => b.id))
      : undefined;
    const body = health.treino ? new Set<ID>() : new Set([...c.blocks.values()].filter((b) => b.kind === 'body').map((b) => b.id));
    const inScope = (blockId: ID | undefined): boolean => (group
      ? blockId !== undefined && group.has(blockId)
      : blockId === undefined || !body.has(blockId));
    if (blockData.sessions.some((x) => !x.deleted && daySet.has(x.day) && inScope(x.blockId))) {
      let planned = 0;
      let started = 0;
      let minimum = 0;
      for (const d of days) {
        for (const cb of blockIdx.blocks(d)) {
          if (!inScope(cb.block.id)) continue;
          planned += 1;
          if (cb.started) {
            started += 1;
            if (cb.minimum) minimum += 1;
          }
        }
      }
      if (planned > 0) {
        observed.push((group ? `iniciado em ${started} de ${planned} dias` : `${started} de ${planned} blocos iniciados`)
          + (minimum > 0 ? ` (versão mínima em ${minimum})` : ''));
      }
    }
    const escapes = data.checkins
      .filter((k) => !k.deleted && k.kind === 'escape' && daySet.has(c.dayOf(k.at)) && inScope(k.blockId)).length;
    if (escapes > 0) observed.push(`Escapei ${escapes}×`);
  }
  return {
    line: `Estratégia ${reportQuote(s.title)} (${origin}${link}): ${state}`
      + `${observed.length > 0 ? `; durante o teste, neste período: ${observed.join(' · ')}` : ''}.`,
    observed: observed.length > 0,
  };
}

export const STRATEGY_CAVEAT = 'Durante um teste, os registros mostram o que aconteceu, não o efeito da estratégia. Associação, não causa.';

function habitosBlock(c: Ctx): ReportBlock {
  const { data, range } = c;
  const xpDays = new Set(data.xpEvents.filter((x) => !x.deleted).map((x) => x.dayKey));
  const workdays = c.blockDays.filter((d) => c.idx.isWorkday(d));
  const active = workdays.filter((d) => xpDays.has(d)).length;
  const resumptions = data.xpEvents.filter((x) => !x.deleted && x.reason === 'resumption' && c.inRange(x.dayKey)).length;
  const recurring = data.missions.filter((m) => !m.deleted && m.recurrence !== undefined && m.status === 'done'
    && m.completedAt !== undefined && c.inRange(c.dayOf(m.completedAt)));
  const experiments = data.weeks
    .filter((w) => !w.deleted && (w.experiment ?? '').trim() !== '' && w.id <= range.end && addDays(w.id, 6) >= range.start)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const strategies = strategiesInRange(data.strategies, range);
  const states = new Map(data.dayStates.filter((s) => !s.deleted).map((s) => [s.id, s]));
  const focus = c.options.health.estado ? c.days.flatMap((d) => {
    const v = states.get(d)?.concentration;
    return v ? [v] : [];
  }) : [];
  if (active === 0 && resumptions === 0 && recurring.length === 0 && experiments.length === 0 && strategies.length === 0
    && focus.length === 0) {
    return reportEmpty('Nenhuma atividade, retomada ou experimento registrado neste período.');
  }
  const facts: string[] = [];
  const mine: string[] = [];
  const missing: string[] = [];
  const ideas: string[] = [];
  if (active > 0) facts.push(`Dias úteis com alguma atividade (XP): ${active} de ${workdays.length}.`);
  if (resumptions > 0) facts.push(`Retomadas depois de dias parados: ${resumptions}.`);
  if (recurring.length > 0) {
    const byTitle = new Map<string, number>();
    for (const m of recurring) byTitle.set(m.title.trim(), (byTitle.get(m.title.trim()) ?? 0) + 1);
    const rows = [...byTitle.entries()].sort((a, b) => b[1] - a[1] || byText(a[0], b[0])).map(([t, n]) => `${t} ${n}×`);
    facts.push(`Recorrentes concluídas: ${recurring.length} — ${reportList(rows)}.`);
  }
  if (focus.length > 0) {
    facts.push(`Concentração no fechamento do dia: ${levelCounts(focus, CONCENTRATIONS, CONCENTRATION_LABEL)}.`);
    const without = workdays.filter((d) => !states.get(d)?.concentration).length;
    if (without > 0) missing.push(`Concentração não registrada em ${without} de ${reportCount(workdays.length, 'dia útil', 'dias úteis')}.`);
  }
  // Treino off: training blocks leave the experiment and strategy counts too, like in Execução.
  const counts = experiments.length > 0 || strategies.length > 0;
  const blockData = c.options.health.treino || !counts ? data : withoutBody(data);
  const blockIdx = blockData === data ? c.idx : dayIndex(blockData);
  for (const w of experiments) {
    let planned = 0;
    let started = 0;
    const lastDay = addDays(w.id, 6);
    const hasSession = blockData.sessions.some((x) => !x.deleted && x.day >= w.id && x.day <= lastDay && x.day < data.today);
    for (let i = 0; i < 7 && hasSession; i++) {
      const d = addDays(w.id, i);
      if (d >= data.today) break;
      for (const cb of blockIdx.blocks(d)) {
        planned += 1;
        if (cb.started) started += 1;
      }
    }
    facts.push(`Experimento da semana de ${reportDay(w.id)}: ${reportQuote(w.experiment!)}`
      + `${planned > 0 ? ` (blocos iniciados naquela semana: ${started} de ${planned})` : ''}.`);
  }
  let observed = false;
  for (const s of strategies) {
    const f = strategyFact(c, s, blockData, blockIdx);
    facts.push(f.line);
    observed ||= f.observed;
    if (s.why) mine.push(reportSaid(`Por que testar ${reportQuote(s.title)}`, s.why));
    if (s.observe) mine.push(reportSaid(`O que observar em ${reportQuote(s.title)}`, s.observe));
    if (s.decisionNote && s.decidedDay !== undefined && c.inRange(s.decidedDay)) {
      mine.push(reportSaid(`Decisão sobre ${reportQuote(s.title)} (${reportDay(s.decidedDay)})`, s.decisionNote));
    }
  }
  if (observed) ideas.push(STRATEGY_CAVEAT);
  return { facts, mine, missing, ideas };
}

// ------------------------------------------------------------------ Adiamentos e travas

function adiamentosBlock(c: Ctx): ReportBlock {
  const { data, range } = c;
  const starts = data.checkins.filter((k) => !k.deleted && k.kind === 'start' && c.inRange(c.dayOf(k.at)))
    .sort((a, b) => a.at - b.at);
  const perMission = new Map<ID, number>();
  for (const e of data.events) {
    if (e.deleted || !e.missionId || !c.missions.has(e.missionId) || !c.inRange(c.dayOf(e.at))) continue;
    if (classifyEvent(e, data.dayStartHour) === 'postponed') perMission.set(e.missionId, (perMission.get(e.missionId) ?? 0) + 1);
  }
  const many = [...perMission.entries()]
    .filter(([, n]) => n >= MISSION_LIST_MIN)
    .map(([id, n]) => ({ title: c.missions.get(id)!.title, n }))
    .sort((a, b) => b.n - a.n || byText(a.title, b.title));
  if (starts.length === 0 && many.length === 0) {
    return reportEmpty('Nenhum card de início nem missão adiada duas vezes ou mais neste período.');
  }
  const facts: string[] = [];
  if (starts.length > 0) {
    facts.push(`Cards de início ("Antes de começar"): ${starts.length}.`);
    const feelings = starts.flatMap((k) => k.feelings);
    if (feelings.length > 0) facts.push(`Sentimentos marcados: ${tally(feelings)}.`);
    const blockers = starts.flatMap((k) => BLOCKERS.filter((b) => b.key === k.blocker).map((b) => b.label));
    if (blockers.length > 0) facts.push(`O que trava: ${tally(blockers)}.`);
    const tried = starts.filter((k) => k.outcome !== undefined);
    if (tried.length > 0) facts.push(`Começar 10 min: continuou em ${tried.filter((k) => k.outcome === 'continued').length} de ${tried.length}.`);
  }
  if (many.length > 0) facts.push(`Missões adiadas 2 vezes ou mais: ${reportList(many.map((m) => `"${m.title}" ${m.n}×`))}.`);
  const mine = starts.filter((k) => (k.thought ?? '').trim() !== '').map((k) => {
    const title = k.missionId ? c.missions.get(k.missionId)?.title : undefined;
    return reportSaid(`Antes de começar${title ? ` "${title}"` : ''} (${reportShortDay(c.dayOf(k.at))})`, k.thought!);
  });
  const ideas = postponeHypotheses(postponeObserved({ ...data, today: range.end }))
    .map((h) => `${h.text} Base (4 semanas até ${reportDay(range.end)}): ${h.basis}`);
  return { facts, mine, missing: [], ideas };
}

// ------------------------------------------------------------------ Saúde

function saudeBlock(c: Ctx): ReportBlock | undefined {
  const { data, options: { health } } = c;
  if (!health.sono && !health.treino && !health.estado) return undefined;   // every type off: the section says nothing
  const nights = c.days.map((d) => addDays(d, -1));   // the night before each day
  const nightSet = new Set(nights);
  const anySleep = data.sleepLogs.some((l) => !l.deleted && nightSet.has(l.night) && (l.bedAt !== undefined || l.wakeAt !== undefined));
  const workouts = data.workouts.filter((w) => !w.deleted && c.inRange(w.day));
  const logs = data.trainingLogs
    .filter((l) => !l.deleted && c.inRange(l.day) && (l.cardio !== undefined || l.exercises.some((e) => e.status !== undefined)))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
  const states = new Map(data.dayStates.filter((s) => !s.deleted).map((s) => [s.id, s]));
  const tired = c.days.flatMap((d) => {
    const t = states.get(d)?.tiredness;
    return t ? [t] : [];
  });
  const moods = c.days.flatMap((d) => {
    const v = states.get(d)?.mood;
    return v ? [v] : [];
  });
  const loads = c.days.flatMap((d) => {
    const v = states.get(d)?.load;
    return v ? [v] : [];
  });
  const sono = health.sono && anySleep;
  const treino = health.treino && (workouts.length > 0 || logs.length > 0);
  const estado = health.estado && (tired.length > 0 || moods.length > 0 || loads.length > 0);
  if (!sono && !treino && !estado) {
    const kinds = [health.sono ? 'sono' : '', health.treino ? 'treino' : '', health.estado ? 'cansaço' : ''].filter(Boolean);
    return reportEmpty(`Nenhum registro de ${orList(kinds)} neste período.`);
  }
  const facts: string[] = [];
  const missing: string[] = [];
  const ideas: string[] = [];
  if (health.sono) {
    if (!sono) missing.push('Sem registro de sono neste período.');
    else {
      const lastNight = addDays(c.range.end, -1);
      const win = sleepWindow(data.sleepLogs, lastNight, nights.length);
      facts.push(`Sono: ${reportCount(win.complete, 'noite', 'noites')} com Deitei e Acordei.`);
      if (win.enough) {
        facts.push(`Duração média: ${reportDuration(win.avgMinutes!)}; `
          + `deitar por volta de ${clockFromNoon(win.bed!.meanMin)} (variação típica ±${reportDuration(win.bed!.spreadMin)}); `
          + `acordar por volta de ${clockFromNoon(win.wake!.meanMin)} (±${reportDuration(win.wake!.spreadMin)}).`);
      }
      const quality = sleepQualityOf(data.sleepLogs, lastNight, nights.length);
      if (quality) facts.push(`Qualidade percebida (1 a 5): média ${reportDecimal(quality.avg)} em ${quality.nights} noites.`);
      if (win.complete < nights.length) {
        missing.push(`Sono sem Deitei e Acordei em ${nights.length - win.complete} de ${reportCount(nights.length, 'noite', 'noites')}.`);
      }
      if (!win.enough) missing.push(`A média de sono aparece com ${SLEEP_MIN_NIGHTS} noites completas.`);
    }
  }
  if (health.treino) {
    if (!treino) missing.push('Sem registro de treino neste período.');
    else {
      if (workouts.length > 0) {
        const kinds = WORKOUT_KINDS.flatMap((k) => {
          const ws = workouts.filter((w) => w.kind === k);
          if (ws.length === 0) return [];
          const minimum = ws.filter((w) => w.minimum).length;
          return [`${WORKOUT_LABEL[k]} ${ws.length} (${reportDuration(ws.reduce((s, w) => s + w.minutes, 0))}`
            + `${minimum > 0 ? `, ${reportCount(minimum, 'versão mínima', 'versões mínimas')}` : ''})`];
        });
        facts.push(`Treinos registrados: ${workouts.length} — ${kinds.join(' · ')}.`);
      }
      if (logs.length > 0) {
        const t = { done: 0, swapped: 0, skipped: 0 };
        for (const l of logs) {
          const x = trainingCounts(l);
          t.done += x.done;
          t.swapped += x.swapped;
          t.skipped += x.skipped;
        }
        const names = [...new Set(logs.flatMap((l) => (l.planName ? [l.planName] : [])))];
        const parts = [
          t.done > 0 ? reportCount(t.done, 'exercício feito', 'exercícios feitos') : '',
          t.swapped > 0 ? reportCount(t.swapped, 'trocado', 'trocados') : '',
          t.skipped > 0 ? reportCount(t.skipped, 'pulado', 'pulados') : '',
        ].filter(Boolean);
        facts.push(`Treino do dia: ${reportCount(logs.length, 'dia', 'dias')}${names.length > 0 ? ` (${reportList(names)})` : ''}`
          + `${parts.length > 0 ? `: ${parts.join(', ')}` : ''}.`);
        const intensity = logs.flatMap((l) => (l.cardio?.intensity !== undefined ? [String(l.cardio.intensity)] : []));
        if (intensity.length > 0) facts.push(`Intensidade do cardio marcada (1 a 10): ${reportList(intensity)}.`);
      }
    }
  }
  if (health.estado) {
    const workdays = c.blockDays.filter((d) => c.idx.isWorkday(d));
    const ofWorkdays = (without: number): string => `${without} de ${reportCount(workdays.length, 'dia útil', 'dias úteis')}`;
    if (tired.length === 0) missing.push('Cansaço não registrado neste período.');
    else {
      facts.push(`Cansaço no fechamento do dia: ${levelCounts(tired, TIREDNESS, TIREDNESS_LABEL)}.`);
      const without = workdays.filter((d) => !states.get(d)?.tiredness).length;
      if (without > 0) missing.push(`Cansaço não registrado em ${ofWorkdays(without)}.`);
    }
    if (moods.length > 0) {
      facts.push(`Humor no fechamento do dia: ${levelCounts(moods, MOODS, MOOD_LABEL)}.`);
      const without = workdays.filter((d) => !states.get(d)?.mood).length;
      if (without > 0) missing.push(`Humor não registrado em ${ofWorkdays(without)}.`);
    }
    if (loads.length > 0) {
      facts.push(`Sobrecarga no fechamento do dia: ${levelCounts(loads, LOADS, LOAD_LABEL)}.`);
      const without = workdays.filter((d) => !states.get(d)?.load).length;
      if (without > 0) missing.push(`Sobrecarga não registrada em ${ofWorkdays(without)}.`);
    }
  }
  if (sono) {
    const asOf = { ...data, today: c.asOfNext };
    const last = reportDay(addDays(c.asOfNext, -1));
    const sb = sleepVsBlocks(asOf, c.idx);
    if (sb.enough) {
      const s = sb.shorter!;
      const l = sb.longer!;
      ideas.push(`Sono e blocos do dia seguinte (90 dias até ${last}): depois das noites mais curtas `
        + `(até ${reportDuration(sb.thresholdMin!)}, ${s.days} dias), ${reportDecimal(s.started)} de ${reportDecimal(s.planned)} `
        + `blocos iniciados, em média; depois das mais longas (${l.days} dias), ${reportDecimal(l.started)} de ${reportDecimal(l.planned)}. `
        + 'Associação, não causa.');
    }
    const sm = sleepVsDayMode(asOf, c.idx);
    if (sm.enough) {
      const s = sm.shorter!;
      const l = sm.longer!;
      ideas.push(`Sono e tipo do dia (90 dias até ${last}): depois das noites mais curtas (até ${reportDuration(sm.thresholdMin!)}, `
        + `${s.days} dias), Baixa energia ou Recuperação em ${s.lowDays}; depois das mais longas (${l.days} dias), em ${l.lowDays}. `
        + 'Associação, não causa.');
    }
  }
  return { facts, mine: [], missing, ideas };
}

// ------------------------------------------------------------------ the report

const BUILDERS: Record<Exclude<ReportSection, 'revisoes'>, (c: Ctx) => ReportBlock | undefined> = {
  visao: visaoBlock,
  execucao: execucaoBlock,
  aprendizagem: aprendizagemBlock,
  materias: materiasBlock,
  habitos: habitosBlock,
  adiamentos: adiamentosBlock,
  saude: saudeBlock,
  fala: (c) => speechReportBlock({
    sessions: c.data.speechSessions, situations: c.data.speechSituations, programs: c.data.speechPrograms, range: c.range,
  }),
};

/**
 * The report as Markdown: the header, then the theme's sections in order, the Diário (unless "Nenhuma") before
 * Revisões. Pure: the same data and choices always give the same text (the preview is the file).
 */
export function reportMarkdown(input: ReportInput): string {
  const c = context(input);
  const { data, options } = c;
  const sections = reportSectionsOf(options);
  const diary = options.diary !== 'nenhuma';
  const out = reportHeader(options.theme, input.period, data.today);
  const testing = strategiesInRange(data.strategies, c.range);
  if (testing.length > 0) out.push(`Estratégias em teste neste período: ${reportList(testing.map((s) => reportQuote(s.title)))}.`);
  for (const s of seasonsInRange(data.seasons, c.range, data.today)) {
    const focus = seasonFocusTexts(s, { goals: data.goals, strategies: data.strategies });
    const when = s.endedDay !== undefined
      ? `de ${reportDay(s.startDay)} a ${reportDay(s.endedDay)}`
      : `desde ${reportDay(s.startDay)}, planejada para ${reportCount(s.plannedWeeks, 'semana', 'semanas')}`;
    out.push(`Temporada neste período: ${reportQuote(s.title)} (${when})${focus.length > 0 ? `; focos: ${focus.map(reportQuote).join(' · ')}` : ''}.`);
  }
  if (sections.length === 0 && !diary) out.push('', 'Nenhuma seção escolhida.');
  const parts: Array<ReportSection | 'diario'> = [
    ...sections.filter((s) => s !== 'revisoes'),
    ...(diary ? ['diario' as const] : []),
    ...(sections.includes('revisoes') ? ['revisoes' as const] : []),
  ];
  for (const s of parts) {
    if (s === 'diario') {
      out.push(...renderReportDiary(reportDiaryEntries(data.diaryEntries, c.range, options), data.linkNames));
    } else if (s === 'revisoes') {
      out.push(...renderReportReviews(reviewsBetween({
        weeks: data.weeks, months: data.monthReviews, seasons: data.seasons, from: c.range.start, to: c.range.end,
        dayStartHour: data.dayStartHour,
      })));
    } else {
      const block = BUILDERS[s](c);
      if (block) out.push(...renderReportBlock(REPORT_SECTION_TITLE[s], block));
    }
  }
  return `${out.join('\n')}\n`;
}
