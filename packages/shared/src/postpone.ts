import type { DayKey, DayMode, Energy, ID, LifeEvent, SnoozeReason } from './types';
import { addDays, dayKeyOf, weekdayOf } from './dates';
import { weekKey } from './weekStats';
import { defaultDayMode } from './planDay';
import { PART_LABEL, WEEKDAY_NAMES, partOfDay, type PartOfDay } from './periods';
import { atypicalWeekSet, type PatternData } from './trends';
import { SNOOZE_REASONS, SNOOZE_REASON_LABEL, isSnoozeReason } from './outcomes';

export const POSTPONE_WINDOW_DAYS = 28;
/** No hypothesis about missions or groups before this many postponements in the window. */
export const HYPOTHESIS_MIN_POSTPONED = 8;
export const BUCKET_MIN_POSTPONED = 5;
export const BUCKET_MIN_EVENTS = 6;
export const REST_MIN_EVENTS = 6;
export const MIN_RATE_GAP = 0.25;
export const MISSION_MIN_POSTPONED = 3;
/** Missions listed under "Mais adiadas" have at least this many postponements. */
export const MISSION_LIST_MIN = 2;
export const FEELING_MIN_OUTCOMES = 4;
export const MAX_HYPOTHESES = 3;
const EPS = 1e-9;

export type PostponeKind = 'postponed' | 'started' | 'shrunk' | 'dropped';
export type PostponeDim = 'energy' | 'area' | 'part' | 'weekday' | 'mode';
export const POSTPONE_DIMS: readonly PostponeDim[] = ['energy', 'area', 'part', 'weekday', 'mode'];
export const DIM_TITLE: Record<PostponeDim, string> = {
  energy: 'Esforço da missão', area: 'Área', part: 'Parte do dia', weekday: 'Dia da semana', mode: 'Tipo do dia',
};

export interface Bucket { key: string; label: string; postponed: number; started: number; shrunk: number; dropped: number }
export interface MissionTally { missionId: ID; title: string; postponed: number; started: number; open: boolean }
export interface FeelingTally { feeling: string; count: number; withOutcome: number; continued: number }
/** How often a reason was marked when postponing ("Agora não"), Acompanhamento B. */
export interface ReasonTally { key: SnoozeReason; label: string; count: number }
export interface PostponeObserved {
  from: DayKey;
  to: DayKey;
  /** Atypical weeks (research P3) overlapping the window: their events are out of every count here. */
  atypicalWeeks: number;
  postponed: number;
  started: number;
  shrunk: number;
  dropped: number;
  /** Groups with any event, by postponements and then label. */
  byDim: Record<PostponeDim, Bucket[]>;
  /** Missions with ≥ MISSION_LIST_MIN postponements, most postponed first (the screen shows 5). */
  missions: MissionTally[];
  /** Start-card feelings, most frequent first. */
  feelings: FeelingTally[];
  /** Reasons marked on "snoozed" events of the window, most marked first (ties: the chips' order). */
  reasons: ReasonTally[];
}
export interface Hypothesis {
  id: string;            // 'mission:<id>' · '<dim>:<key>' · 'feeling:<feeling>'
  basis: string;         // the observed numbers behind it
  text: string;          // "Pode ser que …"
  experiment: string;    // a small change for one week
  missionId?: ID;
}

const ENERGY_LABEL: Record<Energy | 'none', string> = {
  light: 'Leves', medium: 'Médias', heavy: 'Pesadas', none: 'Sem esforço marcado',
};
const MODE_LABEL: Record<DayMode, string> = { normal: 'Normal', low: 'Baixa energia', recovery: 'Recuperação', free: 'Livre' };
const cap = (s: string): string => s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1);
const byLabel = (a: string, b: string): number => a.localeCompare(b, 'pt-BR');

/** What an event means here: "Adiar", or a move from today (or before) to a later day, is a postponement. */
export function classifyEvent(e: LifeEvent, dayStartHour: number): PostponeKind | undefined {
  switch (e.type) {
    case 'snoozed': return 'postponed';
    case 'rescheduled': {
      const from = e.data?.from;
      const to = e.data?.to;
      if (typeof from !== 'string' || typeof to !== 'string') return undefined;
      return to > from && from <= dayKeyOf(e.at, dayStartHour) ? 'postponed' : undefined;
    }
    case 'started': return 'started';
    case 'shrunk': return 'shrunk';
    case 'dropped': return 'dropped';
    default: return undefined;
  }
}

/** How many atypical weeks (by Monday) overlap [from, to]. */
const countOverlapping = (mondays: ReadonlySet<DayKey>, from: DayKey, to: DayKey): number =>
  [...mondays].filter((m) => m <= to && addDays(m, 6) >= from).length;

/** Counts of the last 28 logical days (today included), for live missions only. */
export function postponeObserved(
  data: Pick<PatternData, 'today' | 'dayStartHour' | 'events' | 'missions' | 'areas' | 'checkins' | 'dayStates'>
    & Partial<Pick<PatternData, 'weeks'>>,
): PostponeObserved {
  const from = addDays(data.today, -(POSTPONE_WINDOW_DAYS - 1));
  const to = data.today;
  const atypical = atypicalWeekSet(data.weeks);
  const atypicalWeeks = countOverlapping(atypical, from, to);
  const missions = new Map(data.missions.filter((m) => !m.deleted).map((m) => [m.id, m]));
  const areas = new Map(data.areas.map((a) => [a.id, a.name]));
  const states = new Map(data.dayStates.filter((d) => !d.deleted).map((d) => [d.id, d]));
  const groups = Object.fromEntries(POSTPONE_DIMS.map((d) => [d, new Map<string, Bucket>()])) as Record<PostponeDim, Map<string, Bucket>>;
  const perMission = new Map<ID, MissionTally>();
  const totals = { postponed: 0, started: 0, shrunk: 0, dropped: 0 };
  const reasonCounts = new Map<SnoozeReason, number>();
  const add = (dim: PostponeDim, key: string, label: string, kind: PostponeKind): void => {
    let b = groups[dim].get(key);
    if (!b) {
      b = { key, label, postponed: 0, started: 0, shrunk: 0, dropped: 0 };
      groups[dim].set(key, b);
    }
    b[kind] += 1;
  };

  for (const e of data.events) {
    if (e.deleted || !e.missionId) continue;
    const day = dayKeyOf(e.at, data.dayStartHour);
    if (day < from || day > to || atypical.has(weekKey(day))) continue;
    const m = missions.get(e.missionId);
    if (!m) continue;
    const kind = classifyEvent(e, data.dayStartHour);
    if (!kind) continue;
    totals[kind] += 1;
    const reason = e.type === 'snoozed' ? e.data?.reason : undefined;
    if (isSnoozeReason(reason)) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    const energy = m.energy ?? 'none';
    add('energy', energy, ENERGY_LABEL[energy], kind);
    const areaName = m.areaId ? areas.get(m.areaId) : undefined;
    add('area', areaName ? m.areaId! : '', areaName ?? 'Sem área', kind);
    const part = partOfDay(e.at, data.dayStartHour);
    add('part', part, cap(PART_LABEL[part]), kind);
    const wd = weekdayOf(day);
    add('weekday', String(wd), cap(WEEKDAY_NAMES[wd]!), kind);
    const mode = defaultDayMode(day, states.get(day));
    add('mode', mode, MODE_LABEL[mode], kind);
    if (kind === 'postponed' || kind === 'started') {
      let t = perMission.get(m.id);
      if (!t) {
        t = { missionId: m.id, title: m.title, postponed: 0, started: 0, open: m.status === 'open' || m.status === 'doing' };
        perMission.set(m.id, t);
      }
      t[kind] += 1;
    }
  }

  const feelings = new Map<string, FeelingTally>();
  for (const c of data.checkins) {
    if (c.deleted || c.kind !== 'start') continue;
    const day = dayKeyOf(c.at, data.dayStartHour);
    if (day < from || day > to || atypical.has(weekKey(day))) continue;
    for (const f of c.feelings) {
      let t = feelings.get(f);
      if (!t) {
        t = { feeling: f, count: 0, withOutcome: 0, continued: 0 };
        feelings.set(f, t);
      }
      t.count += 1;
      if (c.outcome) {
        t.withOutcome += 1;
        if (c.outcome === 'continued') t.continued += 1;
      }
    }
  }

  return {
    from, to, atypicalWeeks, ...totals,
    byDim: Object.fromEntries(POSTPONE_DIMS.map((d) => [d, [...groups[d].values()]
      .sort((a, b) => b.postponed - a.postponed || byLabel(a.label, b.label))])) as Record<PostponeDim, Bucket[]>,
    missions: [...perMission.values()]
      .filter((t) => t.postponed >= MISSION_LIST_MIN)
      .sort((a, b) => b.postponed - a.postponed || byLabel(a.title, b.title)),
    feelings: [...feelings.values()].sort((a, b) => b.count - a.count || byLabel(a.feeling, b.feeling)),
    reasons: SNOOZE_REASONS.flatMap((key) => {
      const n = reasonCounts.get(key) ?? 0;
      return n > 0 ? [{ key, label: SNOOZE_REASON_LABEL[key], count: n }] : [];
    }).sort((a, b) => b.count - a.count),   // stable: equal counts keep the chips' order
  };
}

const rate = (p: number, s: number): number => (p + s === 0 ? 0 : p / (p + s));
const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** Groups of each dimension that a hypothesis may name. */
const CANDIDATE: Record<PostponeDim, (key: string) => boolean> = {
  energy: (k) => k === 'heavy',
  area: (k) => k !== '',
  part: () => true,
  weekday: (k) => k !== '0' && k !== '6',
  mode: (k) => k === 'low' || k === 'recovery',
};

export interface StrongBucket { dim: PostponeDim; bucket: Bucket; gap: number; restPostponed: number; restStarted: number }

/**
 * The dimension's strongest candidate group: ≥ 5 postponements, ≥ 6 events (postponed + started),
 * the rest with ≥ 6 events, and a postponement rate at least 0.25 above the rest's.
 */
export function strongestBucket(
  dim: PostponeDim, buckets: readonly Bucket[], totalPostponed: number, totalStarted: number,
): StrongBucket | undefined {
  let best: StrongBucket | undefined;
  for (const b of buckets) {
    if (!CANDIDATE[dim](b.key)) continue;
    const restPostponed = totalPostponed - b.postponed;
    const restStarted = totalStarted - b.started;
    if (b.postponed < BUCKET_MIN_POSTPONED || b.postponed + b.started < BUCKET_MIN_EVENTS
      || restPostponed + restStarted < REST_MIN_EVENTS) continue;
    const gap = rate(b.postponed, b.started) - rate(restPostponed, restStarted);
    if (gap + EPS < MIN_RATE_GAP) continue;
    if (!best || gap > best.gap + EPS) best = { dim, bucket: b, gap, restPostponed, restStarted };
  }
  return best;
}

const PART_PHRASE: Record<PartOfDay, { at: string; the: string }> = {
  manha: { at: 'De manhã', the: 'a manhã' },
  tarde: { at: 'À tarde', the: 'a tarde' },
  noite: { at: 'À noite', the: 'a noite' },
};
const WEEKDAY_PLURAL = ['domingos', 'segundas-feiras', 'terças-feiras', 'quartas-feiras', 'quintas-feiras', 'sextas-feiras', 'sábados'];

function dimTexts(x: StrongBucket): Omit<Hypothesis, 'id'> {
  const b = x.bucket;
  const head = `adiou ${b.postponed} e começou ${b.started} (${pct(rate(b.postponed, b.started))} de adiamentos)`;
  const rest = `adiou ${x.restPostponed} e começou ${x.restStarted} (${pct(rate(x.restPostponed, x.restStarted))})`;
  switch (x.dim) {
    case 'energy': return {
      basis: `Missões pesadas: ${head}. As outras: ${rest}.`,
      text: 'Pode ser que missões pesadas sejam mais difíceis de começar do jeito que estão escritas.',
      experiment: 'Nesta semana, antes de começar uma missão pesada, use Encolher para combinar uma versão de 5 minutos.',
    };
    case 'area': return {
      basis: `${b.label}: ${head}. Outras áreas: ${rest}.`,
      text: `Pode ser que as missões de ${b.label} precisem de um horário protegido ou de um primeiro passo menor.`,
      experiment: `Nesta semana, escolha um horário fixo para uma missão de ${b.label} e comece só pelo primeiro passo.`,
    };
    case 'part': {
      const ph = PART_PHRASE[b.key as PartOfDay];
      return {
        basis: `${ph.at}: ${head}. Em outros horários: ${rest}.`,
        text: `Pode ser que ${ph.the} seja um horário mais difícil para começar.`,
        experiment: `Nesta semana, deixe para ${ph.the} as missões leves e comece as pesadas em outro horário.`,
      };
    }
    case 'weekday': {
      const wd = Number(b.key);
      return {
        basis: `Nas ${WEEKDAY_PLURAL[wd]}: ${head}. Nos outros dias: ${rest}.`,
        text: `Pode ser que a ${WEEKDAY_NAMES[wd]} concentre mais adiamentos.`,
        experiment: `Na próxima ${WEEKDAY_NAMES[wd]}, planeje uma missão a menos e use a versão mínima do primeiro bloco.`,
      };
    }
    case 'mode': {
      const mode = b.label.toLocaleLowerCase('pt-BR');   // mid-sentence: "dias de baixa energia"
      return {
        basis: `Em dias de ${mode}: ${head}. Nos outros dias: ${rest}.`,
        text: `Pode ser que, em dias de ${mode}, o plano ainda fique grande demais.`,
        experiment: `Nos dias de ${mode} desta semana, deixe só uma missão planejada por bloco.`,
      };
    }
  }
}

/**
 * The rule catalogue, in order: the most postponed open mission never started (≥ 3), the strongest
 * group of each dimension (largest gap first), then a start-card feeling; at most 3. Missions and
 * groups need ≥ 8 postponements in the window.
 */
export function postponeHypotheses(o: PostponeObserved): Hypothesis[] {
  const out: Hypothesis[] = [];
  if (o.postponed >= HYPOTHESIS_MIN_POSTPONED) {
    const m = o.missions.find((t) => t.open && t.started === 0 && t.postponed >= MISSION_MIN_POSTPONED);
    if (m) {
      out.push({
        id: `mission:${m.missionId}`,
        missionId: m.missionId,
        basis: `“${m.title}” foi adiada ${m.postponed} vezes nas últimas 4 semanas e não foi começada.`,
        text: `Pode ser que “${m.title}” esteja grande ou pouco clara.`,
        experiment: `Nesta semana, reescreva o primeiro passo de “${m.title}” como uma ação de 5 minutos, ou divida a missão em etapas.`,
      });
    }
    const strong = POSTPONE_DIMS
      .map((d) => strongestBucket(d, o.byDim[d], o.postponed, o.started))
      .filter((x): x is StrongBucket => x !== undefined)
      .sort((a, b) => b.gap - a.gap);   // stable: equal gaps keep the dimension order
    for (const x of strong) out.push({ id: `${x.dim}:${x.bucket.key}`, ...dimTexts(x) });
  }
  const f = o.feelings
    .filter((t) => t.feeling !== 'outro' && t.withOutcome >= FEELING_MIN_OUTCOMES && t.continued * 2 >= t.withOutcome)
    .sort((a, b) => b.withOutcome - a.withOutcome || b.continued - a.continued || byLabel(a.feeling, b.feeling))[0];
  if (f) {
    out.push({
      id: `feeling:${f.feeling}`,
      basis: `Nos cards de início com ${f.feeling}, você continuou depois dos 10 minutos em ${f.continued} de ${f.withOutcome}.`,
      text: `Pode ser que começar com 10 minutos ajude quando aparece ${f.feeling}.`,
      experiment: `Quando aparecer ${f.feeling} nesta semana, use “Começar 10 min” no card de início.`,
    });
  }
  return out.slice(0, MAX_HYPOTHESES);
}
