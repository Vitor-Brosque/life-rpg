import type { CommitmentOccurrence, DayKey } from '@life/shared';
import { addDays, formatHHmm, timestampAt } from '@life/shared';
import { formatDuration } from '../../ui/format';

const MIN = 60_000;
const HOUR = 60 * MIN;
/** Gaps shorter than this are not worth a "livre" label. */
const MIN_FREE_MIN = 15;
/** Hour labels this close to the current-time label (in % of the height) are hidden. */
const LABEL_CLEARANCE = 3.5;

export interface TimeSpan { start: number; end: number }

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

/** Free windows from now until the day end, between commitments (gaps under 15 min skipped). */
export function freeWindows(occurrences: CommitmentOccurrence[], now: number, dayEndTs: number): TimeSpan[] {
  const out: TimeSpan[] = [];
  let cursor = now;
  for (const o of [...occurrences].sort((a, b) => a.startTs - b.startTs)) {
    if (cursor >= dayEndTs) break;
    if (o.endTs <= cursor) continue;
    if (o.startTs > cursor) out.push({ start: cursor, end: Math.min(o.startTs, dayEndTs) });
    cursor = Math.max(cursor, o.endTs);
  }
  if (dayEndTs > cursor) out.push({ start: cursor, end: dayEndTs });
  return out.filter((w) => w.end - w.start >= MIN_FREE_MIN * MIN);
}

const clock = (ts: number): string => {
  const d = new Date(ts);
  return formatHHmm(d.getHours() * 60 + d.getMinutes());
};

/** Lane per occurrence so overlapping commitments sit side by side. */
function lanes(list: CommitmentOccurrence[]): { lane: Map<CommitmentOccurrence, number>; count: number } {
  const ends: number[] = [];
  const lane = new Map<CommitmentOccurrence, number>();
  for (const o of list) {
    let i = ends.findIndex((end) => end <= o.startTs);
    if (i === -1) { i = ends.length; ends.push(o.endTs); } else ends[i] = o.endTs;
    lane.set(o, i);
  }
  return { lane, count: Math.max(1, ends.length) };
}

type Item =
  | { kind: 'free'; span: TimeSpan }
  | { kind: 'commitment'; occ: CommitmentOccurrence };

export interface TimelineProps {
  occurrences: CommitmentOccurrence[];
  now: number;
  dayStartTs: number;
  dayEndTs: number;
}

/**
 * Vertical "Hoje" timeline scaled to fit its container: hour ticks, commitment blocks,
 * free windows ("livre 1h40") and the current-time line.
 */
export function Timeline({ occurrences, now, dayStartTs, dayEndTs }: TimelineProps) {
  const range = timelineRange(now, dayStartTs, dayEndTs);
  const span = range.end - range.start;
  const pct = (t: number) => ((Math.min(Math.max(t, range.start), range.end) - range.start) / span) * 100;
  const place = (s: TimeSpan) => ({ top: `${pct(s.start)}%`, height: `${pct(s.end) - pct(s.start)}%` });
  const nowPct = pct(now);

  const hours: number[] = [];
  const first = new Date(range.start);
  if (first.getMinutes() || first.getSeconds() || first.getMilliseconds()) first.setHours(first.getHours() + 1, 0, 0, 0);
  for (const d = first; d.getTime() <= range.end; d.setHours(d.getHours() + 1)) hours.push(d.getTime());

  const visible = occurrences.filter((o) => o.endTs > range.start && o.startTs < range.end);
  const { lane, count } = lanes(visible);
  const items: Item[] = [
    ...freeWindows(occurrences, now, dayEndTs).map((s): Item => ({ kind: 'free', span: s })),
    ...visible.map((o): Item => ({ kind: 'commitment', occ: o })),
  ].sort((a, b) => (a.kind === 'free' ? a.span.start : a.occ.startTs) - (b.kind === 'free' ? b.span.start : b.occ.startTs));

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

      <ol className="timeline__items" aria-label="Linha do tempo">
        {items.map((item) => {
          if (item.kind === 'free') {
            const min = Math.round((item.span.end - item.span.start) / MIN);
            return (
              <li key={`free-${item.span.start}`} className="timeline__free" style={place(item.span)}>
                <span className="timeline__free-label">livre {formatDuration(min)}</span>
                <span className="visually-hidden"> das {clock(item.span.start)} às {clock(item.span.end)}</span>
              </li>
            );
          }
          const o = item.occ;
          const current = o.startTs <= now && now < o.endTs;
          const state = o.endTs <= now ? ' timeline__block--past' : current ? ' timeline__block--now' : '';
          const width = 100 / count;
          // Current block with "now" in its upper half: label just below the now line, never under it.
          const visStart = Math.max(o.startTs, range.start);
          const into = current ? (now - visStart) / (Math.min(o.endTs, range.end) - visStart) : 1;
          const textStyle = into < 0.5 ? { top: `calc(${into * 100}% + 0.6em)` } : undefined;
          return (
            <li
              key={`${o.commitment.id}-${o.date}`}
              className={`timeline__block${state}`}
              style={{ ...place({ start: o.startTs, end: o.endTs }), left: `${(lane.get(o) ?? 0) * width}%`, width: `${width}%` }}
            >
              <span className={textStyle ? 'timeline__block-text timeline__block-text--below' : 'timeline__block-text'} style={textStyle}>
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
