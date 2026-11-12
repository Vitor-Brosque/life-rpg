import type {
  Area, BaseRecord, Block, BlockKind, Commitment, DayKey, HHmm, ID, Journey,
} from '@life/shared';
import { compactTitle, formatHHmm, normalize, parseHHmm, ulid } from '@life/shared';

/**
 * Suggested routine (an example for someone who studies in the evening, every time editable after it
 * is created), ready to be shown as a preview and created by `applyRoutine`.
 */
export interface RoutinePreview {
  blocks: Array<Omit<Block, keyof BaseRecord>>;
  createJourney?: { id: ID; title: 'Tech News' };
  createArea?: { id: 'area-facul'; name: 'Faculdade'; attribute: 'Sabedoria'; icon: 'book'; color: string };
  createCommitment?: { title: 'Aula'; start: HHmm; end: HHmm; weekdays: [1, 2, 3, 4, 5] };
  dayEndHour?: 0;
  warnings: string[];
}

export interface RoutineContext {
  journeys: Journey[];
  areas: Area[];
  commitments: Commitment[];
  dayEndHour: number;
  today: DayKey;
  /** Hours before it count as the next morning when comparing the day end (default 4). */
  dayStartHour?: number;
}

type Link = 'tech' | 'corpo' | 'facul' | 'estudo';
interface Template {
  name: string; start: HHmm; durationMin: number; minimumMin: number; kind: BlockKind;
  protected?: boolean; link?: Link; checklist?: string[];
}

/** The start the example below is written for (the setup screen offers it; another start shifts the day). */
export const ROUTINE_BASE_START: HHmm = '08:00';
const BASE_START = parseHHmm(ROUTINE_BASE_START);
const CLASS_START_HHMM: HHmm = '19:30';
const CLASS_END_HHMM: HHmm = '22:30';
const CLASS_START = parseHHmm(CLASS_START_HHMM);
const CLASS_END = parseHHmm(CLASS_END_HHMM);
const WEEKDAYS = [1, 2, 3, 4, 5];
const DAY_MIN = 24 * 60;

// Example values, not anyone's real day: the times, durations and checklists are placeholders to edit.
const TEMPLATE: Template[] = [
  { name: 'Início do dia', start: '08:00', durationMin: 30, minimumMin: 15, kind: 'routine', checklist: ['Beber água', 'Café da manhã', 'Separar o material'] },
  { name: 'Bloco 1 · Tech News', start: '08:30', durationMin: 120, minimumMin: 40, kind: 'focus', link: 'tech' },
  { name: 'Treino', start: '11:00', durationMin: 60, minimumMin: 30, kind: 'body', link: 'corpo' },
  { name: 'Bloco 2 · Faculdade', start: '14:00', durationMin: 90, minimumMin: 30, kind: 'study', protected: true, link: 'facul' },
  { name: 'Bloco 3 · Estudo técnico', start: '16:00', durationMin: 60, minimumMin: 25, kind: 'study', link: 'estudo' },
  { name: 'Complementos', start: '17:30', durationMin: 30, minimumMin: 10, kind: 'light' },
  { name: 'Desaceleração', start: '22:45', durationMin: 30, minimumMin: 15, kind: 'routine', checklist: ['Jantar leve', 'Arrumar a mochila', 'Leitura tranquila'] },
];

export const FACUL_AREA = {
  id: 'area-facul', name: 'Faculdade', attribute: 'Sabedoria', icon: 'book', color: '#8e7cc3',
} as const;

const live = <T extends BaseRecord>(xs: T[]): T[] => xs.filter((x) => !x.deleted);

/** Live area by id, else by name (case/accent-insensitive). */
function findArea(areas: Area[], id: string, name: string): Area | undefined {
  const key = normalize(name);
  return live(areas).find((a) => a.id === id) ?? live(areas).find((a) => normalize(a.name.trim()) === key);
}

/**
 * Live journey for a #tag or name: compacted title (case/accent-insensitive, no spaces, hyphens or
 * underscores) equal to the compacted query, else starting with it; the most recently updated wins.
 * Archived journeys never match (`accept` can narrow it further).
 */
export function matchJourney(
  journeys: Journey[], query: string, accept: (j: Journey) => boolean = () => true,
): Journey | undefined {
  const key = compactTitle(query);
  if (!key) return undefined;
  const pool = live(journeys)
    .filter((j) => j.status !== 'archived' && accept(j))
    .map((j) => ({ j, title: compactTitle(j.title) }));
  const newest = (xs: typeof pool): Journey | undefined => xs.sort((a, b) => b.j.updatedAt - a.j.updatedAt)[0]?.j;
  return newest(pool.filter((x) => x.title === key)) ?? newest(pool.filter((x) => x.title.startsWith(key)));
}

/**
 * The routine's "Tech News" journey: any active journey whose compacted title starts with "tech"
 * ("Tech News", "TechNews", "Tech-news pipeline"), preferring "technews…". A finished one is not
 * reused, since the engine hides the missions of journeys that are not active.
 */
export function findTechJourney(journeys: Journey[]): Journey | undefined {
  const active = (j: Journey): boolean => j.status === 'active';
  return matchJourney(journeys, 'technews', active) ?? matchJourney(journeys, 'tech', active);
}

/**
 * Class time already exists: a live weekly commitment (not expired) on at least one weekday
 * Mon–Fri that overlaps the class window (`CLASS_START`–`CLASS_END`) or is titled "Aula". One-off events
 * are not class time.
 */
export function hasClassCommitment(commitments: Commitment[], today: DayKey): boolean {
  return live(commitments).some((c) => {
    if (!c.weekdays || !c.weekdays.some((d) => WEEKDAYS.includes(d))) return false;
    if (c.untilDate !== undefined && c.untilDate < today) return false;
    const start = parseHHmm(c.start);
    const end = parseHHmm(c.end) + (parseHHmm(c.end) < start ? DAY_MIN : 0); // may end after midnight
    const overlaps = start < CLASS_END && end > CLASS_START;
    return overlaps || normalize(c.title.trim()) === 'aula';
  });
}

const wrap = (m: number): number => ((m % DAY_MIN) + DAY_MIN) % DAY_MIN;

/**
 * The suggested routine shifted to start at `startHHmm`: the difference to `ROUTINE_BASE_START` moves
 * only the blocks whose base start is before the class (the class and Desaceleração stay fixed). Shifted blocks
 * that would overlap the class are reported in `warnings`, never corrected.
 */
export function defaultRoutine(startHHmm: HHmm, ctx: RoutineContext): RoutinePreview {
  const shift = parseHHmm(startHHmm) - BASE_START;
  const journey = findTechJourney(ctx.journeys);
  const createJourney = journey ? undefined : { id: ulid(), title: 'Tech News' as const };
  const facul = findArea(ctx.areas, FACUL_AREA.id, FACUL_AREA.name);
  const links: Record<Link, { areaId?: ID; journeyId?: ID }> = {
    tech: { journeyId: journey?.id ?? createJourney!.id },
    corpo: { areaId: findArea(ctx.areas, 'area-vigor', 'Corpo')?.id },
    facul: { areaId: facul?.id ?? FACUL_AREA.id },
    estudo: { areaId: findArea(ctx.areas, 'area-intelecto', 'Estudo')?.id },
  };

  const warnings: string[] = [];
  let lastEnd = 0;
  const blocks = TEMPLATE.map((t, order): Omit<Block, keyof BaseRecord> => {
    const baseStart = parseHHmm(t.start);
    const moved = baseStart < CLASS_START && shift !== 0;
    const start = moved ? baseStart + shift : baseStart;
    const end = start + t.durationMin;
    if (moved && start < CLASS_END && end > CLASS_START) {
      warnings.push(`${t.name} não cabe antes da aula — encurte ou mova`);
    }
    lastEnd = Math.max(lastEnd, end);
    const link = t.link ? links[t.link] : {};
    return {
      name: t.name, weekdays: [...WEEKDAYS], order, targetStart: formatHHmm(wrap(start)),
      durationMin: t.durationMin, minimumMin: t.minimumMin, kind: t.kind, protected: t.protected ?? false,
      ...(link.areaId ? { areaId: link.areaId } : {}),
      ...(link.journeyId ? { journeyId: link.journeyId } : {}),
      checklist: (t.checklist ?? []).map((text) => ({ id: ulid(), text, done: false })),
      archived: false,
    };
  });

  const startHour = ctx.dayStartHour ?? 4;
  const dayEndMin = (ctx.dayEndHour <= startHour ? ctx.dayEndHour + 24 : ctx.dayEndHour) * 60; // as dayEndTimestamp
  return {
    blocks,
    ...(createJourney ? { createJourney } : {}),
    ...(facul ? {} : { createArea: { ...FACUL_AREA } }),
    ...(hasClassCommitment(ctx.commitments, ctx.today)
      ? {}
      : { createCommitment: { title: 'Aula' as const, start: CLASS_START_HHMM, end: CLASS_END_HHMM, weekdays: [1, 2, 3, 4, 5] as [1, 2, 3, 4, 5] } }),
    ...(ctx.dayEndHour !== 0 && dayEndMin < lastEnd ? { dayEndHour: 0 as const } : {}),
    warnings,
  };
}
