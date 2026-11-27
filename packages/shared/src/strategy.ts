import type { DayKey, ID, Strategy, StrategyLink, StrategySource, StrategyStatus } from './types';
import { addDays, isValidDayKey } from './dates';
import { normalize } from './parser';

// Estratégias (2026-11-23): what Vitor decided to test (from a conversation with an AI, a study, Padrões or his
// own idea), since when, what to observe, and his decision after 1–4 weeks. Nothing is imported from an AI: a
// strategy exists only because he created it. Rules only; nothing here reads or writes the database.

export const STRATEGY_SOURCES: readonly StrategySource[] = ['ia', 'pesquisa', 'ideia', 'padroes'];
export const STRATEGY_SOURCE_LABEL: Record<StrategySource, string> = {
  ia: 'Conversa de IA', pesquisa: 'Pesquisa', ideia: 'Ideia minha', padroes: 'Padrões',
};
/** The sources that take "Qual conversa ou fonte?". */
export const SOURCE_NOTE_SOURCES: readonly StrategySource[] = ['ia', 'pesquisa'];

export const STRATEGY_STATUSES: readonly StrategyStatus[] = ['testando', 'mantida', 'ajustada', 'descartada'];
export const STRATEGY_GROUP_TITLE: Record<StrategyStatus, string> = {
  testando: 'Testando', mantida: 'Mantidas', ajustada: 'Ajustadas', descartada: 'Descartadas',
};
export type DecidedStatus = Exclude<StrategyStatus, 'testando'>;
export const STRATEGY_DECIDED_LABEL: Record<DecidedStatus, string> = { mantida: 'Mantida', ajustada: 'Ajustada', descartada: 'Descartada' };
/** The chips of "Decisão" in the sheet. */
export const STRATEGY_CHOICE_LABEL: Record<StrategyStatus, string> = {
  testando: 'Ainda testando', mantida: 'Manter', ajustada: 'Ajustar', descartada: 'Descartar',
};

/** "Decidir em": days after the start (chips 1 to 4 weeks). */
export const STRATEGY_REVIEW_DAYS: readonly number[] = [7, 14, 21, 28];
export const STRATEGY_REVIEW_LABEL: Record<number, string> = { 7: '1 semana', 14: '2 semanas', 21: '3 semanas', 28: '4 semanas' };
export const STRATEGY_REVIEW_DEFAULT = 14;
/** "Decidir depois": the decision moves this many days past today (or past the review day, when later). */
export const STRATEGY_POSTPONE_DAYS = 7;
export const STRATEGY_TITLE_MAX = 200;
export const STRATEGY_TEXT_MAX = 140;
export const STRATEGY_SOURCE_NOTE_MAX = 80;
export const STRATEGY_NOTE_MAX = 500;
/** Titles in the Agora and block lines before "+N". */
export const STRATEGY_LINE_MAX = 2;

/** The text in one line: whitespace collapsed, ends trimmed. */
const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();
const cut = (text: string, max: number): string => flat(text).slice(0, max).trim();
/** Two titles are the same strategy when they match without accents, case or extra spaces. */
/** A text as it becomes a strategy title (one line, cut at the limit): compare with this, not with the raw text. */
export const strategyTitleOf = (text: string): string => cut(text, STRATEGY_TITLE_MAX);
export const strategyKey = (title: string): string => normalize(flat(title));

export const strategyVisible = (s: Pick<Strategy, 'deleted' | 'trashedAt'>): boolean => !s.deleted && s.trashedAt === undefined;
export const strategyTrashed = (s: Pick<Strategy, 'deleted' | 'trashedAt'>): boolean => !s.deleted && s.trashedAt !== undefined;
/** "Hora de decidir": testing and its review day has come. */
export const strategyDue = (s: Strategy, today: DayKey): boolean =>
  strategyVisible(s) && s.status === 'testando' && today >= s.reviewDay;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The strategies being tested on `today` (visible, started), the newest start first. */
export function testingStrategies(list: readonly Strategy[], today: DayKey): Strategy[] {
  return list
    .filter((s) => strategyVisible(s) && s.status === 'testando' && s.startDay <= today)
    .sort((a, b) => cmp(b.startDay, a.startDay) || b.createdAt - a.createdAt);
}

/** "Estratégia em teste: A" · "Estratégias em teste: A · B" · "Estratégias em teste: A · B · +2"; undefined for none. */
export function strategyLine(titles: readonly string[]): string | undefined {
  if (titles.length === 0) return undefined;
  const shown = titles.slice(0, STRATEGY_LINE_MAX).map(flat).join(' · ');
  const more = titles.length > STRATEGY_LINE_MAX ? ` · +${titles.length - STRATEGY_LINE_MAX}` : '';
  return `${titles.length === 1 ? 'Estratégia em teste' : 'Estratégias em teste'}: ${shown}${more}`;
}

/** The strategies being tested for the current block: linked to one of its blocks (same name) or to its journey. */
export function strategiesForBlock(
  list: readonly Strategy[], today: DayKey, blockIds: readonly ID[], journeyId?: ID,
): Strategy[] {
  return testingStrategies(list, today).filter((s) => s.link !== undefined
    && ((s.link.kind === 'block' && blockIds.includes(s.link.id)) || (s.link.kind === 'journey' && s.link.id === journeyId)));
}

/** The week's experiment from before Estratégias (read only), unless a visible strategy has the same title. */
export function legacyExperiment(experiment: string | undefined, list: readonly Strategy[]): string | undefined {
  const text = (experiment ?? '').trim();
  if (text === '') return undefined;
  const key = strategyKey(text);
  return list.some((s) => strategyVisible(s) && strategyKey(s.title) === key) ? undefined : text;
}

/** Testing strategies whose decision day has come, the oldest review day first (the Nova semana card). */
export function dueStrategies(list: readonly Strategy[], today: DayKey): Strategy[] {
  return list.filter((s) => strategyDue(s, today)).sort((a, b) => cmp(a.reviewDay, b.reviewDay) || a.createdAt - b.createdAt);
}

/** "Hora de decidir: “A” · “B”. Decidir é opcional." */
export const dueLine = (titles: readonly string[]): string =>
  `Hora de decidir: ${titles.map((t) => `“${flat(t)}”`).join(' · ')}. Decidir é opcional.`;

export interface StrategyGroup { status: StrategyStatus; title: string; items: Strategy[] }

/**
 * The list of the Estratégias screen: visible strategies by status (Testando, Mantidas, Ajustadas, Descartadas; empty
 * groups left out). Testando by review day (so "Hora de decidir" comes first), then start; the others newest decision first.
 */
export function strategyGroups(list: readonly Strategy[]): StrategyGroup[] {
  const visible = list.filter(strategyVisible);
  return STRATEGY_STATUSES
    .map((status) => ({
      status,
      title: STRATEGY_GROUP_TITLE[status],
      items: visible.filter((s) => s.status === status).sort(status === 'testando'
        ? (a, b) => cmp(a.reviewDay, b.reviewDay) || cmp(a.startDay, b.startDay) || a.createdAt - b.createdAt
        : (a, b) => cmp(b.decidedDay ?? '', a.decidedDay ?? '') || b.updatedAt - a.updatedAt),
    }))
    .filter((g) => g.items.length > 0);
}

/** "Apagadas recentemente", the last trashed first. */
export const strategyTrash = (list: readonly Strategy[]): Strategy[] =>
  list.filter(strategyTrashed).sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));

const ddmm = (day: DayKey): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** The list line under the title: "Ideia minha · desde 10/11 · decidir em 24/11" · "Padrões · desde 02/11 · mantida em 16/11". */
export function strategyMeta(s: Strategy): string {
  const source = STRATEGY_SOURCE_LABEL[s.source];
  if (s.status === 'testando') return `${source} · desde ${ddmm(s.startDay)} · decidir em ${ddmm(s.reviewDay)}`;
  return `${source} · desde ${ddmm(s.startDay)} · ${STRATEGY_DECIDED_LABEL[s.status].toLowerCase()} em ${ddmm(s.decidedDay ?? s.startDay)}`;
}

/** "Decidir depois": the new review day, a week past today (or past the review day, when that is later). */
export const postponedReview = (s: Pick<Strategy, 'reviewDay'>, today: DayKey): DayKey =>
  addDays(s.reviewDay > today ? s.reviewDay : today, STRATEGY_POSTPONE_DAYS);

/**
 * Strategies being tested at some point of [start, end]: visible, started by `end`, and still testing or decided on
 * or after `start`. Oldest start first.
 */
export function strategiesInRange(list: readonly Strategy[], range: { start: DayKey; end: DayKey }): Strategy[] {
  return list
    .filter((s) => strategyVisible(s) && s.startDay <= range.end
      && (s.status === 'testando' || (s.decidedDay !== undefined && s.decidedDay >= range.start)))
    .sort((a, b) => cmp(a.startDay, b.startDay) || a.createdAt - b.createdAt);
}

/** The Nova semana adjustment as strategy titles: one per non-blank line, in one line each, without repeats. */
export function adjustmentLines(text: string): string[] {
  const out: string[] = [];
  const keys = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = cut(raw, STRATEGY_TITLE_MAX);
    const key = strategyKey(line);
    if (line !== '' && !keys.has(key)) {
      keys.add(key);
      out.push(line);
    }
  }
  return out;
}

// ------------------------------------------------------------------ the sheet

/** What the sheet holds (texts as typed; empty = absent). */
export interface StrategyDraft {
  title: string;
  source: StrategySource;
  sourceNote: string;
  why: string;
  observe: string;
  link?: StrategyLink;
  startDay: DayKey;
  reviewDay: DayKey;
  status: StrategyStatus;
  decisionNote: string;
}

/** "Nova estratégia": Ideia minha, from today, decide in two weeks; `from` overrides. */
export const newStrategyDraft = (today: DayKey, from: Partial<StrategyDraft> = {}): StrategyDraft => ({
  title: '', source: 'ideia', sourceNote: '', why: '', observe: '', startDay: today,
  reviewDay: addDays(today, STRATEGY_REVIEW_DEFAULT), status: 'testando', decisionNote: '', ...from,
});

export const strategyDraftOf = (s: Strategy): StrategyDraft => ({
  title: s.title, source: s.source, sourceNote: s.sourceNote ?? '', why: s.why ?? '', observe: s.observe ?? '',
  ...(s.link ? { link: { kind: s.link.kind, id: s.link.id } } : {}),
  startDay: s.startDay, reviewDay: s.reviewDay, status: s.status, decisionNote: s.decisionNote ?? '',
});

/** "Testar a versão ajustada": the same title, origin, reasons and link (of a strategy or of the sheet), as a new test from today. */
export const adjustedDraft = (
  s: Pick<Strategy, 'title' | 'source' | 'sourceNote' | 'why' | 'observe' | 'link'>, today: DayKey,
): StrategyDraft => newStrategyDraft(today, {
  title: s.title, source: s.source, sourceNote: s.sourceNote ?? '', why: s.why ?? '', observe: s.observe ?? '',
  ...(s.link ? { link: { kind: s.link.kind, id: s.link.id } } : {}),
});

export type StrategyIssue = 'title' | 'start' | 'review';
export const STRATEGY_ISSUE_TEXT: Record<StrategyIssue, string> = {
  title: 'Escreva o que vai testar.',
  start: 'Escolha um dia de início até hoje.',
  review: 'O dia de decidir precisa ser depois do início.',
};

/** Why the draft cannot be saved, if anything: a title, a start up to today, a decision day after the start. */
export function strategyIssue(d: StrategyDraft, today: DayKey): StrategyIssue | undefined {
  if (flat(d.title) === '') return 'title';
  if (!isValidDayKey(d.startDay) || d.startDay > today) return 'start';
  if (!isValidDayKey(d.reviewDay) || d.reviewDay <= d.startDay) return 'review';
  return undefined;
}

/** The editable fields of a record, as stored (decidedDay is set by the rules, not typed). */
export type StrategyFields = Pick<Strategy, 'title' | 'source' | 'sourceNote' | 'why' | 'observe' | 'link' | 'startDay'
  | 'reviewDay' | 'status' | 'decisionNote'>;

/**
 * The stored form of a draft: texts in one line (the decision note only trimmed) and cut at their limits; blank
 * texts absent; the source note only for Conversa de IA and Pesquisa; the decision note only once decided.
 */
export function strategyFields(d: StrategyDraft): StrategyFields {
  const sourceNote = SOURCE_NOTE_SOURCES.includes(d.source) ? cut(d.sourceNote, STRATEGY_SOURCE_NOTE_MAX) : '';
  const why = cut(d.why, STRATEGY_TEXT_MAX);
  const observe = cut(d.observe, STRATEGY_TEXT_MAX);
  const decisionNote = d.status === 'testando' ? '' : d.decisionNote.trim().slice(0, STRATEGY_NOTE_MAX).trim();
  return {
    title: cut(d.title, STRATEGY_TITLE_MAX),
    source: d.source,
    ...(sourceNote ? { sourceNote } : {}),
    ...(why ? { why } : {}),
    ...(observe ? { observe } : {}),
    ...(d.link ? { link: { kind: d.link.kind, id: d.link.id } } : {}),
    startDay: d.startDay,
    reviewDay: d.reviewDay,
    status: d.status,
    ...(decisionNote ? { decisionNote } : {}),
  };
}

const EDITABLE: ReadonlyArray<keyof StrategyFields> = [
  'title', 'source', 'sourceNote', 'why', 'observe', 'link', 'startDay', 'reviewDay', 'status', 'decisionNote',
];
const same = (x: unknown, y: unknown): boolean => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);

/**
 * What saving `draft` over `initial` (the sheet's values when it opened) writes: only the fields that differ, so a
 * newer value of a field he did not touch (another device) is kept; a removed text or link is written as undefined.
 * A new status other than testando stamps decidedDay = today; back to testando removes decidedDay and the note.
 */
export function strategyChanges(initial: StrategyDraft, draft: StrategyDraft, today: DayKey): Partial<Strategy> {
  const a = strategyFields(initial);
  const b = strategyFields(draft);
  const out: Partial<Strategy> = {};
  for (const k of EDITABLE) {
    if (!same(a[k], b[k])) Object.assign(out, { [k]: b[k] });
  }
  if ('status' in out) {
    if (out.status === 'testando') Object.assign(out, { decidedDay: undefined, decisionNote: undefined });
    else out.decidedDay = today;
  }
  return out;
}

/** A strategy started by one tap (Padrões, the Nova semana adjustment): from today, decided in two weeks; undefined for a blank text. */
export function quickStrategy(text: string, source: StrategySource, today: DayKey): StrategyFields | undefined {
  const title = cut(text, STRATEGY_TITLE_MAX);
  if (title === '') return undefined;
  return { title, source, startDay: today, reviewDay: addDays(today, STRATEGY_REVIEW_DEFAULT), status: 'testando' };
}

/** "block:<id>" / "journey:<id>" for the link select; '' for none. */
export const strategyLinkValue = (link: StrategyLink | undefined): string => (link ? `${link.kind}:${link.id}` : '');
export function strategyLinkFrom(value: string): StrategyLink | undefined {
  const i = value.indexOf(':');
  const kind = value.slice(0, i);
  const id = value.slice(i + 1);
  return i > 0 && id !== '' && (kind === 'block' || kind === 'journey') ? { kind, id } : undefined;
}
