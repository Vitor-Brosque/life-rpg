import type { DayKey, DiaryEntry, DiaryTheme, ID } from './types';
import { addDays, diffDays, isValidDayKey, weekdayOf } from './dates';
import { weekKey } from './weekStats';
import { monthEnd, monthKeyOf, monthName, monthStart, type MonthKey } from './periods';
import {
  DIARY_LINK_LABEL, DIARY_THEMES, DIARY_THEME_LABEL, diaryClock, diaryDayTitle, diaryVisible, linkKey, type DiaryReviewRef,
} from './diary';

// Relatórios para IAs (2026-11-23): the model of a report (theme, sections, period, diary and health choices),
// the period rules, which diary entries go in, the text helpers and the Markdown of each part. Built by rules
// from what was recorded: nothing is invented, his words are never changed (only trimmed, and whitespace
// collapsed in one-line lists), and a section without data says so without a number.

// ------------------------------------------------------------------ themes and sections

export type ReportTheme = 'geral' | 'aprendizagem' | 'habitos' | 'saude' | 'comunicacao' | 'personalizado';
export const REPORT_THEMES: readonly ReportTheme[] = ['geral', 'aprendizagem', 'habitos', 'saude', 'comunicacao', 'personalizado'];
export const REPORT_THEME_LABEL: Record<ReportTheme, string> = {
  geral: 'Geral', aprendizagem: 'Aprendizagem', habitos: 'Hábitos e comportamento', saude: 'Saúde',
  comunicacao: 'Comunicação oral', personalizado: 'Personalizado',
};

/** The sections a report can have, in the order they appear (the Diário goes between Prática de fala and Revisões). */
export type ReportSection = 'visao' | 'execucao' | 'aprendizagem' | 'materias' | 'habitos' | 'adiamentos' | 'saude' | 'fala' | 'revisoes';
export const REPORT_SECTIONS: readonly ReportSection[] = [
  'visao', 'execucao', 'aprendizagem', 'materias', 'habitos', 'adiamentos', 'saude', 'fala', 'revisoes',
];
export const REPORT_SECTION_TITLE: Record<ReportSection, string> = {
  visao: 'Visão geral', execucao: 'Execução', aprendizagem: 'Aprendizagem', materias: 'Matérias', habitos: 'Hábitos',
  adiamentos: 'Adiamentos e travas', saude: 'Saúde', fala: 'Prática de fala', revisoes: 'Revisões',
};

/** Each theme is a fixed subset of sections (Prática de fala is in Comunicação oral and Personalizado, not in Geral). */
export const THEME_SECTIONS: Record<Exclude<ReportTheme, 'personalizado'>, readonly ReportSection[]> = {
  geral: ['visao', 'execucao', 'aprendizagem', 'materias', 'habitos', 'adiamentos', 'saude', 'revisoes'],
  aprendizagem: ['execucao', 'aprendizagem', 'materias'],
  habitos: ['execucao', 'habitos', 'adiamentos'],
  saude: ['saude'],
  comunicacao: ['fala'],
};

// ------------------------------------------------------------------ options

export type ReportDiaryChoice = 'nenhuma' | 'tema' | 'escolher' | 'todas';
export const REPORT_DIARY_CHOICES: readonly ReportDiaryChoice[] = ['nenhuma', 'tema', 'escolher', 'todas'];
export const REPORT_DIARY_LABEL: Record<ReportDiaryChoice, string> = {
  nenhuma: 'Nenhuma', tema: 'Do tema', escolher: 'Escolher', todas: 'Todas',
};

export interface ReportHealth { sono: boolean; treino: boolean; estado: boolean }
export const REPORT_HEALTH_KEYS: readonly (keyof ReportHealth)[] = ['sono', 'treino', 'estado'];
export const REPORT_HEALTH_LABEL: Record<keyof ReportHealth, string> = { sono: 'Sono', treino: 'Treino', estado: 'Estado do dia' };

export interface ReportOptions {
  theme: ReportTheme;
  sections: readonly ReportSection[];   // the chosen sections; used only by 'personalizado'
  diary: ReportDiaryChoice;
  chosen: readonly ID[];                // 'escolher': the ticked entries
  includePrivate: boolean;              // "Incluir entradas privadas" (any diary choice)
  health: ReportHealth;                 // used only when the report has the Saúde section
}

/** The screen's choices on every visit: Geral, the diary "Do tema", private entries out, every health type in. */
export const REPORT_DEFAULTS: ReportOptions = {
  theme: 'geral', sections: THEME_SECTIONS.geral, diary: 'tema', chosen: [], includePrivate: false,
  health: { sono: true, treino: true, estado: true },
};

/** The report's sections, in REPORT_SECTIONS order (the Diário is added by the diary choice). */
export function reportSectionsOf(o: Pick<ReportOptions, 'theme' | 'sections'>): ReportSection[] {
  const chosen = o.theme === 'personalizado' ? o.sections : THEME_SECTIONS[o.theme];
  return REPORT_SECTIONS.filter((s) => chosen.includes(s));
}

// ------------------------------------------------------------------ periods

export type ReportPeriodKind = 'semana' | 'mes' | 'personalizado';
export const REPORT_PERIOD_KINDS: readonly ReportPeriodKind[] = ['semana', 'mes', 'personalizado'];
export const REPORT_PERIOD_LABEL: Record<ReportPeriodKind, string> = { semana: 'Semana', mes: 'Mês', personalizado: 'Personalizado' };
/** A week (Monday to Sunday), a calendar month or two chosen dates; `end` may be after today (week or month in progress). */
export interface ReportPeriod { kind: ReportPeriodKind; start: DayKey; end: DayKey }
/** The days the report reads: the period cut at today (`clamped` when it was cut). */
export interface ReportRange { start: DayKey; end: DayKey; clamped: boolean }

export const REPORT_CUSTOM_MAX_DAYS = 92;

/** The week the screen opens on: the last complete week on Monday and Tuesday, else the current week (its Monday). */
export function defaultReportWeek(today: DayKey): DayKey {
  const wd = weekdayOf(today);
  return wd === 1 || wd === 2 ? addDays(weekKey(today), -7) : weekKey(today);
}

export const reportWeekPeriod = (monday: DayKey): ReportPeriod => ({ kind: 'semana', start: monday, end: addDays(monday, 6) });
export const reportMonthPeriod = (month: MonthKey): ReportPeriod => ({ kind: 'mes', start: monthStart(month), end: monthEnd(month) });
export const reportCustomPeriod = (start: DayKey, end: DayKey): ReportPeriod => ({ kind: 'personalizado', start, end });

export type CustomIssue = 'missing' | 'order' | 'future' | 'long';
export const CUSTOM_ISSUE_TEXT: Record<CustomIssue, string> = {
  missing: 'Escolha as duas datas.',
  order: 'A data final precisa ser igual ou depois da inicial.',
  future: 'Escolha datas até hoje.',
  long: 'Escolha um período de até 92 dias.',
};

/** What is wrong with two typed dates for "Personalizado", if anything (both included, up to today, at most 92 days). */
export function customPeriodIssue(start: string, end: string, today: DayKey): CustomIssue | undefined {
  if (!isValidDayKey(start) || !isValidDayKey(end)) return 'missing';
  if (end < start) return 'order';
  if (end > today) return 'future';
  if (diffDays(start, end) + 1 > REPORT_CUSTOM_MAX_DAYS) return 'long';
  return undefined;
}

/** The period cut at today (a period that starts after today becomes today alone). */
export function reportRange(p: Pick<ReportPeriod, 'start' | 'end'>, today: DayKey): ReportRange {
  const end = p.end > today ? today : p.end;
  return { start: p.start > end ? end : p.start, end, clamped: end !== p.end };
}

// ------------------------------------------------------------------ text helpers (also used by reportSections.ts)

const pad2 = (n: number): string => String(n).padStart(2, '0');
export const REPORT_WEEKDAY_ABBR = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "10/11". */
export const reportDay = (day: DayKey): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
/** "10/11/2026". */
export const reportDate = (day: DayKey): string => `${reportDay(day)}/${day.slice(0, 4)}`;
/** "ter 10/11". */
export const reportShortDay = (day: DayKey): string => `${REPORT_WEEKDAY_ABBR[weekdayOf(day)]} ${reportDay(day)}`;
/** 20 → "20 min", 60 → "1h", 90 → "1h30", 65 → "1h05" (the app's duration format). */
export function reportDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h}h` : `${h}h${pad2(m % 60)}`;
}
/** 0.844 → "84%". */
export const reportPct = (x: number): string => `${Math.round(x * 100)}%`;
/** 2.25 → "2,3" (one decimal, comma). */
export const reportDecimal = (x: number): string => x.toFixed(1).replace('.', ',');
/** "1 sessão" / "3 sessões". */
export const reportCount = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
/** Lists longer than this become the first items and "e mais N". */
export const REPORT_LIST_MAX = 8;
/** "a · b · c", or the first 8 and "e mais N". */
export function reportList(items: readonly string[]): string {
  const shown = items.slice(0, REPORT_LIST_MAX);
  return items.length > REPORT_LIST_MAX ? `${shown.join(' · ')} · e mais ${items.length - REPORT_LIST_MAX}` : shown.join(' · ');
}
/** His words in one line, between quotes: only the whitespace is collapsed. */
export const reportQuote = (text: string): string => `"${text.replace(/\s+/g, ' ').trim()}"`;
/** `Lead: "his words".` — no second full stop when his words already end a sentence. */
export function reportSaid(lead: string, text: string): string {
  const quoted = reportQuote(text);
  return `${lead}: ${quoted}${/[.!?…]"$/.test(quoted) ? '' : '.'}`;
}
/** "outubro de 2026" (the title of a month report). */
export const reportMonthLabel = (month: MonthKey): string => `${monthName(month)} de ${month.slice(0, 4)}`;
/** "Outubro de 2026" (the screen's month navigation). */
export function reportMonthTitle(month: MonthKey): string {
  const label = reportMonthLabel(month);
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

/** "09/11 a 15/11/2026" · "novembro de 2026", with " (até hoje, 18/11)" when the period was cut at today. */
export function reportPeriodLabel(p: ReportPeriod, today: DayKey): string {
  const range = reportRange(p, today);
  const base = p.kind === 'mes'
    ? reportMonthLabel(monthKeyOf(p.start))
    : p.start.slice(0, 4) === p.end.slice(0, 4)
      ? `${reportDay(p.start)} a ${reportDate(p.end)}`
      : `${reportDate(p.start)} a ${reportDate(p.end)}`;
  return range.clamped ? `${base} (até hoje, ${reportDay(range.end)})` : base;
}

/** `relatorio-geral-2026-11-09_a_2026-11-15.md` (the days read). */
export const reportFileName = (theme: ReportTheme, range: Pick<ReportRange, 'start' | 'end'>): string =>
  `relatorio-${theme}-${range.start}_a_${range.end}.md`;

// ------------------------------------------------------------------ which diary entries go in

export interface ReportDiaryMatch { themes: readonly DiaryTheme[]; missionLinks: boolean }
const NO_MATCH: ReportDiaryMatch = { themes: [], missionLinks: false };
/** "Do tema" of each theme (Geral: every entry). */
const THEME_DIARY: Record<Exclude<ReportTheme, 'geral' | 'personalizado'>, ReportDiaryMatch> = {
  aprendizagem: { themes: ['estudo', 'faculdade', 'carreira', 'projetos'], missionLinks: false },
  habitos: { themes: ['sentimentos', 'ideias'], missionLinks: true },
  saude: { themes: ['saude', 'treino', 'sono'], missionLinks: false },
  comunicacao: { themes: ['comunicacao'], missionLinks: false },
};
/** "Do tema" of Personalizado: what the chosen sections bring. */
const SECTION_DIARY: Record<ReportSection, ReportDiaryMatch> = {
  visao: NO_MATCH,
  execucao: { themes: [], missionLinks: true },
  aprendizagem: { themes: ['estudo', 'faculdade', 'carreira', 'projetos'], missionLinks: false },
  materias: { themes: ['estudo', 'faculdade'], missionLinks: false },
  habitos: { themes: ['sentimentos', 'ideias'], missionLinks: true },
  adiamentos: { themes: ['sentimentos', 'ideias'], missionLinks: true },
  saude: { themes: ['saude', 'treino', 'sono'], missionLinks: false },
  fala: { themes: ['comunicacao'], missionLinks: false },
  revisoes: NO_MATCH,
};

/** The diary themes (and mission links) of "Do tema"; 'all' for Geral. */
export function reportDiaryMatch(o: Pick<ReportOptions, 'theme' | 'sections'>): ReportDiaryMatch | 'all' {
  if (o.theme === 'geral') return 'all';
  if (o.theme !== 'personalizado') return THEME_DIARY[o.theme];
  const sections = reportSectionsOf(o);
  return {
    themes: DIARY_THEMES.filter((t) => sections.some((s) => SECTION_DIARY[s].themes.includes(t))),
    missionLinks: sections.some((s) => SECTION_DIARY[s].missionLinks),
  };
}

const byMoment = (a: DiaryEntry, b: DiaryEntry): number => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The period's entries that may go in (the "Escolher" list): visible, in the range, private only with the switch; by time. */
export function reportDiaryCandidates(
  entries: readonly DiaryEntry[], range: Pick<ReportRange, 'start' | 'end'>, includePrivate: boolean,
): DiaryEntry[] {
  return entries
    .filter((e) => diaryVisible(e) && e.day >= range.start && e.day <= range.end && (includePrivate || !e.private))
    .sort(byMoment);
}

/** The entries the report carries, by time: none, those of the theme, the ticked ones, or all (private only with the switch). */
export function reportDiaryEntries(
  entries: readonly DiaryEntry[], range: Pick<ReportRange, 'start' | 'end'>, o: ReportOptions,
): DiaryEntry[] {
  if (o.diary === 'nenhuma') return [];
  const pool = reportDiaryCandidates(entries, range, o.includePrivate);
  if (o.diary === 'todas') return pool;
  if (o.diary === 'escolher') return pool.filter((e) => o.chosen.includes(e.id));
  const match = reportDiaryMatch(o);
  if (match === 'all') return pool;
  return pool.filter((e) => e.themes.some((t) => match.themes.includes(t))
    || (match.missionLinks && e.links.some((l) => l.kind === 'mission')));
}

// ------------------------------------------------------------------ Markdown of the parts

export const REPORT_NOTE = 'Fatos vêm dos registros do app; percepções são minhas palavras; ausência de dado não é fracasso; '
  + 'interpretações são hipóteses.';

/** "# Relatório — Geral — 09/11 a 15/11/2026", the export day and the fixed note. */
export function reportHeader(theme: ReportTheme, period: ReportPeriod, today: DayKey): string[] {
  return [
    `# Relatório — ${REPORT_THEME_LABEL[theme]} — ${reportPeriodLabel(period, today)}`,
    `Exportado do LIFE RPG em ${reportDate(today)}.`,
    REPORT_NOTE,
  ];
}

/** One section's four parts, each a list of whole sentences; an empty part is left out. */
export interface ReportBlock {
  facts: string[];      // Registrado: what the app recorded (taps, counts, titles)
  mine: string[];       // Minhas percepções: his own words
  missing: string[];    // Sem dados: what was not recorded (never a failure)
  ideas: string[];      // Para investigar: Padrões' rules, labelled as interpretation
}

/** A section with nothing recorded: only the "Sem dados" line (no number). */
export const reportEmpty = (line: string): ReportBlock => ({ facts: [], mine: [], missing: [line], ideas: [] });

export const SPEECH_NONE = 'Ainda não há prática de fala registrada.';

/** "## Title" and the non-empty parts; "Minhas percepções" keeps the first 8 and "E mais N.". */
export function renderReportBlock(title: string, b: ReportBlock): string[] {
  const mine = b.mine.length > REPORT_LIST_MAX
    ? [...b.mine.slice(0, REPORT_LIST_MAX), `E mais ${b.mine.length - REPORT_LIST_MAX}.`]
    : b.mine;
  const parts: Array<[string, readonly string[]]> = [
    ['Registrado', b.facts],
    ['Minhas percepções', mine],
    ['Sem dados', b.missing],
    ['Para investigar (interpretação, não conclusão)', b.ideas],
  ];
  const out = ['', `## ${title}`];
  let first = true;
  for (const [label, lines] of parts) {
    if (lines.length === 0) continue;
    if (!first) out.push('');
    first = false;
    out.push(`**${label}:**`, ...lines.map((l) => `- ${l}`));
  }
  return out;
}

/** "## Diário": the entries verbatim (only trimmed at the ends), by time, with themes and named links. */
export function renderReportDiary(entries: readonly DiaryEntry[], linkNames: Readonly<Record<string, string>>): string[] {
  const out = ['', '## Diário'];
  if (entries.length === 0) return [...out, '**Sem dados:**', '- Nenhuma entrada do diário para este relatório.'];
  out.push('**Minhas percepções:** entradas do diário, com as minhas palavras, sem edição.');
  for (const e of entries) {
    const tags = (e.kind === 'fechamento' ? ' · fechamento do dia' : '') + (e.private ? ' · privada' : '');
    out.push('', `### ${diaryDayTitle(e.day)} · ${diaryClock(e.at)}${tags}`, e.text.trim());
    const themes = e.themes.flatMap((t) => (DIARY_THEME_LABEL[t] ? [DIARY_THEME_LABEL[t]] : []));
    const named = e.links.flatMap((l) => {
      const name = linkNames[linkKey(l)];
      return name ? [`${DIARY_LINK_LABEL[l.kind]} "${name}"`] : [];
    });
    const meta = [
      themes.length > 0 ? `Temas: ${themes.join(', ')}` : '',
      named.length > 0 ? `Ligado a: ${named.join(', ')}` : '',
    ].filter(Boolean).join(' · ');
    if (meta) out.push('', `_${meta}_`);
  }
  return out;
}

/** "## Revisões": the Nova semana answers, the month reflections and the season reviews answered in the period, in his words. */
export function renderReportReviews(refs: readonly DiaryReviewRef[]): string[] {
  const out = ['', '## Revisões'];
  if (refs.length === 0) return [...out, '**Sem dados:**', '- Nenhuma revisão escrita neste período.'];
  out.push('**Minhas percepções:** respostas da Nova semana, da reflexão do mês e da revisão da temporada, com as minhas palavras.');
  for (const r of refs) {
    out.push('', `### ${r.title} (respondida em ${reportDay(r.day)})`, ...r.answers.map((a) => `- ${a.label}: ${a.text}`));
  }
  return out;
}
