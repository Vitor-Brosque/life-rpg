import type { CSSProperties } from 'react';
import type { BlockOccurrence, CommitmentOccurrence, DayKey } from '@life/shared';
import { addDays, formatHHmm, timestampAt } from '@life/shared';
import { formatDuration } from '../../ui/format';
import { BlockBand, SkipMarker, clock, cutSpans, type Span } from './TimelineBlocks';

const MIN = 60_000;
const HOUR = 60 * MIN;
/** Gaps shorter than this are not worth a "livre" label. */
const MIN_FREE_MIN = 15;
/** Hour labels this close to the current-time label (in % of the height) are hidden. */
const LABEL_CLEARANCE = 3.5;
/** Free windows shorter than this (in % of the height) keep their tint but not a visible label. */
const FREE_LABEL_MIN = 3;

export type TimeSpan = Span;

const hh = (h: number): string => formatHHmm(h * 60);

/** Start and end of the user's day (dayStartHour … dayEndHour, which may be after midnight); same rule as the engine. */
export function dayBounds(today: DayKey, dayStartHour: number, dayEndHour: number): TimeSpan {
  const endDay = dayEndHour < dayStartHour ? addDays(today, 1) : today;
  return { start: timestampAt(today, hh(dayStartHour)), end: timestampAt(endDay, hh(dayEndHour)) };
}

/** From one hour ago (never before the day start) to the day end (at least one hour ahead). */
export function timelineRange(now: number, dayStartTs: number, dayEndTs: number): TimeSpan {
  return { start: Math.max(now - HOUR, dayStartTs), end: Math.max(dayEndTs, now + HOUR) };
}

/**
 * Free windows from now until the day end, between commitments and any other `busy` spans
 * (today's blocks); gaps under 15 min skipped.
 */
export function freeWindows(
  occurrences: CommitmentOccurrence[], now: number, dayEndTs: number, busy: TimeSpan[] = [],
): TimeSpan[] {
  const out: TimeSpan[] = [];
  let cursor = now;
  const spans = [...occurrences.map((o) => ({ start: o.startTs, end: o.endTs })), ...busy]
    .sort((a, b) => a.start - b.start);
  for (const s of spans) {
    if (cursor >= dayEndTs) break;
    if (s.end <= cursor) continue;
    if (s.start > cursor) out.push({ start: cursor, end: Math.min(s.start, dayEndTs) });
    cursor = Math.max(cursor, s.end);
  }
  if (dayEndTs > cursor) out.push({ start: cursor, end: dayEndTs });
  return out.filter((w) => w.end - w.start >= MIN_FREE_MIN * MIN);
}

type Item =
  | { kind: 'free'; span: TimeSpan }
  | { kind: 'commitment'; span: TimeSpan; occ: CommitmentOccurrence }
  | { kind: 'block'; span: TimeSpan; occ: BlockOccurrence }
  | { kind: 'skipped'; span: TimeSpan; occ: BlockOccurrence };
type Laned = Extract<Item, { kind: 'commitment' | 'block' }>;

/** Lane per entry so overlapping commitments/blocks sit side by side. */
function lanes(list: Laned[]): { lane: Map<Laned, number>; count: number } {
  const ends: number[] = [];
  const lane = new Map<Laned, number>();
  for (const o of list) {
    let i = ends.findIndex((end) => end <= o.span.start);
    if (i === -1) { i = ends.length; ends.push(o.span.end); } else ends[i] = o.span.end;
    lane.set(o, i);
  }
  return { lane, count: Math.max(1, ends.length) };
}

const byStart = (a: Item, b: Item) => a.span.start - b.span.start;

export interface TimelineProps {
  occurrences: CommitmentOccurrence[];
  /** Today's block occurrences (`useDayPlan`), drawn as named bands. */
  blocks?: BlockOccurrence[];
  now: number;
  dayStartTs: number;
  dayEndTs: number;
}

/**
 * Vertical "Hoje" timeline scaled to fit its container: hour ticks, today's blocks (current one
 * highlighted, a shrunk one's cut part dashed, one with no room as a "sem tempo hoje" marker),
 * commitments, free windows ("livre 1h40") and the current-time line.
 */
export function Timeline({ occurrences, blocks = [], now, dayStartTs, dayEndTs }: TimelineProps) {
  const range = timelineRange(now, dayStartTs, dayEndTs);
  const span = range.end - range.start;
  const pct = (t: number) => ((Math.min(Math.max(t, range.start), range.end) - range.start) / span) * 100;
  const place = (s: TimeSpan) => ({ top: `${pct(s.start)}%`, height: `${pct(s.end) - pct(s.start)}%` });
  const nowPct = pct(now);
  const visible = (s: TimeSpan) => s.end > range.start && s.start < range.end;

  const hours: number[] = [];
  const first = new Date(range.start);
  if (first.getMinutes() || first.getSeconds() || first.getMilliseconds()) first.setHours(first.getHours() + 1, 0, 0, 0);
  for (const d = first; d.getTime() <= range.end; d.setHours(d.getHours() + 1)) hours.push(d.getTime());

  const placed = blocks.filter((b) => b.state !== 'skipped' && b.end > b.start);
  const laned: Laned[] = [
    ...occurrences.map((o): Laned => ({ kind: 'commitment', span: { start: o.startTs, end: o.endTs }, occ: o })),
    ...placed.map((o): Laned => ({ kind: 'block', span: { start: o.start, end: o.end }, occ: o })),
  ].filter((i) => visible(i.span)).sort(byStart);
  const { lane, count } = lanes(laned);
  const width = 100 / count;
  const column = (i: Laned): CSSProperties => ({ left: `${(lane.get(i) ?? 0) * width}%`, width: `${width}%` });

  const items: Item[] = [
    ...freeWindows(occurrences, now, dayEndTs, placed.map((o) => ({ start: o.start, end: o.end })))
      .map((s): Item => ({ kind: 'free', span: s })),
    ...laned,
    ...blocks.filter((b) => b.state === 'skipped' && b.plannedStart >= range.start && b.plannedStart < range.end)
      .map((o): Item => ({ kind: 'skipped', span: { start: o.plannedStart, end: o.plannedStart }, occ: o })),
  ].sort(byStart);

  /** Current entry with "now" in its upper half: its text goes just below the now line, never under it. */
  const textStyle = (s: TimeSpan, current: boolean): CSSProperties | undefined => {
    if (!current) return undefined;
    const visStart = Math.max(s.start, range.start);
    const into = (now - visStart) / (Math.min(s.end, range.end) - visStart);
    return into >= 0 && into < 0.5 ? { top: `calc(${into * 100}% + 0.6em)` } : undefined;
  };

  return (
    <div className="timeline">
      <div className="timeline__grid" aria-hidden="true">
        {hours.map((t) => (
          <div key={t} className="timeline__hour" style={{ top: `${pct(t)}%` }}>
            <span className={Math.abs(pct(t) - nowPct) < LABEL_CLEARANCE ? 'timeline__hour-label is-hidden' : 'timeline__hour-label'}>
              {clock(t)}
            </span>
          </div>
        ))}
      </div>

      {/* What a shrunk block lost of its target window, drawn under everything else. */}
      <div className="timeline__cuts" aria-hidden="true">
        {laned.flatMap((i) => (i.kind === 'block' ? cutSpans(i.occ).filter(visible).map((c) => (
          <span key={`cut-${i.occ.block.id}-${c.start}`} className="timeline__cut" style={{ ...place(c), ...column(i) }} />
        )) : []))}
      </div>

      <ol className="timeline__items" aria-label="Linha do tempo">
        {items.map((item) => {
          if (item.kind === 'free') {
            const min = Math.round((item.span.end - item.span.start) / MIN);
            const roomy = pct(item.span.end) - pct(item.span.start) >= FREE_LABEL_MIN;
            return (
              <li key={`free-${item.span.start}`} className="timeline__free" style={place(item.span)}>
                <span className={roomy ? 'timeline__free-label' : 'visually-hidden'}>livre {formatDuration(min)}</span>
                <span className="visually-hidden"> das {clock(item.span.start)} às {clock(item.span.end)}</span>
              </li>
            );
          }
          if (item.kind === 'skipped') {
            return <SkipMarker key={`skip-${item.occ.block.id}`} occ={item.occ} top={`${pct(item.span.start)}%`} />;
          }
          if (item.kind === 'block') {
            return (
              <BlockBand key={`block-${item.occ.block.id}`} occ={item.occ} style={{ ...place(item.span), ...column(item) }}
                textStyle={textStyle(item.span, item.occ.state === 'current')} />
            );
          }
          const o = item.occ;
          const current = o.startTs <= now && now < o.endTs;
          const state = o.endTs <= now ? ' timeline__block--past' : current ? ' timeline__block--now' : '';
          const below = textStyle(item.span, current);
          return (
            <li key={`${o.commitment.id}-${o.date}`} className={`timeline__block${state}`} style={{ ...place(item.span), ...column(item) }}>
              <span className={below ? 'timeline__block-text timeline__block-text--below' : 'timeline__block-text'} style={below}>
                <span className="timeline__block-time">{o.commitment.start}–{o.commitment.end}</span>
                <span className="timeline__block-title">{o.commitment.title}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="timeline__now" style={{ top: `${nowPct}%` }}>
        <span className="timeline__now-label"><span className="visually-hidden">Agora: </span>{clock(now)}</span>
      </div>
    </div>
  );
}
