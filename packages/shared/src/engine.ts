import type { Commitment, DayKey, EnergyLevel, ID, Journey, Mission } from './types';
import { addDays, dayKeyOf, diffDays, timestampAt, weekdayOf } from './dates';

export interface EngineInput {
  now: number;
  dayStartHour: number;
  dayEndHour: number;
  missions: Mission[];
  journeys: Journey[];
  commitments: Commitment[];
  energy?: EnergyLevel;
  hardDay: boolean;
  lastCompletionByArea: Record<ID, number>; // epoch ms of last completed mission per area
  skipIds?: ID[]; // ids the user pressed "Outra" on, moved to the end
}
export interface Reason { code: string; text: string; points: number }
export interface Suggestion { mission: Mission; score: number; reasons: Reason[]; postponedHint: boolean }
export interface CommitmentOccurrence { commitment: Commitment; date: DayKey; startTs: number; endTs: number }
export interface EngineOutput {
  mode: 'manual' | 'score' | 'empty';
  primary?: Suggestion;
  alternatives: Suggestion[]; // up to 3, after primary
  ranked: Suggestion[]; // every eligible candidate in final order (primary first)
  freeMinutes: number; // minutes until next commitment today or dayEndHour; 0 inside a commitment
  currentCommitment?: CommitmentOccurrence;
  nextCommitment?: CommitmentOccurrence;
}

const MINUTE = 60000;
const hh = (h: number): string => `${String(h).padStart(2, '0')}:00`;

function occurrenceOf(c: Commitment, day: DayKey): CommitmentOccurrence {
  const startTs = timestampAt(day, c.start);
  const sameDayEnd = timestampAt(day, c.end);
  const endTs = sameDayEnd < startTs ? timestampAt(addDays(day, 1), c.end) : sameDayEnd;
  return { commitment: c, date: day, startTs, endTs };
}

/** Commitment occurrences on `day`, sorted by start; deleted ones excluded. */
export function occurrencesOn(commitments: Commitment[], day: DayKey): CommitmentOccurrence[] {
  const out: CommitmentOccurrence[] = [];
  for (const c of commitments) {
    if (c.deleted) continue;
    if (c.weekdays && c.weekdays.length > 0) {
      if (day < c.date) continue;
      if (c.untilDate !== undefined && day > c.untilDate) continue;
      if (!c.weekdays.includes(weekdayOf(day))) continue;
    } else if (c.date !== day) {
      continue;
    }
    out.push(occurrenceOf(c, day));
  }
  return out.sort((a, b) => a.startTs - b.startTs);
}

const ENERGY_RANK = { light: 0, medium: 1, heavy: 2 } as const;
const LEVEL_RANK = { low: 0, medium: 1, high: 2 } as const;

function energyReason(current: EnergyLevel | undefined, m: Mission): Reason | undefined {
  if (!current || !m.energy) return undefined;
  const need = ENERGY_RANK[m.energy];
  const have = LEVEL_RANK[current];
  if (current === 'high' && m.energy === 'heavy') {
    return { code: 'energy', text: 'aproveita a energia alta', points: 15 };
  }
  if (need === have) return { code: 'energy', text: 'combina com sua energia', points: 10 };
  if (need < have) return { code: 'energy', text: 'leve para sua energia', points: 3 };
  if (current === 'medium') return { code: 'energy', text: 'pesada para agora', points: -5 };
  return { code: 'energy', text: 'pesada para agora', points: -20 };
}

function deadlineReason(deadline: DayKey, today: DayKey): Reason | undefined {
  const d = diffDays(today, deadline);
  if (d < 0) return { code: 'deadline', text: 'prazo vencido', points: 50 };
  if (d === 0) return { code: 'deadline', text: 'prazo hoje', points: 40 };
  if (d === 1) return { code: 'deadline', text: 'prazo amanhã', points: 25 };
  if (d <= 3) return { code: 'deadline', text: `prazo em ${d} dias`, points: 15 };
  if (d <= 7) return { code: 'deadline', text: `prazo em ${d} dias`, points: 5 };
  return undefined;
}

function scoreMission(m: Mission, ctx: {
  today: DayKey; freeMinutes: number; energy?: EnergyLevel;
  lastCompletionByArea: Record<ID, number>; dayStartHour: number;
}): Suggestion {
  const reasons: Reason[] = [];
  if (m.status === 'doing') reasons.push({ code: 'doing', text: 'você já começou', points: 30 });
  if (m.deadline !== undefined) {
    const r = deadlineReason(m.deadline, ctx.today);
    if (r) reasons.push(r);
  }
  if (m.date !== undefined && m.date <= ctx.today) {
    reasons.push({
      code: 'planned',
      text: m.date === ctx.today ? 'planejada para hoje' : 'ficou de outro dia',
      points: 20,
    });
  }
  if (m.important) reasons.push({ code: 'important', text: 'importante', points: 15 });
  if (m.durationMin !== undefined && ctx.freeMinutes > 0 && m.durationMin <= ctx.freeMinutes) {
    reasons.push({ code: 'fits', text: 'cabe no tempo livre', points: 10 });
  }
  const er = energyReason(ctx.energy, m);
  if (er) reasons.push(er);
  if (m.areaId !== undefined) {
    const last = ctx.lastCompletionByArea[m.areaId];
    if (last === undefined) {
      reasons.push({ code: 'neglect', text: 'área ainda sem conquistas', points: 5 });
    } else {
      const days = diffDays(dayKeyOf(last, ctx.dayStartHour), ctx.today);
      if (days >= 7) reasons.push({ code: 'neglect', text: `área esquecida há ${days} dias`, points: 5 });
    }
  }
  reasons.sort((a, b) => b.points - a.points);
  const score = reasons.reduce((s, r) => s + r.points, 0);
  return { mission: m, score, reasons, postponedHint: m.postponeCount >= 3 };
}

const byScore = (a: Suggestion, b: Suggestion): number =>
  b.score - a.score || a.mission.createdAt - b.mission.createdAt;

export function suggest(input: EngineInput): EngineOutput {
  const { now, dayStartHour, dayEndHour } = input;
  const today = dayKeyOf(now, dayStartHour);

  // Free time
  const occs = occurrencesOn(input.commitments, today);
  const currentCommitment = occs.find((o) => o.startTs <= now && now < o.endTs);
  const nextCommitment = currentCommitment ? undefined : occs.find((o) => o.startTs > now);
  const endDay = dayEndHour < dayStartHour ? addDays(today, 1) : today;
  const dayEndTs = timestampAt(endDay, hh(dayEndHour));
  let freeMinutes = 0;
  if (!currentCommitment) {
    const limit = nextCommitment ? Math.min(nextCommitment.startTs, dayEndTs) : dayEndTs;
    freeMinutes = Math.max(0, Math.floor((limit - now) / MINUTE));
  }

  // Candidates
  const journeyById = new Map(input.journeys.map((j) => [j.id, j]));
  const live = input.missions.filter((m) => !m.deleted && (m.status === 'open' || m.status === 'doing'));
  const journeyHead = new Map<ID, ID>();
  const headOrder = new Map<ID, number>();
  for (const m of live) {
    if (!m.journeyId) continue;
    const ord = m.journeyOrder ?? Infinity;
    const cur = headOrder.get(m.journeyId);
    if (cur === undefined || ord < cur) {
      headOrder.set(m.journeyId, ord);
      journeyHead.set(m.journeyId, m.id);
    }
  }

  const candidates = live.filter((m) => {
    if (m.notBefore !== undefined && m.notBefore > today) return false;
    if (m.snoozedUntil !== undefined && m.snoozedUntil > now) return false;
    if (m.date !== undefined && m.date > today) return false;
    if (m.journeyId) {
      const j = journeyById.get(m.journeyId);
      if (j) {
        if (j.status !== 'active') return false;
        const ownDateDue = m.date !== undefined && m.date <= today;
        if (journeyHead.get(m.journeyId) !== m.id && !ownDateDue) return false;
      }
    }
    if (input.hardDay && !(m.important || m.energy === 'light' || (m.durationMin ?? Infinity) <= 15)) {
      return false;
    }
    if (freeMinutes > 0 && m.durationMin !== undefined && m.durationMin > freeMinutes) return false;
    return true;
  });

  const ctx = {
    today, freeMinutes, energy: input.energy,
    lastCompletionByArea: input.lastCompletionByArea, dayStartHour,
  };
  const scored = candidates.map((m) => scoreMission(m, ctx));

  const manual = scored
    .filter((s) => s.mission.dayOrder !== undefined && s.mission.date !== undefined && s.mission.date <= today)
    .sort((a, b) => a.mission.dayOrder! - b.mission.dayOrder! || a.mission.createdAt - b.mission.createdAt);
  const manualIds = new Set(manual.map((s) => s.mission.id));
  manual.forEach((s, i) => {
    s.reasons.unshift({ code: 'manual', text: `${i + 1}ª do seu plano de hoje`, points: 0 });
  });
  const rest = scored.filter((s) => !manualIds.has(s.mission.id)).sort(byScore);

  let ranked = [...manual, ...rest];
  if (input.skipIds && input.skipIds.length > 0) {
    const skipped: Suggestion[] = [];
    for (const id of input.skipIds) {
      const s = ranked.find((r) => r.mission.id === id);
      if (s && !skipped.includes(s)) skipped.push(s);
    }
    ranked = [...ranked.filter((s) => !skipped.includes(s)), ...skipped];
  }

  const mode: EngineOutput['mode'] = ranked.length === 0 ? 'empty' : manual.length > 0 ? 'manual' : 'score';
  return {
    mode,
    primary: ranked[0],
    alternatives: ranked.slice(1, 4),
    ranked,
    freeMinutes,
    currentCommitment,
    nextCommitment,
  };
}

/** Open/doing, not deleted, planned up to today (or doing). Manual order first. */
export function todayList(missions: Mission[], today: DayKey, _now: number): Mission[] {
  return missions
    .filter((m) => !m.deleted && (m.status === 'open' || m.status === 'doing')
      && (m.status === 'doing' || (m.date !== undefined && m.date <= today)))
    .sort((a, b) => {
      const ao = a.dayOrder ?? Infinity;
      const bo = b.dayOrder ?? Infinity;
      if (ao !== bo) return ao < bo ? -1 : 1;
      const ad = a.status === 'doing' ? 0 : 1;
      const bd = b.status === 'doing' ? 0 : 1;
      if (ad !== bd) return ad - bd;
      const ada = a.date ?? '9999-99-99';
      const bda = b.date ?? '9999-99-99';
      if (ada !== bda) return ada < bda ? -1 : 1;
      return a.createdAt - b.createdAt;
    });
}

/** Open (not doing) missions whose planned date or deadline is already past. */
export function needsReview(missions: Mission[], today: DayKey): Mission[] {
  const key = (m: Mission): string => m.date ?? m.deadline ?? '9999-99-99';
  return missions
    .filter((m) => !m.deleted && m.status === 'open'
      && ((m.date !== undefined && m.date < today) || (m.deadline !== undefined && m.deadline < today)))
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.createdAt - b.createdAt));
}
