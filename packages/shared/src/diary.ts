import type {
  Block, BlockSession, Commitment, Concentration, DayKey, DayMode, DayPlan, DayState, DiaryEntry, DiaryLink, DiaryTheme, HHmm, ID,
  Load, MonthReview, Mood, Season, SleepLog, SleepQuality, Tiredness, TrainingLog, Week, Workout, WorkoutKind,
} from './types';
import { addDays, dayKeyOf, daysInMonth, isValidDayKey, logicalTimestamp, timestampAt, weekdayOf } from './dates';
import { weekDays } from './meals';
import { normalize } from './parser';
import { WEEKDAY_NAMES, addMonths, monthKeyOf, monthName } from './periods';
import { countedBlocksOn, weekKey } from './weekStats';
import { blocksFromPlan, commitmentsFromPlan } from './daySnapshot';
import { defaultDayMode } from './planDay';
import { sleepMinutes } from './sleep';
import { CONCENTRATION_LABEL, LOAD_LABEL, MOOD_LABEL, TIREDNESS_LABEL } from './dayClose';
import { WORKOUT_LABEL } from './workouts';
import { trainingCounts } from './training';

// Diário (2026-11-16): free-text entries by logical day and time. Pure rules: the v10 migration of the
// day-close note, the weekly timeline, search, "Registrado pelo app" and the weekly Markdown export.
// The user's words are never changed: only trimmed at the ends in the export.

// ------------------------------------------------------------------ ids and the v10 migration

/** The time a migrated day-close note gets when its day has no `closedAt`. */
export const DIARY_CLOSE_TIME: HHmm = '22:00';
export const diaryCloseId = (day: DayKey): ID => `diary-close-${day}`;

/**
 * Dexie v10: the `fechamento` entry made from a day-close note, built from the DayState alone (same id, text
 * and timestamps on every device, so two devices that migrate write identical records). None for a
 * soft-deleted DayState or a missing/blank note.
 */
export function closeNoteEntry(
  state: Pick<DayState, 'id' | 'deleted' | 'updatedAt' | 'closedAt' | 'closeNote'>,
): DiaryEntry | undefined {
  const text = state.closeNote;
  if (state.deleted || typeof text !== 'string' || text.trim() === '') return undefined;
  return {
    id: diaryCloseId(state.id), createdAt: state.updatedAt, updatedAt: state.updatedAt, deleted: false,
    day: state.id, at: state.closedAt ?? timestampAt(state.id, DIARY_CLOSE_TIME),
    kind: 'fechamento', text, themes: [], links: [], private: false,
  };
}

// ------------------------------------------------------------------ themes, links, visibility

export const DIARY_THEMES: readonly DiaryTheme[] = [
  'faculdade', 'carreira', 'projetos', 'estudo', 'saude', 'treino', 'sono',
  'relacionamentos', 'familia', 'lazer', 'sentimentos', 'ideias', 'comunicacao',
];
export const DIARY_THEME_LABEL: Record<DiaryTheme, string> = {
  faculdade: 'Faculdade', carreira: 'Carreira', projetos: 'Projetos', estudo: 'Estudo', saude: 'Saúde',
  treino: 'Treino', sono: 'Sono', relacionamentos: 'Relacionamentos', familia: 'Família', lazer: 'Lazer',
  sentimentos: 'Sentimentos', ideias: 'Ideias', comunicacao: 'Comunicação',
};
export const DIARY_LINKS_MAX = 3;
export const DIARY_LINK_LABEL: Record<DiaryLink['kind'], string> = { mission: 'missão', journey: 'jornada' };

/** `mission:01H…` — the key of a link (filters, names). */
export const linkKey = (l: DiaryLink): string => `${l.kind}:${l.id}`;
export const sameLink = (a: DiaryLink, b: DiaryLink): boolean => a.kind === b.kind && a.id === b.id;

/** In the timeline, the search and the exports: not deleted ("Apagar de vez") and not in "Apagadas recentemente". */
export const diaryVisible = (e: Pick<DiaryEntry, 'deleted' | 'trashedAt'>): boolean => !e.deleted && e.trashedAt === undefined;
/** In "Apagadas recentemente". */
export const diaryTrashed = (e: Pick<DiaryEntry, 'deleted' | 'trashedAt'>): boolean => !e.deleted && e.trashedAt !== undefined;

/** The distinct links of the visible entries, in first-seen order (newest entry first): the "Vínculo" filter. */
export function diaryLinksInUse(entries: readonly DiaryEntry[]): DiaryLink[] {
  const out: DiaryLink[] = [];
  for (const e of [...entries].filter(diaryVisible).sort((a, b) => b.at - a.at)) {
    for (const l of e.links) if (!out.some((x) => sameLink(x, l))) out.push({ kind: l.kind, id: l.id });
  }
  return out;
}

// ------------------------------------------------------------------ days and weeks

const pad2 = (n: number): string => String(n).padStart(2, '0');
const ddmm = (day: DayKey): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const fullDate = (day: DayKey): string => `${ddmm(day)}/${day.slice(0, 4)}`;
/** Local clock time of a timestamp: "21:05". */
export const diaryClock = (ts: number): HHmm => {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** Monday of the week (Monday to Sunday) containing `day`. */
export const weekOfDay = (day: DayKey): DayKey => weekKey(day);
/** "Semana 09/11–15/11". */
export const diaryWeekLabel = (monday: DayKey): string => `Semana ${ddmm(monday)}–${ddmm(addDays(monday, 6))}`;

/** "Mesma semana, mês passado": the week of the same day of the month, one month earlier (clamped to that month). */
export function sameWeekLastMonth(monday: DayKey): DayKey {
  const month = addMonths(monthKeyOf(monday), -1);
  const day = Math.min(Number(monday.slice(8, 10)), daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7))));
  return weekKey(`${month}-${pad2(day)}`);
}

/** "Terça-feira, 10/11". */
export function diaryDayTitle(day: DayKey): string {
  const name = WEEKDAY_NAMES[weekdayOf(day)]!;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}, ${ddmm(day)}`;
}

/**
 * "Mudar data e hora": `time` on logical day `day` (a time before the day start is the next calendar morning,
 * like every typed time in the app). Undefined for an invalid day or time.
 */
export function diaryMoment(day: string, time: string, dayStartHour: number): { day: DayKey; at: number } | undefined {
  if (!isValidDayKey(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return undefined;
  return { day, at: logicalTimestamp(day, time, dayStartHour) };
}

/** The first `lines` non-empty lines, cut at `max` characters with "…": the preview in lists. */
export function diaryPreview(text: string, lines = 3, max = 240): string {
  const kept = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let out = kept.slice(0, lines).join('\n');
  const more = kept.length > lines || out.length > max;
  if (out.length > max) out = out.slice(0, max).trimEnd();
  return more ? `${out}…` : out;
}

// ------------------------------------------------------------------ reviews written in a week

export interface DiaryReviewRef {
  kind: 'week' | 'month' | 'season';
  id: ID;                 // the Week id (its Monday), the MonthReview id or the Season id
  day: DayKey;            // logical day it was answered
  at: number;             // answeredAt
  title: string;          // "Nova semana" · "Reflexão de outubro" · 'Temporada "Consistência"'
  answers: Array<{ label: string; text: string }>;   // only the answered questions, in question order
}

const WEEK_ANSWERS = [['worked', 'O que funcionou'], ['obstacle', 'Maior obstáculo'], ['adjustment', 'Ajuste para testar']] as const;
const MONTH_ANSWERS = [['progress', 'Avanços'], ['obstacle', 'O que atrapalhou'], ['next', 'Para o próximo mês']] as const;
const SEASON_ANSWERS = [['progress', 'O que avançou'], ['obstacle', 'O que atrapalhou'], ['next', 'Para a próxima']] as const;

function answered<K extends string>(src: Partial<Record<K, string>>, labels: ReadonlyArray<readonly [K, string]>): DiaryReviewRef['answers'] {
  return labels.map(([k, label]) => ({ label, text: (src[k] ?? '').trim() })).filter((a) => a.text !== '');
}

/**
 * The "Nova semana" answers, the month reflections and the season reviews answered (logical day of `answeredAt`) from
 * `from` to `to` (both included), oldest first. Skipped reflections and reviews without any written answer are left out.
 */
export function reviewsBetween(input: {
  weeks: readonly Week[]; months: readonly MonthReview[]; seasons?: readonly Season[]; from: DayKey; to: DayKey; dayStartHour: number;
}): DiaryReviewRef[] {
  const dayOf = (at: number): DayKey | undefined => {
    const day = dayKeyOf(at, input.dayStartHour);
    return day >= input.from && day <= input.to ? day : undefined;
  };
  const out: DiaryReviewRef[] = [];
  for (const w of input.weeks) {
    if (w.deleted || !w.review) continue;
    const day = dayOf(w.review.answeredAt);
    const answers = answered(w.review, WEEK_ANSWERS);
    if (day && answers.length > 0) out.push({ kind: 'week', id: w.id, day, at: w.review.answeredAt, title: 'Nova semana', answers });
  }
  for (const m of input.months) {
    if (m.deleted || m.skipped || !m.answers) continue;
    const day = dayOf(m.answeredAt);
    const answers = answered(m.answers, MONTH_ANSWERS);
    if (day && answers.length > 0) {
      out.push({ kind: 'month', id: m.id, day, at: m.answeredAt, title: `Reflexão de ${monthName(m.month)}`, answers });
    }
  }
  for (const s of input.seasons ?? []) {
    if (s.deleted || !s.review) continue;
    const day = dayOf(s.review.answeredAt);
    const answers = answered(s.review, SEASON_ANSWERS);
    const title = `Temporada "${s.title.replace(/\s+/g, ' ').trim()}"`;
    if (day && answers.length > 0) out.push({ kind: 'season', id: s.id, day, at: s.review.answeredAt, title, answers });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The reviews answered in the week of `monday` (reviewsBetween Monday to Sunday). */
export function diaryReviews(input: {
  weeks: readonly Week[]; months: readonly MonthReview[]; seasons?: readonly Season[]; monday: DayKey; dayStartHour: number;
}): DiaryReviewRef[] {
  return reviewsBetween({
    weeks: input.weeks, months: input.months, seasons: input.seasons, from: input.monday, to: addDays(input.monday, 6),
    dayStartHour: input.dayStartHour,
  });
}

// ------------------------------------------------------------------ timeline and search

export interface DiaryDayGroup { day: DayKey; entries: DiaryEntry[]; reviews: DiaryReviewRef[] }

const byMoment = (a: DiaryEntry, b: DiaryEntry): number => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The week of `monday` for the timeline: one group per day with a visible entry or a review, the newest day
 * first; entries in time order. Days with nothing are left out (never "faltou").
 */
export function diaryWeek(entries: readonly DiaryEntry[], monday: DayKey, reviews: readonly DiaryReviewRef[] = []): DiaryDayGroup[] {
  const end = addDays(monday, 6);
  const groups = new Map<DayKey, DiaryDayGroup>();
  const group = (day: DayKey): DiaryDayGroup => {
    let g = groups.get(day);
    if (!g) {
      g = { day, entries: [], reviews: [] };
      groups.set(day, g);
    }
    return g;
  };
  for (const e of entries) if (diaryVisible(e) && e.day >= monday && e.day <= end) group(e.day).entries.push(e);
  for (const r of reviews) if (r.day >= monday && r.day <= end) group(r.day).reviews.push(r);
  const out = [...groups.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  for (const g of out) {
    g.entries.sort(byMoment);
    g.reviews.sort((a, b) => a.at - b.at);
  }
  return out;
}

export interface DiaryFilters { theme?: DiaryTheme; link?: DiaryLink; onlyPrivate?: boolean }

/** A search or a filter is on (the screen shows results instead of the week). */
export const diaryFiltering = (query: string, f: DiaryFilters): boolean =>
  query.trim() !== '' || f.theme !== undefined || f.link !== undefined || f.onlyPrivate === true;

/**
 * "Buscar no diário": the visible entries of every week whose text has every word of `query` (accents and
 * case ignored) and that match every filter, newest first. An empty query matches every text.
 */
export function searchDiary(entries: readonly DiaryEntry[], query: string, filters: DiaryFilters = {}): DiaryEntry[] {
  const words = normalize(query).split(/\s+/u).filter(Boolean);
  return entries
    .filter((e) => diaryVisible(e)
      && (filters.theme === undefined || e.themes.includes(filters.theme))
      && (filters.link === undefined || e.links.some((l) => sameLink(l, filters.link!)))
      && (filters.onlyPrivate !== true || e.private)
      && (words.length === 0 || words.every((w) => normalize(e.text).includes(w))))
    .sort((a, b) => byMoment(b, a));
}

// ------------------------------------------------------------------ "Registrado pelo app"

export interface DiaryAppDay {
  mode?: DayMode;
  blocks?: { started: number; planned: number };
  training?: { name?: string; exercises: number; cardioMin?: number };
  workouts?: Array<{ kind: WorkoutKind; minutes: number }>;
  sleep?: { bedAt: number; wakeAt: number; quality?: SleepQuality };
  tiredness?: Tiredness;
  mood?: Mood;
  load?: Load;
  concentration?: Concentration;
}

export interface DiaryAppInput {
  days: readonly DayKey[];
  dayStartHour: number;
  dayEndHour: number;
  dayStates: readonly DayState[];
  blocks: readonly Block[];          // archived included (past plans)
  commitments: readonly Commitment[];
  sessions: readonly BlockSession[];
  dayPlans: readonly DayPlan[];
  trainingLogs: readonly TrainingLog[];
  workouts: readonly Workout[];
  sleepLogs: readonly SleepLog[];
}

/**
 * What the app recorded on each day — only what exists (a day with nothing is left out):
 * - the day type, when the day was started or its type chosen (a live DayState with `startedAt` or `mode`);
 * - blocks started of the counted ones (the weekly review's rule, from the day's plan photo when there is one),
 *   when the day has a plan photo or a block session;
 * - the training log (exercises done or swapped, cardio), else the day's workouts;
 * - the night before (night = the previous day) with both times, and its quality;
 * - the tiredness, humor, sobrecarga and concentração of "Como foi hoje?".
 */
export function diaryAppDays(input: DiaryAppInput): Record<DayKey, DiaryAppDay> {
  const states = new Map(input.dayStates.filter((d) => !d.deleted).map((d) => [d.id, d]));
  const plans = new Map(input.dayPlans.filter((p) => !p.deleted).map((p) => [p.day, p]));
  const blocks = input.blocks.filter((b) => !b.deleted);
  const commitments = input.commitments.filter((c) => !c.deleted);
  const out: Record<DayKey, DiaryAppDay> = {};
  for (const day of input.days) {
    const state = states.get(day);
    const mode = defaultDayMode(day, state);
    const d: DiaryAppDay = {};
    if (state && (state.startedAt !== undefined || state.mode !== undefined)) d.mode = mode;
    const plan = plans.get(day);
    const sessions = input.sessions.filter((s) => !s.deleted && s.day === day);
    if (plan || sessions.length > 0) {
      const counted = countedBlocksOn({
        day, mode, dayStartedAt: state?.startedAt, dayStartHour: input.dayStartHour, dayEndHour: input.dayEndHour,
        blocks: plan ? blocksFromPlan(plan, blocks) : [...blocks],
        commitments: plan ? commitmentsFromPlan(plan, commitments, input.dayStartHour) : [...commitments],
        sessions,
      });
      if (counted.length > 0) d.blocks = { started: counted.filter((c) => c.started).length, planned: counted.length };
    }
    const log = input.trainingLogs.find((l) => !l.deleted && l.day === day);
    if (log) {
      const c = trainingCounts(log);
      const exercises = c.done + c.swapped;
      if (exercises > 0 || log.cardio) {
        d.training = {
          ...(log.planName ? { name: log.planName } : {}), exercises, ...(log.cardio ? { cardioMin: log.cardio.minutes } : {}),
        };
      }
    }
    if (!d.training) {
      const ws = input.workouts.filter((w) => !w.deleted && w.day === day).sort((a, b) => a.at - b.at);
      if (ws.length > 0) d.workouts = ws.map((w) => ({ kind: w.kind, minutes: w.minutes }));
    }
    const night = input.sleepLogs.find((l) => !l.deleted && l.night === addDays(day, -1));
    if (night && sleepMinutes(night) !== undefined) {
      d.sleep = { bedAt: night.bedAt!, wakeAt: night.wakeAt!, ...(night.quality ? { quality: night.quality } : {}) };
    }
    if (state?.tiredness) d.tiredness = state.tiredness;
    if (state?.mood) d.mood = state.mood;
    if (state?.load) d.load = state.load;
    if (state?.concentration) d.concentration = state.concentration;
    if (Object.keys(d).length > 0) out[day] = d;
  }
  return out;
}

const DAY_MODE_TEXT: Record<DayMode, string> = { normal: 'Normal', low: 'Baixa energia', recovery: 'Recuperação', free: 'Livre' };
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * "dia Normal · 4 de 5 blocos iniciados · treino: Peito e tríceps (5 exercícios feitos) · sono 23:40–07:10 (qualidade 4) ·
 * cansaço: médio · humor: ok · sobrecarga: média · concentração: boa" — only the parts that exist; undefined when nothing
 * was recorded.
 */
export function appDayLine(d: DiaryAppDay): string | undefined {
  const parts: string[] = [];
  if (d.mode) parts.push(`dia ${DAY_MODE_TEXT[d.mode]}`);
  if (d.blocks) parts.push(`${d.blocks.started} de ${count(d.blocks.planned, 'bloco iniciado', 'blocos iniciados')}`);
  if (d.training) {
    const what = [
      d.training.exercises > 0 ? count(d.training.exercises, 'exercício feito', 'exercícios feitos') : '',
      d.training.cardioMin !== undefined ? `cardio ${d.training.cardioMin} min` : '',
    ].filter(Boolean).join(', ');
    parts.push(d.training.name ? `treino: ${d.training.name} (${what})` : `treino: ${what}`);
  } else if (d.workouts && d.workouts.length > 0) {
    parts.push(`treino: ${d.workouts.map((w) => `${WORKOUT_LABEL[w.kind]} ${w.minutes} min`).join(', ')}`);
  }
  if (d.sleep) {
    parts.push(`sono ${diaryClock(d.sleep.bedAt)}–${diaryClock(d.sleep.wakeAt)}${d.sleep.quality ? ` (qualidade ${d.sleep.quality})` : ''}`);
  }
  if (d.tiredness) parts.push(`cansaço: ${TIREDNESS_LABEL[d.tiredness].toLowerCase()}`);
  if (d.mood) parts.push(`humor: ${MOOD_LABEL[d.mood].toLowerCase()}`);
  if (d.load) parts.push(`sobrecarga: ${LOAD_LABEL[d.load].toLowerCase()}`);
  if (d.concentration) parts.push(`concentração: ${CONCENTRATION_LABEL[d.concentration].toLowerCase()}`);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

// ------------------------------------------------------------------ "Exportar semana"

export interface DiaryExportOptions { includePrivate: boolean; includeApp: boolean; includeReviews: boolean }
/** The sheet's switches when it opens: private entries out, the app's records and the reviews in. */
export const DIARY_EXPORT_DEFAULTS: DiaryExportOptions = { includePrivate: false, includeApp: true, includeReviews: true };

export interface DiaryMarkdownInput {
  monday: DayKey;
  exportedOn: DayKey;                              // today's logical day
  entries: readonly DiaryEntry[];                  // any: only the visible entries of the week are used
  appDays: Readonly<Record<DayKey, DiaryAppDay>>;  // diaryAppDays of the week
  reviews: readonly DiaryReviewRef[];              // diaryReviews of the week
  linkNames: Readonly<Record<string, string>>;     // linkKey → title; a link without a name is left out
  options: DiaryExportOptions;
}

/** `diario-2026-11-09_a_2026-11-15.md`. */
export const diaryFileName = (monday: DayKey): string => `diario-${monday}_a_${addDays(monday, 6)}.md`;

/**
 * The week as Markdown (spec decision 12), days Monday → Sunday: the entries with their words untouched (only
 * trimmed at the ends), themes and links, the "Registrado pelo app" line and the reviews written that week.
 * A day appears when it has an exported entry, or a line of the app with "Registrado pelo app" on.
 */
export function diaryMarkdown(input: DiaryMarkdownInput): string {
  const { monday, options } = input;
  const sunday = addDays(monday, 6);
  const title = monday.slice(0, 4) === sunday.slice(0, 4)
    ? `# Diário — ${ddmm(monday)} a ${fullDate(sunday)}`
    : `# Diário — ${fullDate(monday)} a ${fullDate(sunday)}`;
  const out: string[] = [
    title,
    `Exportado do LIFE RPG em ${fullDate(input.exportedOn)}. As entradas são minhas palavras, sem edição.`
      + (options.includeApp ? ' "Registrado pelo app" vem dos registros do aplicativo.' : ''),
  ];
  const exported = input.entries
    .filter((e) => diaryVisible(e) && e.day >= monday && e.day <= sunday && (options.includePrivate || !e.private))
    .sort(byMoment);
  let wrote = false;
  for (const day of weekDays(monday)) {
    const entries = exported.filter((e) => e.day === day);
    const app = options.includeApp && input.appDays[day] ? appDayLine(input.appDays[day]) : undefined;
    if (entries.length === 0 && !app) continue;
    wrote = true;
    out.push('', `## ${diaryDayTitle(day)}`);
    entries.forEach((e, i) => {
      if (i > 0) out.push('');
      const tags = (e.kind === 'fechamento' ? ' · fechamento do dia' : '') + (e.private ? ' · privada' : '');
      out.push(`### ${diaryClock(e.at)}${tags}`, e.text.trim());
      const named = e.links.flatMap((l) => {
        const name = input.linkNames[linkKey(l)];
        return name ? [`${DIARY_LINK_LABEL[l.kind]} "${name}"`] : [];
      });
      const meta = [
        e.themes.length > 0 ? `Temas: ${e.themes.map((t) => DIARY_THEME_LABEL[t]).join(', ')}` : '',
        named.length > 0 ? `Ligado a: ${named.join(', ')}` : '',
      ].filter(Boolean).join(' · ');
      if (meta) out.push('', `_${meta}_`);
    });
    if (app) out.push('', `**Registrado pelo app:** ${app}`);
  }
  const reviews = options.includeReviews ? input.reviews.filter((r) => r.day >= monday && r.day <= sunday) : [];
  if (reviews.length > 0) {
    wrote = true;
    out.push('', '## Revisões escritas nesta semana');
    reviews.forEach((r, i) => {
      if (i > 0) out.push('');
      out.push(`### ${r.title} (respondida em ${ddmm(r.day)})`, ...r.answers.map((a) => `- ${a.label}: ${a.text}`));
    });
  }
  if (!wrote) out.push('', 'Sem registros nesta semana.');
  return `${out.join('\n')}\n`;
}
