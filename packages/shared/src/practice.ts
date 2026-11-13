import { isValidDayKey } from './dates';
import type {
  BaseRecord, DayKey, BlockKind, ChecklistItem, CodeLang, DayMode, FeedbackSource, ID, PracticeError, PracticeFeedback,
  PracticeRatings, PracticeRebuild, PracticeScore, PracticeSession, PracticeStep,
} from './types';

// Prática técnica (Marco 3d, spec §4). Pure: ids and times come in as arguments.

export const PRACTICE_STEPS: ReadonlyArray<{ key: PracticeStep; label: string }> = [
  { key: 'problem', label: 'Problema' },
  { key: 'basics', label: 'Fundamentos' },
  { key: 'plan', label: 'Decompor' },
  { key: 'design', label: 'Decisões' },
  { key: 'code', label: 'Implementar' },
  { key: 'test', label: 'Testar' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'rebuild', label: 'Reconstruir' },
  { key: 'close', label: 'Fechar' },
];

export const PRACTICE_LIMITS = {
  title: 80, text: 2000, item: 300, items: 30, code: 20000, errors: 50, errorField: 500,
  feedback: 20, feedbackText: 1000, explanation: 600, nextAction: 200,
} as const;

export const PRACTICE_XP = 10;
export const PRACTICE_REBUILD_XP = 5;
export const PRACTICE_DAILY_SESSIONS = 3;

const STEP_KEYS: PracticeStep[] = PRACTICE_STEPS.map((s) => s.key);
const LANGS: readonly CodeLang[] = ['python', 'sql', 'javascript', 'bash', 'text'];
const SOURCES: readonly FeedbackSource[] = ['person', 'ai', 'tool'];

const filled = (s: string | undefined): boolean => typeof s === 'string' && s.trim() !== '';
const anyItem = (xs: readonly ChecklistItem[]): boolean => xs.some((x) => filled(x.text));
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const isScore = (v: unknown): v is PracticeScore => v === 0 || v === 1 || v === 2;

// ------------------------------------------------------------------ steps

export const isPracticeStep = (v: unknown): v is PracticeStep => typeof v === 'string' && (STEP_KEYS as string[]).includes(v);
export const stepLabel = (step: PracticeStep): string => PRACTICE_STEPS.find((s) => s.key === step)?.label ?? '';

export function nextStep(step: PracticeStep): PracticeStep | undefined {
  const i = STEP_KEYS.indexOf(step);
  return i < 0 ? undefined : STEP_KEYS[i + 1];
}

export function prevStep(step: PracticeStep): PracticeStep | undefined {
  const i = STEP_KEYS.indexOf(step);
  return i > 0 ? STEP_KEYS[i - 1] : undefined;
}

export const practiceSketchId = (id: ID): ID => `sketch-p-${id}`;

// ------------------------------------------------------------------ creating and cleaning

export function cleanPracticeTitle(t: string): string {
  return t.replace(/\s+/g, ' ').trim().slice(0, PRACTICE_LIMITS.title);
}

export interface NewPracticeInput { title: string; journeyId?: ID; missionId?: ID; deckId?: ID }

export function newPracticeFields(input: NewPracticeInput): Omit<PracticeSession, keyof BaseRecord> {
  return {
    title: cleanPracticeTitle(input.title), status: 'open', step: 'problem',
    ...(input.journeyId ? { journeyId: input.journeyId } : {}),
    ...(input.missionId ? { missionId: input.missionId } : {}),
    ...(input.deckId ? { deckId: input.deckId } : {}),
    problem: '', inputs: '', outputs: '', basics: [], plan: [], alternatives: '', decision: '',
    language: 'python', code: '', tests: [], feedback: [], errors: [], ratings: {}, explanation: '',
  };
}

export type PracticePatch = Partial<Pick<PracticeSession,
  'title' | 'step' | 'journeyId' | 'missionId' | 'deckId' | 'problem' | 'inputs' | 'outputs' | 'alternatives'
  | 'decision' | 'language' | 'code' | 'explanation' | 'nextAction'>>;

const TEXT_KEYS = ['problem', 'inputs', 'outputs', 'alternatives', 'decision'] as const;

/** Limits of spec §4.2. Code keeps its spaces; a blank title leaves the patch (the old one stays). */
export function sanitizePracticePatch(p: PracticePatch): PracticePatch {
  const out: PracticePatch = { ...p };
  if ('title' in p) {
    const title = cleanPracticeTitle(p.title ?? '');
    if (title) out.title = title;
    else delete out.title;
  }
  for (const k of TEXT_KEYS) {
    const v = p[k];
    if (typeof v === 'string') out[k] = v.slice(0, PRACTICE_LIMITS.text);
  }
  if (typeof p.code === 'string') out.code = p.code.slice(0, PRACTICE_LIMITS.code);
  if (typeof p.explanation === 'string') out.explanation = p.explanation.slice(0, PRACTICE_LIMITS.explanation);
  if ('nextAction' in p) out.nextAction = (p.nextAction ?? '').trim().slice(0, PRACTICE_LIMITS.nextAction) || undefined;
  if ('step' in p && !isPracticeStep(p.step)) delete out.step;
  if ('language' in p && !LANGS.includes(p.language as CodeLang)) delete out.language;
  return out;
}

export function cleanItems(items: readonly ChecklistItem[]): ChecklistItem[] {
  return items
    .map((x) => ({ ...x, text: x.text.trim().slice(0, PRACTICE_LIMITS.item) }))
    .filter((x) => x.text !== '')
    .slice(0, PRACTICE_LIMITS.items);
}

export const listOps = {
  add(items: readonly ChecklistItem[], text: string, id: ID): ChecklistItem[] {
    const t = text.trim();
    return t ? [...items, { id, text: t, done: false }] : [...items];
  },
  set(items: readonly ChecklistItem[], id: ID, changes: Partial<Pick<ChecklistItem, 'text' | 'done'>>): ChecklistItem[] {
    return items.map((x) => (x.id === id ? { ...x, ...changes } : x));
  },
  remove(items: readonly ChecklistItem[], id: ID): ChecklistItem[] {
    return items.filter((x) => x.id !== id);
  },
  moveUp(items: readonly ChecklistItem[], id: ID): ChecklistItem[] {
    const out = [...items];
    const i = out.findIndex((x) => x.id === id);
    if (i > 0) [out[i - 1], out[i]] = [out[i]!, out[i - 1]!];
    return out;
  },
};

export function cleanErrorFields(e: { what: string; why: string; fix: string }): { what: string; why: string; fix: string } {
  const clip = (s: string): string => s.trim().slice(0, PRACTICE_LIMITS.errorField);
  return { what: clip(e.what), why: clip(e.why), fix: clip(e.fix) };
}

const isItem = (x: unknown): x is ChecklistItem =>
  !!x && typeof x === 'object' && typeof (x as ChecklistItem).id === 'string' && typeof (x as ChecklistItem).text === 'string';
const items = (v: unknown): ChecklistItem[] =>
  (Array.isArray(v) ? v.filter(isItem).map((x) => ({ id: x.id, text: x.text, done: x.done === true })) : []);

/** A valid Marco 7 hint reference, or undefined (bad data from sync or import is dropped). */
function hintOf(v: unknown, source: unknown): PracticeFeedback['hint'] {
  if (source !== 'ai' || !v || typeof v !== 'object') return undefined;
  const h = v as { step?: unknown; level?: unknown };
  return isPracticeStep(h.step) && (h.level === 1 || h.level === 2 || h.level === 3)
    ? { step: h.step, level: h.level }
    : undefined;
}

/** Fills missing or broken fields (sync, import): the screen never breaks on outside data. */
export function normalizePractice(s: PracticeSession): PracticeSession {
  const raw = s as unknown as Record<string, unknown>;
  const r = (raw.ratings && typeof raw.ratings === 'object' ? raw.ratings : {}) as Record<string, unknown>;
  const ratings: PracticeRatings = {};
  for (const k of ['delivered', 'understood', 'autonomous'] as const) {
    const v = r[k];
    if (isScore(v)) ratings[k] = v;
  }
  const errors = (Array.isArray(raw.errors) ? raw.errors : [])
    .filter((e): e is PracticeError => !!e && typeof e === 'object'
      && typeof (e as PracticeError).id === 'string' && typeof (e as PracticeError).what === 'string')
    .map((e) => ({ ...e, at: typeof e.at === 'number' ? e.at : 0, why: str(e.why), fix: str(e.fix) }));
  const feedback = (Array.isArray(raw.feedback) ? raw.feedback : [])
    .filter((f): f is PracticeFeedback => !!f && typeof f === 'object'
      && typeof (f as PracticeFeedback).id === 'string' && typeof (f as PracticeFeedback).text === 'string')
    .map((f) => {
      const { hint: rawHint, ...rest } = f;
      const hint = hintOf(rawHint, f.source);
      return {
        ...rest,
        at: typeof f.at === 'number' ? f.at : 0,
        source: SOURCES.includes(f.source) ? f.source : 'person',
        ...(hint ? { hint } : {}),
      };
    });
  const rb = raw.rebuild as Partial<PracticeRebuild> | undefined;
  const out: PracticeSession = {
    ...s,
    title: cleanPracticeTitle(str(raw.title)),
    status: raw.status === 'done' ? 'done' : 'open',
    step: isPracticeStep(raw.step) ? raw.step : 'problem',
    problem: str(raw.problem), inputs: str(raw.inputs), outputs: str(raw.outputs),
    basics: items(raw.basics), plan: items(raw.plan), tests: items(raw.tests),
    alternatives: str(raw.alternatives), decision: str(raw.decision),
    language: LANGS.includes(raw.language as CodeLang) ? (raw.language as CodeLang) : 'python',
    code: str(raw.code), feedback, errors, ratings, explanation: str(raw.explanation),
  };
  // Optional fields: a wrong type (sync, import) is dropped rather than carried into `.trim()` and friends.
  if (typeof raw.nextAction !== 'string') delete out.nextAction;
  if (typeof raw.endedAt !== 'number') delete out.endedAt;
  for (const k of ['journeyId', 'missionId', 'deckId'] as const) {
    if (typeof raw[k] !== 'string' || raw[k] === '') delete out[k];
  }
  // Retest (ajustes da pesquisa, P2): the origin and the first day it is offered.
  if (typeof raw.retestOf !== 'string' || raw.retestOf === '') delete out.retestOf;
  if (typeof raw.availableFrom !== 'string' || !isValidDayKey(raw.availableFrom)) delete out.availableFrom;
  if (rb && typeof rb === 'object' && typeof rb.startedAt === 'number') {
    out.rebuild = { ...rb, code: str(rb.code), startedAt: rb.startedAt } as PracticeRebuild;
  } else delete out.rebuild;
  return out;
}

// ------------------------------------------------------------------ progress and resuming

export function stepFilled(s: PracticeSession, step: PracticeStep): boolean {
  switch (step) {
    case 'problem': return filled(s.problem);
    case 'basics': return anyItem(s.basics);
    case 'plan': return anyItem(s.plan);
    case 'design': return filled(s.alternatives) || filled(s.decision);
    case 'code': return filled(s.code);
    case 'test': return anyItem(s.tests);
    case 'feedback': return s.feedback.length > 0;
    case 'rebuild': return s.rebuild?.comparedAt !== undefined;
    case 'close': return s.status === 'done';
  }
}

/** First action suggested when pausing (spec §4.3): the first rule that applies. */
export function resumeSuggestion(s: PracticeSession): string {
  if (!filled(s.problem)) return 'Escrever o problema em uma frase';
  const plan = s.plan.filter((x) => filled(x.text));
  if (plan.length === 0) return 'Decompor o problema em passos';
  const open = plan.find((x) => !x.done);
  if (open) return `Continuar: ${open.text.trim()}`.slice(0, PRACTICE_LIMITS.nextAction);
  if (!filled(s.code)) return 'Implementar o primeiro passo';
  if (!anyItem(s.tests)) return 'Escrever um caso de teste';
  if (s.rebuild?.comparedAt === undefined) return 'Reconstruir sem consultar';
  return '';
}

export function codeLines(code: string): number {
  return code.split('\n').filter((l) => l.trim() !== '').length;
}

const linesLabel = (n: number): string => `${n} ${n === 1 ? 'linha' : 'linhas'}`;

/** The line above "Autônomo" (spec §4.3). */
export function rebuildFact(s: Pick<PracticeSession, 'rebuild'>): string {
  const rb = s.rebuild;
  if (!rb) return 'Reconstrução: não feita nesta sessão.';
  const base = rb.comparedAt === undefined
    ? 'Reconstrução: começada, ainda sem comparar.'
    : `Reconstrução: feita, ${linesLabel(codeLines(rb.code))}, comparada.`;
  return rb.peeked ? `${base} Você olhou a implementação durante a reconstrução.` : base;
}

/** "24 linhas na reconstrução, 31 na implementação." */
export function compareFact(s: Pick<PracticeSession, 'rebuild' | 'code'>): string {
  return `${linesLabel(codeLines(s.rebuild?.code ?? ''))} na reconstrução, ${codeLines(s.code)} na implementação.`;
}

// ------------------------------------------------------------------ indicators and history

export type IndicatorKey = keyof PracticeRatings;
export interface Indicator { key: IndicatorKey; label: string; question: string; options: readonly [string, string, string] }

export const INDICATORS: readonly Indicator[] = [
  { key: 'delivered', label: 'Entregue', question: 'A funcionalidade ficou pronta?', options: ['Não', 'Parcial', 'Sim'] },
  { key: 'understood', label: 'Compreendido', question: 'Consigo explicar com minhas palavras', options: ['Ainda não', 'Em parte', 'Sim'] },
  { key: 'autonomous', label: 'Autônomo', question: 'Reconstruí sem consultar', options: ['Não', 'Com consulta', 'Sim'] },
];

export function ratingsComplete(r: PracticeRatings): r is Required<PracticeRatings> {
  return isScore(r.delivered) && isScore(r.understood) && isScore(r.autonomous);
}

/** "Pistas: N" (P7): hints asked in the app (AI feedback with a hint). Observed data, never a score. */
export const hintCount = (s: Pick<PracticeSession, 'feedback'>): number =>
  s.feedback.filter((f) => f.source === 'ai' && f.hint).length;

export function ratingsLine(r: PracticeRatings): string {
  return INDICATORS.map((i) => {
    const v = r[i.key];
    return `${i.label}: ${isScore(v) ? i.options[v].toLowerCase() : '—'}`;
  }).join(' · ');
}

export interface IndicatorSeries { key: IndicatorKey; label: string; values: PracticeScore[]; summary: string }
export interface PracticeHistory { count: number; series: IndicatorSeries[] }

/** "Nível máximo em 3 das últimas 5 · nas 5 anteriores: 1": counts of the top level, never an average. */
export function seriesSummary(values: readonly PracticeScore[]): string {
  if (values.length < 2) return '';
  const top = (xs: readonly PracticeScore[]): number => xs.filter((v) => v === 2).length;
  const last = values.slice(-5);
  const prev = values.slice(-10, -5);
  const head = `Nível máximo em ${top(last)} das últimas ${last.length}`;
  return prev.length === 5 ? `${head} · nas 5 anteriores: ${top(prev)}` : head;
}

/** The last `limit` closed sessions with all three ratings, oldest first. */
export function historySessions(sessions: readonly PracticeSession[], limit = 10): PracticeSession[] {
  return sessions
    .filter((s) => !s.deleted && s.status === 'done' && typeof s.endedAt === 'number' && ratingsComplete(s.ratings))
    .sort((a, b) => a.endedAt! - b.endedAt!)
    .slice(-limit);
}

/** One series per indicator over `historySessions`. */
export function practiceHistory(sessions: readonly PracticeSession[], limit = 10): PracticeHistory {
  const done = historySessions(sessions, limit);
  return {
    count: done.length,
    series: INDICATORS.map(({ key, label }) => {
      const values = done.map((s) => s.ratings[key]!);
      return { key, label, values, summary: seriesSummary(values) };
    }),
  };
}

// ------------------------------------------------------------------ errors and XP

export function errorCardDraft(e: Pick<PracticeError, 'what' | 'why' | 'fix'>): { front: string; back: string; extra?: string } {
  const why = e.why.trim();
  return { front: `Erro: ${e.what.trim()}\n\nQual é a ideia correta?`, back: e.fix.trim(), ...(why ? { extra: why } : {}) };
}

/** A retest copies the problem and the code, so it also needs its own rebuild code. */
export const earnsPracticeXp = (s: Pick<PracticeSession, 'problem' | 'code' | 'retestOf' | 'rebuild'>): boolean =>
  filled(s.problem) && filled(s.code) && (!s.retestOf || filled(s.rebuild?.code));
export const earnsRebuildXp = (s: Pick<PracticeSession, 'code' | 'rebuild'>): boolean => filled(s.code) && filled(s.rebuild?.code);

const PRACTICE_PREFIX = 'xp-practice-';
const REBUILD_PREFIX = 'xp-practice-rebuild-';
export const practiceXpId = (id: ID): string => `${PRACTICE_PREFIX}${id}`;
export const rebuildXpId = (id: ID): string => `${REBUILD_PREFIX}${id}`;

export function practiceXpSession(xpId: string): ID | undefined {
  if (xpId.startsWith(REBUILD_PREFIX)) return xpId.slice(REBUILD_PREFIX.length) || undefined;
  if (xpId.startsWith(PRACTICE_PREFIX)) return xpId.slice(PRACTICE_PREFIX.length) || undefined;
  return undefined;
}

/** At most PRACTICE_DAILY_SESSIONS sessions earn practice XP per logical day; one that already did may earn the other award. */
export function practiceXpAllowed(todayIds: readonly string[], sessionId: ID): boolean {
  const sessions = new Set(todayIds.map(practiceXpSession).filter((x): x is ID => x !== undefined));
  return sessions.has(sessionId) || sessions.size < PRACTICE_DAILY_SESSIONS;
}

// ------------------------------------------------------------------ Agora

export type PracticePromptResult = { kind: 'resume'; session: PracticeSession } | { kind: 'start'; firstAction?: string };

/** The Agora line (spec §4.6): only in focus/study blocks, never on free or recovery days. */
export function practicePrompt(p: {
  mode: DayMode; block?: { kind: BlockKind; journeyId?: ID }; sessions: readonly PracticeSession[]; today?: DayKey;
}): PracticePromptResult | undefined {
  const { block } = p;
  if (!block || (block.kind !== 'focus' && block.kind !== 'study')) return undefined;
  if (p.mode === 'free' || p.mode === 'recovery') return undefined;
  // A retest scheduled for a later day stays out of the line until its day (ajustes da pesquisa, P2).
  const mine = p.sessions.filter((s) => !s.deleted && (s.journeyId || undefined) === (block.journeyId || undefined)
    && !(s.availableFrom && (!p.today || s.availableFrom > p.today)));
  const open = mine.filter((s) => s.status === 'open').sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (open) return { kind: 'resume', session: open };
  const last = mine.filter((s) => s.status === 'done').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
  const firstAction = last?.nextAction?.trim();
  return firstAction ? { kind: 'start', firstAction } : { kind: 'start' };
}
