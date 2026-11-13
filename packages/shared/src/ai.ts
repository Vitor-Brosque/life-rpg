import type {
  AiSettings, ChecklistItem, CodeLang, DayKey, HintLevel, Note, PracticeFeedback, PracticeSession, PracticeStep,
} from './types';
import { clozeNumbers, numberClozes, stripCloze } from './cloze';
import { addDays } from './dates';
import { PRACTICE_STEPS, stepLabel } from './practice';

// Marco 7 — optional AI (spec §4). Builds what is sent (the server sends it, the web shows it in
// "O que é enviado") and cleans what comes back. Pure: no DOM, no clock, no SDK.

export const AI_FEATURES = ['hints', 'cards', 'weekly'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const DEFAULT_AI: AiSettings = { hints: false, cards: false, weekly: false };

export function aiSettingsOf(s?: { ai?: Partial<AiSettings> }): AiSettings {
  const raw = s?.ai && typeof s.ai === 'object' ? (s.ai as Record<string, unknown>) : {};
  const out = { ...DEFAULT_AI };
  for (const k of AI_FEATURES) out[k] = raw[k] === true;
  return out;
}

export const AI_LIMITS = {
  dailyDefault: 30,
  hintText: 1000,
  hintCodeLines: 2,
  cardsSource: 8000,
  deckName: 80,
  cardsMax: 5,
  cardField: 1000,
  cardExtra: 500,
  weekFacts: 20,
  weekFactField: 80,
  weekReading: 1000,
  weekField: 400,
} as const;

export const AI_SERVER_ERRORS = [
  'ai_disabled', 'invalid_body', 'daily_limit', 'busy', 'timeout', 'rate_limited',
  'refused', 'incomplete', 'auth', 'billing', 'upstream', 'bad_output',
] as const;
export type AiServerError = (typeof AI_SERVER_ERRORS)[number];
export const isAiServerError = (v: unknown): v is AiServerError =>
  typeof v === 'string' && (AI_SERVER_ERRORS as readonly string[]).includes(v);

export interface AiUsage { used: number; limit: number }
export type AiStatusResponse = { available: false } | ({ available: true } & AiUsage);
export interface AiOk<T> { result: T; usage: AiUsage }

export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1); // never split a surrogate pair
  const space = cut.search(/\s\S*$/);
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// ------------------------------------------------------------------ hints

export const HINT_STEPS = ['problem', 'basics', 'plan', 'design', 'code', 'test', 'rebuild'] as const;
export type HintStep = (typeof HINT_STEPS)[number];
export const isHintStep = (s: string): s is HintStep => (HINT_STEPS as readonly string[]).includes(s);
export const isHintLevel = (v: unknown): v is HintLevel => v === 1 || v === 2 || v === 3;
export const HINT_LEVEL_LABEL: Record<HintLevel, string> = { 1: 'pergunta', 2: 'direção', 3: 'próximo passo' };
export const HINT_CODE_OMITTED = '[trecho de código omitido: a pista não entrega a solução]';

export interface HintItem { text: string; done: boolean }
export interface HintRequest {
  step: HintStep;
  level: HintLevel;
  title: string;
  problem: string;
  inputs: string;
  outputs: string;
  basics: string[];
  plan: HintItem[];
  alternatives: string;
  decision: string;
  tests: HintItem[];
  language: CodeLang;
  code: string;
  previous: Array<{ level: HintLevel; text: string }>;
}
export interface HintResult { text: string }

export function hintsForStep(s: Pick<PracticeSession, 'feedback'>, step: PracticeStep): PracticeFeedback[] {
  return s.feedback
    .filter((f) => f.source === 'ai' && f.hint?.step === step)
    .sort((a, b) => a.hint!.level - b.hint!.level || a.at - b.at);
}

export function nextHintLevel(hints: PracticeFeedback[]): HintLevel | undefined {
  const max = Math.max(0, ...hints.map((h) => h.hint?.level ?? 0));
  return max >= 3 ? undefined : ((max + 1) as HintLevel);
}

export type HintState =
  | { kind: 'hidden' }
  | { kind: 'paused' }
  | { kind: 'ready'; hints: PracticeFeedback[]; next?: HintLevel };

export function hintStepState(s: PracticeSession, step: PracticeStep): HintState {
  if (!isHintStep(step)) return { kind: 'hidden' };
  const rb = s.rebuild;
  if (step === 'rebuild' && (!rb || rb.comparedAt !== undefined)) return { kind: 'hidden' };
  if ((step === 'code' || step === 'test') && rb && rb.comparedAt === undefined && !rb.peeked) return { kind: 'paused' };
  const hints = hintsForStep(s, step);
  return { kind: 'ready', hints, next: nextHintLevel(hints) };
}

const items = (list: ChecklistItem[]): HintItem[] =>
  list.map((i) => ({ text: i.text.trim(), done: i.done })).filter((i) => i.text !== '');

export function hintRequestOf(s: PracticeSession, step: HintStep, level: HintLevel): HintRequest {
  const paused = (step === 'code' || step === 'test') && hintStepState(s, step).kind === 'paused';
  const raw = paused ? '' : step === 'code' || step === 'test' ? s.code : step === 'rebuild' ? (s.rebuild?.code ?? '') : '';
  return {
    step,
    level,
    title: s.title.trim(),
    problem: s.problem.trim(),
    inputs: s.inputs.trim(),
    outputs: s.outputs.trim(),
    basics: s.basics.map((b) => b.text.trim()).filter((t) => t !== ''),
    plan: items(s.plan),
    alternatives: s.alternatives.trim(),
    decision: s.decision.trim(),
    tests: items(s.tests),
    language: s.language,
    code: raw.replace(/^\s*\n/, '').replace(/\s+$/, ''),
    // Only the latest hint of each earlier level: a duplicate must never fill the request.
    previous: ([1, 2] as const)
      .filter((l) => l < level)
      .flatMap((l) => {
        const h = hintsForStep(s, step).filter((x) => x.hint!.level === l).at(-1);
        return h ? [{ level: l, text: h.text }] : [];
      }),
  };
}

const LANG_NAME: Record<CodeLang, string> = { python: 'Python', sql: 'SQL', javascript: 'JavaScript', bash: 'Bash', text: 'Texto' };
const FENCE_LANG: Record<CodeLang, string> = { python: 'python', sql: 'sql', javascript: 'javascript', bash: 'bash', text: '' };
const stepTitle = (step: PracticeStep): string =>
  `${PRACTICE_STEPS.findIndex((x) => x.key === step) + 1}. ${stepLabel(step)}`;

export function hintPrompt(r: HintRequest): { context: string; ask: string } {
  const out = [
    `Sessão de prática: ${r.title || '(sem título)'}`,
    `Passo atual: ${stepTitle(r.step)}`,
    `Linguagem: ${LANG_NAME[r.language]}`,
  ];
  const section = (title: string, body: string): void => { if (body) out.push('', `## ${title}`, body); };
  section('Problema', [r.problem, r.inputs && `Entradas: ${r.inputs}`, r.outputs && `Saídas: ${r.outputs}`].filter(Boolean).join('\n'));
  section('Conceitos', r.basics.map((b) => `- ${b}`).join('\n'));
  section('Passos da decomposição', r.plan.map((p, i) => `${i + 1}. [${p.done ? 'x' : ' '}] ${p.text}`).join('\n'));
  section('Alternativas consideradas', r.alternatives);
  section('Decisão', r.decision);
  section('Casos de teste', r.tests.map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}`).join('\n'));
  if (r.code.trim() && (r.step === 'code' || r.step === 'test' || r.step === 'rebuild')) {
    const fence = r.code.includes('```') ? '````' : '```';
    section(
      r.step === 'rebuild' ? 'Reconstrução (escrita de memória, sem consultar)' : 'Código da implementação',
      `${fence}${FENCE_LANG[r.language]}\n${r.code}\n${fence}`,
    );
  }
  const previous = r.previous.map((p) => `Pista ${p.level} (${HINT_LEVEL_LABEL[p.level]}): ${p.text}`);
  const ask = [
    ...(previous.length ? ['Pistas que ele já recebeu neste passo:', ...previous, ''] : []),
    `Dê agora a pista ${r.level} (${HINT_LEVEL_LABEL[r.level]}) sobre o passo "${stepLabel(r.step)}".`,
  ].join('\n');
  return { context: `<sessao>\n${out.join('\n')}\n</sessao>`, ask };
}

export const hintPreview = (r: HintRequest): string => {
  const p = hintPrompt(r);
  return `${p.context}\n\n${p.ask}`;
};

const OPEN_RE = /^ {0,3}(`{3,}[^`]*|~{3,}.*)$/;
/** An indented code line: 4+ spaces or a tab, at any depth (blank lines are handled apart). */
const INDENT_RE = /^(?: {4}|\t)/;

/** Index of the line closing the fence opened at `from`, or -1. */
function fenceCloser(lines: string[], from: number): number {
  const open = lines[from]!.trim();
  const ch = open[0]!;
  const len = open.match(ch === '`' ? /^`+/ : /^~+/)![0].length;
  for (let k = from + 1; k < lines.length; k++) {
    const m = lines[k]!.match(/^ {0,3}(`+|~+)[ \t]*$/);
    if (m && m[1]![0] === ch && m[1]!.length >= len) return k;
  }
  return -1;
}

/** Index of the line where a fence is still open at the end of the text, or -1. */
function openFenceStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (!OPEN_RE.test(lines[i]!)) continue;
    const c = fenceCloser(lines, i);
    if (c === -1) return i;
    i = c;
  }
  return -1;
}

export function cleanHint(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').trim().split('\n');
  const out: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    const code = run.filter((l) => l.trim() !== '').length; // blank lines inside a block don't count
    if (code >= 3) out.push(HINT_CODE_OMITTED); else out.push(...run);
    run = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (OPEN_RE.test(line)) {
      flush();
      const c = fenceCloser(lines, i);
      if (c === -1) { out.push(HINT_CODE_OMITTED); break; } // unclosed: drop it and everything after
      const body = lines.slice(i + 1, c);
      if (body.filter((l) => l.trim() !== '').length > AI_LIMITS.hintCodeLines) out.push(HINT_CODE_OMITTED);
      else out.push(...lines.slice(i, c + 1));
      i = c;
    } else if (line.trim() !== '' && INDENT_RE.test(line)) run.push(line);
    else if (line.trim() === '' && run.length > 0) run.push(line); // a blank line keeps an indented block together
    else { flush(); out.push(line); }
  }
  flush();
  let t = clip(out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), AI_LIMITS.hintText);
  // The clip may fall inside a kept short fence: drop that fence.
  const ls = (t.endsWith('…') ? t.slice(0, -1) : t).split('\n');
  const open = openFenceStart(ls);
  if (open !== -1) t = ls.slice(0, open).join('\n').trimEnd();
  return t;
}

// ------------------------------------------------------------------ card suggestions

export type SuggestionType = 'basic' | 'cloze';
export interface CardSuggestion { type: SuggestionType; front: string; back: string; extra: string }
export interface CardsRequest { text: string; deckName: string }
export interface CardsResult { cards: CardSuggestion[] }
export interface SuggestionErrors { front?: string; back?: string }

export function cardsPrompt(r: CardsRequest): string {
  return `Baralho: ${r.deckName.trim() || 'Caixa de entrada'}\n\n<texto>\n${r.text.trim()}\n</texto>\n\nProponha os cards.`;
}

export function suggestionErrors(s: CardSuggestion): SuggestionErrors {
  const e: SuggestionErrors = {};
  const front = s.front.trim();
  if (!front) e.front = s.type === 'cloze' ? 'Escreva o texto.' : 'Escreva a pergunta.';
  else if (s.type === 'cloze' && clozeNumbers(front).length === 0) e.front = 'Marque ao menos uma lacuna.';
  if (s.type === 'basic' && !s.back.trim()) e.back = 'Escreva a resposta.';
  return e;
}

export function cleanSuggestions(raw: unknown): CardSuggestion[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { cards?: unknown }).cards)
    ? (raw as { cards: unknown[] }).cards : [];
  const out: CardSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const t = o.type;
    if (t !== 'basic' && t !== 'cloze') continue;
    const type: SuggestionType = t;
    const front = type === 'cloze' ? numberClozes(str(o.front).trim()) : str(o.front).trim();
    const back = type === 'cloze' ? '' : str(o.back).trim();
    const extraRaw = str(o.extra).trim();
    if (front.length > AI_LIMITS.cardField || back.length > AI_LIMITS.cardField) continue;
    const s: CardSuggestion = { type, front, back, extra: extraRaw.length > AI_LIMITS.cardExtra ? '' : extraRaw };
    if (Object.keys(suggestionErrors(s)).length > 0) continue;
    const key = stripCloze(front).toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length === AI_LIMITS.cardsMax) break;
  }
  return out;
}

export function noteSourceText(n: Pick<Note, 'type' | 'front' | 'back' | 'extra' | 'language'>): string {
  const parts = n.type === 'cloze' ? [stripCloze(n.front)]
    : n.type === 'code' ? [n.front, n.back.trim() ? `\`\`\`${n.language ?? 'python'}\n${n.back.replace(/\s+$/, '')}\n\`\`\`` : '']
    : [n.front, n.back];
  return [...parts, n.extra ?? ''].map((p) => p.trim()).filter((p) => p !== '').join('\n\n').slice(0, AI_LIMITS.cardsSource);
}

// ------------------------------------------------------------------ weekly summary

export interface WeekFact { label: string; value: string }
export interface WeekReading { worked: string; obstacle: string; adjustment: string }
export interface WeekRequest { weekStart: DayKey; facts: WeekFact[]; reading?: WeekReading }
export interface WeekSummary { observed: string; hypothesis: string; suggestion: string }

export const hasReading = (r?: WeekReading): boolean =>
  !!r && [r.worked, r.obstacle, r.adjustment].some((v) => v.trim() !== '');

const ddmm = (d: DayKey): string => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function weekPrompt(r: WeekRequest): string {
  const lines = [
    `Semana de ${ddmm(r.weekStart)} a ${ddmm(addDays(r.weekStart, 6))} (segunda a domingo). Sábado e domingo são de descanso.`,
    '',
    'Números observados pelo app:',
    ...r.facts.map((f) => `- ${f.label.trim()}: ${f.value.trim()}`),
  ];
  const rd = r.reading;
  if (rd && hasReading(rd)) {
    const rows: Array<[string, string]> = [
      ['O que funcionou', rd.worked], ['Maior obstáculo', rd.obstacle], ['Ajuste que quer testar', rd.adjustment],
    ];
    lines.push('', 'Leitura do próprio estudante:', ...rows.filter(([, v]) => v.trim()).map(([k, v]) => `- ${k}: ${v.trim()}`));
  }
  return `<semana>\n${lines.join('\n')}\n</semana>\n\nEscreva o resumo.`;
}

export function cleanWeekSummary(raw: unknown): WeekSummary | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const f = (v: unknown): string => clip(str(v).replace(/\s+/g, ' ').trim(), AI_LIMITS.weekField);
  const s: WeekSummary = { observed: f(o.observed), hypothesis: f(o.hypothesis), suggestion: f(o.suggestion) };
  return s.observed ? s : undefined;
}
