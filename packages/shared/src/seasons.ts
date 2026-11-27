import type { DayKey, Goal, Season, SeasonFocus, SeasonLink, SeasonReview, Strategy } from './types';
import { addDays, isValidDayKey } from './dates';
import type { Period } from './periods';
import { atypicalWeekSet, dayIndex, trendPoints, type DayIndex, type PatternData } from './trends';
import { weekKey } from './weekStats';

// Temporadas (2026-11-23): 6–8 usual weeks with one or two focus lines, a start, a middle and an optional review at the
// end, instead of a fixed 24-week program. Atypical weeks are left out of the count, so an atypical week never makes
// the season look late: the planned end moves one week. Rules only; nothing here reads or writes the database.

export const SEASON_WEEKS: readonly number[] = [6, 7, 8];
export const SEASON_WEEKS_DEFAULT = 6;
export const SEASON_WEEKS_LABEL: Record<number, string> = { 6: '6 semanas', 7: '7 semanas', 8: '8 semanas' };
export const SEASON_TITLE_MAX = 80;
export const SEASON_FOCUS_MAX = 2;
export const SEASON_FOCUS_TEXT_MAX = 140;

export type SeasonAnswers = Omit<SeasonReview, 'answeredAt'>;
export const SEASON_QUESTIONS: ReadonlyArray<{ key: keyof SeasonAnswers; label: string }> = [
  { key: 'progress', label: 'O que avançou?' },
  { key: 'obstacle', label: 'O que atrapalhou?' },
  { key: 'next', label: 'O que levar para a próxima?' },
];

/** The text in one line: whitespace collapsed, ends trimmed. */
const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();
const cut = (text: string, max: number): string => flat(text).slice(0, max).trim();
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The active season: one at a time; if the sync brought two, the latest start (then the newest created). */
export function activeSeason(list: readonly Season[]): Season | undefined {
  return list
    .filter((s) => !s.deleted && s.status === 'ativa')
    .sort((a, b) => cmp(b.startDay, a.startDay) || b.createdAt - a.createdAt)[0];
}

// ------------------------------------------------------------------ the weeks

export interface SeasonWeek {
  /** This week's number, counting only the usual weeks from the start week (this one included when usual). */
  number: number;
  planned: number;
  /** This week is marked atypical: it does not count. */
  atypicalNow: boolean;
  /** Atypical weeks from the start week to this week, this one included. */
  skipped: number;
  /** Monday of the last planned week: the plannedWeeks-th usual week (atypical weeks marked ahead push it too). */
  lastWeek: DayKey;
  /** This week comes after the last planned one. */
  over: boolean;
  /** From the last planned week on: "Rever temporada" is offered. */
  reviewDue: boolean;
}

/** Weeks walked at most, past the planned ones, looking for the last planned week. */
const MAX_SKIPPED = 52;

/** Where the season is on `today`, with `atypical` the Mondays of the atypical weeks (atypicalWeekSet). */
export function seasonWeek(
  s: Pick<Season, 'startDay' | 'plannedWeeks'>, atypical: ReadonlySet<DayKey>, today: DayKey,
): SeasonWeek {
  const first = weekKey(s.startDay);
  const now = weekKey(today);
  let number = 0;
  let skipped = 0;
  for (let m = first; m <= now; m = addDays(m, 7)) {
    if (atypical.has(m)) skipped += 1;
    else number += 1;
  }
  let lastWeek = first;
  let usual = 0;
  for (let i = 0, m = first; i < s.plannedWeeks + MAX_SKIPPED; i++, m = addDays(m, 7)) {
    if (atypical.has(m)) continue;
    usual += 1;
    lastWeek = m;
    if (usual === s.plannedWeeks) break;
  }
  return {
    number, planned: s.plannedWeeks, atypicalNow: atypical.has(now), skipped, lastWeek,
    over: now > lastWeek, reviewDue: now >= lastWeek,
  };
}

/** "Temporada: Consistência · semana 3 de 6" (also in the weeks 5–8 notice); never "7 de 6". */
export function seasonLine(s: Pick<Season, 'title'>, w: SeasonWeek): string {
  const head = `Temporada: ${flat(s.title)}`;
  if (w.over) return `${head} · as ${w.planned} semanas planejadas terminaram`;
  if (w.atypicalNow) return `${head} · semana atípica, fora da conta`;
  return `${head} · semana ${w.number} de ${w.planned}`;
}

/** "1 semana atípica ficou fora da conta."; undefined without one. */
export function seasonSkippedNote(w: Pick<SeasonWeek, 'skipped'>): string | undefined {
  if (w.skipped === 0) return undefined;
  return w.skipped === 1 ? '1 semana atípica ficou fora da conta.' : `${w.skipped} semanas atípicas ficaram fora da conta.`;
}

// ------------------------------------------------------------------ the review's observed numbers

export interface SeasonObserved {
  /** The days read: from the start to yesterday, or to the end day when it came before. `to < from` = nothing yet. */
  from: DayKey;
  to: DayKey;
  /** Usual weeks with some day read. */
  weeks: number;
  /** Atypical weeks left out. */
  skipped: number;
  /** Only what happened (no zero, no "0 de N"), in this order. */
  lines: Array<{ label: string; value: string }>;
}

/** The season's numbers from Padrões' trend rules (trendPoints), over its usual weeks only, up to yesterday. */
export function seasonObserved(
  data: PatternData, s: Pick<Season, 'startDay' | 'endedDay'>, idx: DayIndex = dayIndex(data),
): SeasonObserved {
  const yesterday = addDays(data.today, -1);
  const to = s.endedDay !== undefined && s.endedDay < yesterday ? s.endedDay : yesterday;
  const from = s.startDay;
  const atypical = atypicalWeekSet(data.weeks);
  const periods: Period[] = [];
  let skipped = 0;
  if (to >= from) {
    for (let m = weekKey(from); m <= to; m = addDays(m, 7)) {
      if (atypical.has(m)) {
        skipped += 1;
        continue;
      }
      const sunday = addDays(m, 6);
      periods.push({ kind: 'week', key: m, start: m < from ? from : m, end: sunday > to ? to : sunday, label: '' });
    }
  }
  const t = { planned: 0, started: 0, minimum: 0, workdays: 0, active: 0, resumptions: 0, reviews: 0, practice: 0, workouts: 0, escapes: 0 };
  for (const p of trendPoints(data, periods, idx)) {
    t.planned += p.blocksPlanned;
    t.started += p.blocksStarted;
    t.minimum += p.minimumUsed;
    t.workdays += p.workdays;
    t.active += p.activeWorkdays;
    t.resumptions += p.resumptions;
    t.reviews += p.reviews;
    t.practice += p.practiceClosed;
    t.workouts += p.workouts;
    t.escapes += p.escapes;
  }
  const lines: SeasonObserved['lines'] = [];
  if (t.started > 0) {
    lines.push({ label: 'Blocos iniciados', value: `${t.started} de ${t.planned}${t.minimum > 0 ? ` (versão mínima em ${t.minimum})` : ''}` });
  }
  if (t.active > 0) lines.push({ label: 'Dias úteis ativos', value: `${t.active} de ${t.workdays}` });
  if (t.resumptions > 0) lines.push({ label: 'Retomadas', value: String(t.resumptions) });
  if (t.reviews > 0) lines.push({ label: 'Cards revisados', value: String(t.reviews) });
  if (t.practice > 0) lines.push({ label: 'Práticas encerradas', value: String(t.practice) });
  if (t.workouts > 0) lines.push({ label: 'Treinos', value: String(t.workouts) });
  if (t.escapes > 0) lines.push({ label: 'Escapei', value: `${t.escapes}×` });
  return { from, to, weeks: periods.length, skipped, lines };
}

// ------------------------------------------------------------------ focus lines

/** "goal:<id>" / "strategy:<id>" for the link select; '' for none. */
export const seasonLinkValue = (link: SeasonLink | undefined): string => (link ? `${link.kind}:${link.id}` : '');
export function seasonLinkFrom(value: string): SeasonLink | undefined {
  const i = value.indexOf(':');
  const kind = value.slice(0, i);
  const id = value.slice(i + 1);
  return i > 0 && id !== '' && (kind === 'goal' || kind === 'strategy') ? { kind, id } : undefined;
}

export interface SeasonNames { goals: readonly Goal[]; strategies: readonly Strategy[] }

/** A focus line as shown: his words, the linked goal or strategy, or both ("words · name"); undefined when nothing is left. */
export function seasonFocusText(f: SeasonFocus, names: SeasonNames): string | undefined {
  const text = f.text ? flat(f.text) : '';
  const target = f.link?.kind === 'goal'
    ? names.goals.find((g) => g.id === f.link!.id && !g.deleted)?.title
    : f.link?.kind === 'strategy'
      ? names.strategies.find((s) => s.id === f.link!.id && !s.deleted && s.trashedAt === undefined)?.title
      : undefined;
  const name = target ? flat(target) : '';
  if (text && name) return `${text} · ${name}`;
  return text || name || undefined;
}

export const seasonFocusTexts = (s: Pick<Season, 'focus'>, names: SeasonNames): string[] =>
  s.focus.flatMap((f) => {
    const t = seasonFocusText(f, names);
    return t ? [t] : [];
  });

/** Live seasons that overlap [start, end] (an active one runs until today), by start. */
export function seasonsInRange(list: readonly Season[], range: { start: DayKey; end: DayKey }, today: DayKey): Season[] {
  return list
    .filter((s) => !s.deleted && s.startDay <= range.end && (s.endedDay ?? today) >= range.start)
    .sort((a, b) => cmp(a.startDay, b.startDay) || a.createdAt - b.createdAt);
}

// ------------------------------------------------------------------ the sheet

export interface SeasonFocusDraft { text: string; link?: SeasonLink }
/** What the sheet holds: always SEASON_FOCUS_MAX focus rows (blank ones are not stored). */
export interface SeasonDraft { title: string; focus: SeasonFocusDraft[]; startDay: DayKey; plannedWeeks: number }

const blankFocus = (): SeasonFocusDraft => ({ text: '' });

export const newSeasonDraft = (today: DayKey): SeasonDraft => ({
  title: '', focus: Array.from({ length: SEASON_FOCUS_MAX }, blankFocus), startDay: today, plannedWeeks: SEASON_WEEKS_DEFAULT,
});

export function seasonDraftOf(s: Season): SeasonDraft {
  const focus: SeasonFocusDraft[] = s.focus.slice(0, SEASON_FOCUS_MAX).map((f) => ({
    text: f.text ?? '', ...(f.link ? { link: { kind: f.link.kind, id: f.link.id } } : {}),
  }));
  while (focus.length < SEASON_FOCUS_MAX) focus.push(blankFocus());
  return { title: s.title, focus, startDay: s.startDay, plannedWeeks: s.plannedWeeks };
}

export type SeasonIssue = 'title' | 'start';
export const SEASON_ISSUE_TEXT: Record<SeasonIssue, string> = {
  title: 'Dê um nome à temporada.',
  start: 'Escolha um dia de início até hoje.',
};

/** Why the draft cannot be saved, if anything: a name and a start up to today. */
export function seasonIssue(d: SeasonDraft, today: DayKey): SeasonIssue | undefined {
  if (flat(d.title) === '') return 'title';
  if (!isValidDayKey(d.startDay) || d.startDay > today) return 'start';
  return undefined;
}

export type SeasonFields = Pick<Season, 'title' | 'focus' | 'startDay' | 'plannedWeeks'>;

/** The stored form: the name and focus texts in one line, cut; a focus row with neither text nor link is dropped. */
export function seasonFields(d: SeasonDraft): SeasonFields {
  const focus = d.focus.slice(0, SEASON_FOCUS_MAX).flatMap((f): SeasonFocus[] => {
    const text = cut(f.text, SEASON_FOCUS_TEXT_MAX);
    if (!text && !f.link) return [];
    return [{ ...(text ? { text } : {}), ...(f.link ? { link: { kind: f.link.kind, id: f.link.id } } : {}) }];
  });
  return {
    title: cut(d.title, SEASON_TITLE_MAX), focus, startDay: d.startDay,
    plannedWeeks: SEASON_WEEKS.includes(d.plannedWeeks) ? d.plannedWeeks : SEASON_WEEKS_DEFAULT,
  };
}

const SEASON_EDITABLE: ReadonlyArray<keyof SeasonFields> = ['title', 'focus', 'startDay', 'plannedWeeks'];
const same = (x: unknown, y: unknown): boolean => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);

/** Only the fields that differ from `initial` (the sheet when it opened). */
export function seasonChanges(initial: SeasonDraft, draft: SeasonDraft): Partial<Season> {
  const a = seasonFields(initial);
  const b = seasonFields(draft);
  const out: Partial<Season> = {};
  for (const k of SEASON_EDITABLE) if (!same(a[k], b[k])) Object.assign(out, { [k]: b[k] });
  return out;
}

/** The answers as stored (trimmed, line breaks kept), or undefined when all three were left blank. */
export function seasonReviewOf(a: SeasonAnswers, at: number): SeasonReview | undefined {
  const r = { progress: a.progress.trim(), obstacle: a.obstacle.trim(), next: a.next.trim() };
  return r.progress || r.obstacle || r.next ? { ...r, answeredAt: at } : undefined;
}
