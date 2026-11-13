import type { Commitment, DayKey, Mission, Note } from '@life/shared';
import { dayKeyToDate, parseCapture } from '@life/shared';
import { captureLines } from '../../domain/actions';
import { captureCardDraft, isCardCapture } from '../../domain/studyActions';

export type Captured = Mission | Commitment | Note;
export const isMission = (r: Captured): r is Mission => 'status' in r;
/** A "? …" line became a card draft (Marco 3). */
export const isCardDraft = (r: Captured): r is Note => 'front' in r;

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

const pad2 = (n: number): string => String(n).padStart(2, '0');
/** A date token the parser understands ("20/11/2026"). */
function slashDate(day: DayKey): string {
  const d = dayKeyToDate(day);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export interface SaveOptions {
  today: DayKey;
  /** The user switched a "time ⇒ commitment" line to a plain mission (single-line capture only). */
  asMission?: boolean;
  /** Day used when a line has no date of its own (e.g. "+ Missão neste dia"). */
  defaultDate?: DayKey;
}

/**
 * Saves every non-empty line. Reuses `captureLines` (journey/area resolution, events) and only
 * adjusts the text per line: the time is dropped when the user chose "Missão", and lines
 * without a date get `defaultDate`. Lines whose title would be empty are skipped.
 */
export async function saveCapture(text: string, opts: SaveOptions): Promise<Captured[]> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const out: Captured[] = [];
  for (const line of lines) {
    if (isCardCapture(line)) {
      const note = await captureCardDraft(line);
      if (note) out.push(note);
      continue;
    }
    const p = parseCapture(line, opts.today);
    if (p.title === '') continue;
    const hasDate = p.tokens.some((t) => t.type === 'date');
    let src = line;
    const extra: Partial<Mission> = {};
    if (p.kind === 'commitment' && opts.asMission && lines.length === 1) {
      src = removeSpans(line, p.tokens.filter((t) => t.type === 'time'));
      if (!hasDate) extra.date = opts.defaultDate ?? opts.today;
    } else if (!hasDate && opts.defaultDate) {
      if (p.kind === 'commitment') src = `${line} ${slashDate(opts.defaultDate)}`;
      else extra.date = opts.defaultDate;
    }
    out.push(...(await captureLines(src, extra)));
  }
  return out;
}
