import type {
  Area, AssessmentKind, Commitment, DayKey, Deck, Energy, HHmm, ID, Journey, Mission, ParsedCapture, Recurrence,
} from '@life/shared';
import { addDays, assessmentKindOf, formatHHmm, nextOccurrence, parseCapture, parseHHmm } from '@life/shared';
import { resolveArea } from '../../domain/missionActions';
import { matchJourney } from '../../domain/routineDefaults';
import { isCardCapture } from '../../domain/studyActions';

// Screen state of the "+" (escrever e tocar). Pure: nothing here reads or writes the database.

export type CaptureKind = 'tarefa' | 'compromisso' | 'avaliacao' | 'card';
export type When = { kind: 'none' } | { kind: 'day'; day: DayKey };
/** `null` = "Nenhuma"; `newName` = "Nova jornada: …" (created only by Salvar). */
export type JourneyChoice = { id: ID } | { newName: string } | null;

export interface TaskFields {
  when?: When;
  recurrence?: Recurrence | null;
  journey?: JourneyChoice;
  areaId?: ID | null;
  durationMin?: number | null;
  energy?: Energy | null;
  important?: boolean;
}
export interface CommitmentFields { day?: DayKey; start?: HHmm; end?: HHmm; weekdays?: number[]; until?: DayKey; remind?: boolean }
export interface AssessmentFields { kind?: AssessmentKind; journeyId?: ID; date?: DayKey }
export interface CardFields { deckId?: ID | null }

export interface CaptureSections { task: TaskFields; commitment: CommitmentFields; assessment: AssessmentFields; card: CardFields }
export type Section = keyof CaptureSections;
/** "task.when", "commitment.start"…: the option rows the user tapped. */
export type TouchKey = { [S in Section]: `${S}.${keyof CaptureSections[S] & string}` }[Section];

export interface CaptureState {
  /** Meaningful only when `kindTouched`; otherwise the kind comes from the text (see `kindOf`). */
  kind: CaptureKind;
  kindTouched: boolean;
  text: string;
  touched: ReadonlySet<TouchKey>;
  task: TaskFields;
  commitment: CommitmentFields;
  assessment: AssessmentFields;
  card: CardFields;
}

export interface CaptureCtx {
  today: DayKey;
  /** The day the "+" was opened with ("+ Missão neste dia"). */
  defaultDate?: DayKey;
  /** Live journeys (any status: matching skips archived ones, as `matchJourney` does). */
  journeys: Journey[];
  /** Live, non-archived areas. */
  areas: Area[];
  /** Live, non-archived decks. */
  decks: Deck[];
}

export interface FilledTask {
  when: When; recurrence: Recurrence | null; journey: JourneyChoice; areaId: ID | null;
  durationMin: number | null; energy: Energy | null; important: boolean;
}
export interface FilledCommitment { day?: DayKey; start?: HHmm; end?: HHmm; weekdays: number[]; until?: DayKey; remind: boolean }
export interface FilledAssessment { kind: AssessmentKind; journeyId?: ID; date?: DayKey }

/** What the rows show: tapped values, else what the text says, else the defaults. */
export interface CaptureView {
  kind: CaptureKind;
  lines: string[];
  task: FilledTask;
  commitment: FilledCommitment;
  assessment: FilledAssessment;
  card: { deckId: ID | null };
}

export type CaptureRequest =
  | { type: 'mission'; fields: Partial<Mission> & { title: string; important: boolean }; newJourneyName?: string }
  | { type: 'commitment'; fields: Partial<Commitment> & { title: string; date: DayKey; start: HHmm; remind: boolean } }
  | { type: 'assessment'; input: { kind: AssessmentKind; journeyId: ID; date: DayKey; content?: string } }
  | { type: 'card'; front: string; deckId?: ID };

export const KINDS: CaptureKind[] = ['tarefa', 'compromisso', 'avaliacao', 'card'];
export const KIND_LABEL: Record<CaptureKind, string> = {
  tarefa: 'Tarefa', compromisso: 'Compromisso', avaliacao: 'Prova ou trabalho', card: 'Card',
};

/** Texts of the `role="alert"` shown when Salvar cannot save yet. */
export const MISSING = {
  text: 'Escreva o que precisa fazer.',
  commitment: 'Escolha o dia e o início.',
  commitmentEnd: 'O fim precisa ser depois do início.',
  assessment: 'Escolha a matéria e a data.',
  card: 'Escreva a frente do card.',
} as const;

const NONE: When = { kind: 'none' };
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const MAX_MINUTE = 23 * 60 + 59;

export const dayWhen = (day: DayKey): When => ({ kind: 'day', day });

export function initialState(text = ''): CaptureState {
  return { kind: 'tarefa', kindTouched: false, text, touched: new Set(), task: {}, commitment: {}, assessment: {}, card: {} };
}

/** Compromisso and Prova ou trabalho take one line (pasted line breaks become spaces). */
export const isSingleLineKind = (kind: CaptureKind): boolean => kind === 'compromisso' || kind === 'avaliacao';

/** Line breaks become spaces; every other character stays as typed (so a trailing space survives). */
export const joinLines = (text: string): string => text.replace(/[ \t]*\r?\n[ \t]*/g, ' ');

/** Start + 1 h, capped at 23:59: the end `createCommitment` uses when none is given. */
export const defaultEnd = (start: HHmm): HHmm => formatHHmm(Math.min(parseHHmm(start) + 60, MAX_MINUTE));
const endAfter = (start: HHmm, min: number): HHmm => formatHHmm(Math.min(parseHHmm(start) + min, MAX_MINUTE));

interface Span { start: number; end: number }

/** Removes the given spans (offsets in the NFC form of `line`) and tidies the spaces left behind. */
export function removeSpans(line: string, spans: Span[]): string {
  const s = line.normalize('NFC');
  let out = '';
  let pos = 0;
  for (const sp of [...spans].sort((a, b) => a.start - b.start)) {
    out += s.slice(pos, sp.start);
    pos = Math.max(pos, sp.end);
  }
  out += s.slice(pos);
  return out.replace(/[ \t]+/g, ' ').trim();
}

// ------------------------------------------------------------------ state changes

/** A tapped type: it wins over the text from now on. Single-line types join the lines. */
export function chooseKind(state: CaptureState, kind: CaptureKind): CaptureState {
  return { ...state, kind, kindTouched: true, text: isSingleLineKind(kind) ? joinLines(state.text) : state.text };
}

/** A tapped option: it wins over the text from now on. */
export function choose<S extends Section, F extends keyof CaptureSections[S] & string>(
  state: CaptureState, section: S, field: F, value: CaptureSections[S][F],
): CaptureState {
  const touched = new Set(state.touched);
  touched.add(`${section}.${field}` as TouchKey);
  return { ...state, touched, [section]: { ...state[section], [field]: value } } as CaptureState;
}

// ------------------------------------------------------------------ reading the text

const rawLines = (text: string): string[] => text.split(/\r?\n/).filter((l) => l.trim() !== '');

/** The non-empty lines; a tapped single-line type reads the whole text as one line. */
export function linesOf(state: CaptureState): string[] {
  if (state.kindTouched && isSingleLineKind(state.kind)) {
    const one = joinLines(state.text).trim();
    return one ? [one] : [];
  }
  return rawLines(state.text);
}

const textJourney = (p: ParsedCapture, ctx: CaptureCtx): Journey | undefined =>
  p.journeyName ? matchJourney(ctx.journeys, p.journeyName) : undefined;

/** "prova #calculo dia 3/12": a dated, non-recurring line of an active subject starting with prova/trabalho. */
function detectAssessment(p: ParsedCapture, journey: Journey | undefined): Required<AssessmentFields> | undefined {
  if (p.kind !== 'mission' || !journey || journey.subject !== true || journey.status !== 'active' || !p.date || p.recurrence) {
    return undefined;
  }
  const kind = assessmentKindOf(p.title);
  return kind ? { kind, journeyId: journey.id, date: p.date } : undefined;
}

/** What follows "prova"/"trabalho" in the title ("prova final" → "final"). */
const leftover = (title: string): string => title.trim().replace(/^\S+\s*/u, '').trim();

/** The type: the tapped one, else what a single line says (? → Card, a time → Compromisso, prova… → Prova ou trabalho). */
export function kindOf(state: CaptureState, ctx: CaptureCtx): CaptureKind {
  if (state.kindTouched) return state.kind;
  const lines = rawLines(state.text);
  if (lines.length !== 1) return 'tarefa';
  const line = lines[0]!;
  if (isCardCapture(line)) return 'card';
  const p = parseCapture(line, ctx.today);
  if (p.kind === 'commitment') return 'compromisso';
  if (!state.touched.has('task.journey') && detectAssessment(p, textJourney(p, ctx))) return 'avaliacao';
  return 'tarefa';
}

/** A single line that stays a task: a time leaves the title and the rest is read again (the old "Missão"). */
function taskParse(line: string, today: DayKey): { p: ParsedCapture; hadTime: boolean } {
  const p = parseCapture(line, today);
  if (p.kind !== 'commitment') return { p, hadTime: false };
  return { p: parseCapture(removeSpans(line, p.tokens.filter((t) => t.type === 'time')), today), hadTime: true };
}

const firstOccurrence = (rec: Recurrence, today: DayKey): DayKey => nextOccurrence(rec, undefined, addDays(today, -1));

function journeyChoice(name: string, ctx: CaptureCtx): JourneyChoice {
  const found = matchJourney(ctx.journeys, name);
  if (found) return { id: found.id };
  const newName = name.trim();
  return newName ? { newName } : null;
}

function fillTask(state: CaptureState, p: ParsedCapture | undefined, hadTime: boolean, ctx: CaptureCtx): FilledTask {
  const t = state.task;
  const tapped = (f: keyof TaskFields): boolean => state.touched.has(`task.${f}`);
  const recurrence = tapped('recurrence') ? t.recurrence ?? null : p?.recurrence ?? null;
  const journey = tapped('journey') ? t.journey ?? null : p?.journeyName ? journeyChoice(p.journeyName, ctx) : null;
  const areaId = tapped('areaId')
    ? t.areaId ?? null
    : (p?.areaQuery ? resolveArea(ctx.areas, p.areaQuery)?.id : undefined) ?? null;
  const durationMin = tapped('durationMin') ? t.durationMin ?? null : p?.durationMin ?? null;
  const energy = tapped('energy') ? t.energy ?? null : null;
  const important = tapped('important') ? t.important ?? false : p?.important ?? false;
  let when: When;
  if (tapped('when')) {
    when = t.when ?? NONE;
  } else {
    // The text's own day: a date, or a repetition's first day (unless Repetir was tapped).
    const dated = p?.date !== undefined
      && p.tokens.some((k) => k.type === 'date' || (k.type === 'recurrence' && !tapped('recurrence')));
    if (dated) when = dayWhen(p!.date!);
    else if (ctx.defaultDate) when = dayWhen(ctx.defaultDate);
    else if (recurrence && recurrence.kind !== 'afterDays') when = dayWhen(firstOccurrence(recurrence, ctx.today));
    else if (hadTime) when = dayWhen(ctx.today);
    else when = NONE;
  }
  return { when, recurrence, journey, areaId, durationMin, energy, important };
}

function fillCommitment(state: CaptureState, p: ParsedCapture | undefined, ctx: CaptureCtx): FilledCommitment {
  const c = state.commitment;
  const tapped = (f: keyof CommitmentFields): boolean => state.touched.has(`commitment.${f}`);
  const dated = p?.tokens.some((k) => k.type === 'date' || k.type === 'recurrence') ?? false;
  const rec = p?.recurrence;
  const textDays = rec?.kind === 'weekly' ? rec.weekdays : rec?.kind === 'daily' ? ALL_DAYS : [];
  const weekdays = tapped('weekdays') ? c.weekdays ?? [] : textDays;
  return {
    day: tapped('day') ? c.day : (dated ? p?.date : undefined) ?? ctx.defaultDate ?? ctx.today,
    start: tapped('start') ? c.start : p?.time,
    end: tapped('end') ? c.end : p?.time && p.durationMin ? endAfter(p.time, p.durationMin) : undefined,
    weekdays,
    until: tapped('until') && weekdays.length > 0 ? c.until : undefined,
    remind: tapped('remind') ? c.remind ?? true : true,
  };
}

function fillAssessment(state: CaptureState, line: string | undefined, ctx: CaptureCtx): { fields: FilledAssessment; content: string } {
  const a = state.assessment;
  const tapped = (f: keyof AssessmentFields): boolean => state.touched.has(`assessment.${f}`);
  const p = line !== undefined ? parseCapture(line, ctx.today) : undefined;
  const found = p ? detectAssessment(p, textJourney(p, ctx)) : undefined;
  return {
    fields: {
      kind: tapped('kind') ? a.kind ?? 'prova' : found?.kind ?? 'prova',
      journeyId: tapped('journeyId') ? a.journeyId : found?.journeyId,
      date: tapped('date') ? a.date : found?.date,
    },
    content: found && p ? leftover(p.title) : (line ?? '').trim(),
  };
}

/** A card line: "? " goes away; with Baralho untouched, a #tag naming a journey with a deck picks that deck. */
function cardOf(line: string, state: CaptureState, ctx: CaptureCtx, useDeckRow: boolean): { front: string; deckId: ID | null } {
  let text = line.replace(/^\s*\?\s*/, '');
  let deckId: ID | null = null;
  if (useDeckRow && state.touched.has('card.deckId')) {
    deckId = state.card.deckId ?? null;
  } else {
    const tag = /(^|\s)#([^\s#]+)/.exec(text);
    const journey = tag ? matchJourney(ctx.journeys, tag[2]!) : undefined;
    const deck = journey
      ? ctx.decks.filter((d) => !d.archived && d.journeyId === journey.id).sort((a, b) => a.order - b.order)[0]
      : undefined;
    if (tag && deck) {
      deckId = deck.id;
      text = text.slice(0, tag.index) + text.slice(tag.index + tag[0].length);
    }
  }
  return { front: text.replace(/\s+/g, ' ').trim(), deckId };
}

// ------------------------------------------------------------------ the three entry points

/** What the rows show. Fills only what was not tapped, from a single line (Tarefa, Compromisso, Prova ou trabalho, Card). */
export function prefill(state: CaptureState, ctx: CaptureCtx): CaptureView {
  const kind = kindOf(state, ctx);
  const lines = linesOf(state);
  const one = lines.length === 1 ? lines[0] : undefined;
  const task = kind === 'tarefa' && one !== undefined ? taskParse(one, ctx.today) : undefined;
  const p = kind === 'compromisso' && one !== undefined ? parseCapture(one, ctx.today) : undefined;
  return {
    kind,
    lines,
    task: fillTask(state, task?.p, task?.hadTime ?? false, ctx),
    commitment: fillCommitment(state, p, ctx),
    assessment: fillAssessment(state, kind === 'avaliacao' ? one : undefined, ctx).fields,
    card: {
      deckId: kind === 'card' && one !== undefined
        ? cardOf(one, state, ctx, true).deckId
        : state.touched.has('card.deckId') ? state.card.deckId ?? null : null,
    },
  };
}

function missionFields(title: string, f: FilledTask): Partial<Mission> & { title: string; important: boolean } {
  return {
    title,
    important: f.important,
    ...(f.when.kind === 'day' ? { date: f.when.day } : {}),
    ...(f.recurrence ? { recurrence: f.recurrence } : {}),
    ...(f.durationMin !== null ? { durationMin: f.durationMin } : {}),
    ...(f.energy ? { energy: f.energy } : {}),
    ...(f.areaId ? { areaId: f.areaId } : {}),
    ...(f.journey && 'id' in f.journey ? { journeyId: f.journey.id } : {}),
  };
}

function commitmentRequest(title: string, c: FilledCommitment): CaptureRequest | undefined {
  if (!title || !c.day || !c.start || (c.end !== undefined && c.end <= c.start)) return undefined;
  const weekdays = [...new Set(c.weekdays)].sort((a, b) => a - b);
  return {
    type: 'commitment',
    fields: {
      title, date: c.day, start: c.start, remind: c.remind,
      ...(c.end ? { end: c.end } : {}),
      ...(weekdays.length > 0 ? { weekdays } : {}),
      ...(weekdays.length > 0 && c.until ? { untilDate: c.until } : {}),
    },
  };
}

const cardRequest = (c: { front: string; deckId: ID | null }): CaptureRequest =>
  ({ type: 'card', front: c.front, ...(c.deckId ? { deckId: c.deckId } : {}) });

function missionRequest(p: ParsedCapture, hadTime: boolean, state: CaptureState, ctx: CaptureCtx): CaptureRequest | undefined {
  if (!p.title) return undefined;
  const f = fillTask(state, p, hadTime, ctx);
  return {
    type: 'mission',
    fields: missionFields(p.title, f),
    ...(f.journey && 'newName' in f.journey ? { newJourneyName: f.journey.newName } : {}),
  };
}

/** One line of a multi-line Tarefa: what it says for the untouched rows; "? ", a time and prova… keep working as before. */
function lineRequest(line: string, state: CaptureState, ctx: CaptureCtx): CaptureRequest | undefined {
  if (isCardCapture(line)) {
    const c = cardOf(line, state, ctx, false);
    return c.front ? cardRequest(c) : undefined;
  }
  const p = parseCapture(line, ctx.today);
  if (p.kind === 'commitment') {
    const when = state.touched.has('task.when') ? state.task.when : undefined;
    const day = when?.kind === 'day' ? when.day : ctx.defaultDate;
    return commitmentRequest(p.title, fillCommitment(initialState(), p, { ...ctx, defaultDate: day }));
  }
  const found = state.touched.has('task.journey') ? undefined : detectAssessment(p, textJourney(p, ctx));
  if (found) {
    const content = leftover(p.title);
    return { type: 'assessment', input: { ...found, ...(content ? { content } : {}) } };
  }
  return missionRequest(p, false, state, ctx);
}

/** The items Salvar creates, in line order, already resolved (nothing touches the database). */
export function buildRequests(state: CaptureState, ctx: CaptureCtx): CaptureRequest[] {
  const kind = kindOf(state, ctx);
  const lines = linesOf(state);
  const keep = (r: CaptureRequest | undefined): r is CaptureRequest => r !== undefined;
  switch (kind) {
    case 'tarefa': {
      if (lines.length > 1) return lines.map((l) => lineRequest(l, state, ctx)).filter(keep);
      if (lines.length === 0) return [];
      const { p, hadTime } = taskParse(lines[0]!, ctx.today);
      return [missionRequest(p, hadTime, state, ctx)].filter(keep);
    }
    case 'compromisso': {
      if (lines.length === 0) return [];
      const p = parseCapture(lines[0]!, ctx.today);
      return [commitmentRequest(p.title, fillCommitment(state, p, ctx))].filter(keep);
    }
    case 'avaliacao': {
      // The content is optional: an empty field still saves once Matéria and Data are chosen.
      const { fields: a, content } = fillAssessment(state, lines[0], ctx);
      if (!a.journeyId || !a.date) return [];
      return [{ type: 'assessment', input: { kind: a.kind, journeyId: a.journeyId, date: a.date, ...(content ? { content } : {}) } }];
    }
    case 'card':
      return lines.map((l) => cardOf(l, state, ctx, true)).filter((c) => c.front !== '').map(cardRequest);
  }
}

/** The alert text when Salvar cannot save, else undefined. */
export function missing(state: CaptureState, ctx: CaptureCtx): string | undefined {
  if (buildRequests(state, ctx).length > 0) return undefined;
  switch (kindOf(state, ctx)) {
    case 'tarefa': return MISSING.text;
    case 'card': return MISSING.card;
    case 'avaliacao': return MISSING.assessment;
    case 'compromisso': {
      const line = linesOf(state)[0];
      const p = line !== undefined ? parseCapture(line, ctx.today) : undefined;
      if (!p?.title) return MISSING.text;
      const c = fillCommitment(state, p, ctx);
      return !c.day || !c.start ? MISSING.commitment : MISSING.commitmentEnd;
    }
  }
}
