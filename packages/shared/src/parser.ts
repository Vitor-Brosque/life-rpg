import { addDays, daysInMonth, formatHHmm, isValidDayKey, weekdayOf } from './dates';
import type { DayKey, HHmm, Recurrence } from './types';

export type CaptureTokenType = 'date' | 'time' | 'duration' | 'journey' | 'area' | 'important';
export interface CaptureToken {
  type: CaptureTokenType;
  text: string;
  start: number;
  end: number; // span in original input (NFC-normalized)
}
export interface ParsedCapture {
  title: string;
  kind: 'mission' | 'commitment';
  date?: DayKey;
  time?: HHmm;
  durationMin?: number;
  journeyName?: string;
  areaQuery?: string;
  important: boolean;
  recurrence?: Recurrence;   // "todo dia", "toda seg e qui"… (missions; commitments use its weekdays)
  tokens: CaptureToken[];
}

/** Lowercase + strip diacritics. */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** `normalize` without spaces, hyphens and underscores: "Tech-News" and "tech news" → "technews". */
export function compactTitle(s: string): string {
  return normalize(s).replace(/[\s_-]+/gu, '');
}

/** Per-character fold so the result has exactly the same length as `s` (which must be NFC). */
function foldSameLength(s: string): string {
  let out = '';
  for (const ch of s) {
    const f = normalize(ch);
    out += f.length === ch.length ? f : ch;
  }
  return out;
}

// Word boundaries: letters, digits and '-' are word characters.
const B_BEFORE = String.raw`(?<![\p{L}\p{N}-])`;
const B_AFTER = String.raw`(?![\p{L}\p{N}-])`;

const WEEKDAYS: Record<string, number> = {
  domingo: 0, dom: 0,
  segunda: 1, seg: 1, 'segunda-feira': 1,
  terca: 2, ter: 2, 'terca-feira': 2,
  quarta: 3, qua: 3, 'quarta-feira': 3,
  quinta: 4, qui: 4, 'quinta-feira': 4,
  sexta: 5, sex: 5, 'sexta-feira': 5,
  sabado: 6, sab: 6,
};

const DATE_RE = new RegExp(
  B_BEFORE +
    String.raw`(?:(\d{1,2})/(\d{1,2})(?:/(\d{4}))?|dia\s+(\d{1,2})(?!/)|(depois\s+de\s+amanha)|(amanha)|(hoje)|(proxima\s+semana)|(domingo|dom|segunda-feira|segunda|seg|terca-feira|terca|ter|quarta-feira|quarta|qua|quinta-feira|quinta|qui|sexta-feira|sexta|sex|sabado|sab))` +
    B_AFTER,
  'gu',
);

/** Same alternatives as DATE_RE, matched only at `lastIndex` (is there a date token right here?). */
const DATE_AT_RE = new RegExp(DATE_RE.source, 'uy');

/** Weekday names that are also ordinals ("segunda fonte", "quinta lista"): weekdays only in context. */
const AMBIGUOUS_WEEKDAYS = new Set(['segunda', 'quarta', 'quinta', 'sexta']);
/** A previous word that makes an ambiguous name a weekday ("na sexta", "até segunda", "toda quarta"). */
const WEEKDAY_CONTEXT = new Set(['na', 'no', 'nesta', 'nessa', 'esta', 'essa', 'ate', 'proxima', 'de', 'toda']);
/** Previous words that only glue the weekday to the sentence: removed from the title with it. */
const WEEKDAY_GLUE = new Set(['na', 'no', 'nesta', 'nessa', 'esta', 'essa', 'ate', 'proxima']);
/** Nothing left but "!", #tags and @areas. */
const ONLY_MARKERS_RE = /^(?:\s*(?:!+|[#@]\S*))*\s*$/u;
const QUE_VEM_RE = /^\s+que\s+vem(?![\p{L}\p{N}-])/u;
const PREV_WORD_RE = /(?<!\S)(\S+)\s+$/u;

function dateTokenAt(n: string, index: number): boolean {
  DATE_AT_RE.lastIndex = index;
  return DATE_AT_RE.test(n);
}

const TIME_RE = new RegExp(
  B_BEFORE + String.raw`(?:(as)\s+)?(?:(\d{1,2}):(\d{2})|(\d{1,2})(h(\d{2})?)?)` + B_AFTER,
  'gu',
);

const DURATION_RE = new RegExp(
  B_BEFORE + String.raw`(?:(\d{1,2})h(\d{2})\s*min|(\d{1,4})\s*min|(\d)h(\d{2})?)` + B_AFTER,
  'gu',
);

interface Span {
  start: number;
  end: number;
}
const overlaps = (a: Span, b: Span): boolean => a.start < b.end && b.start < a.end;
const pad2 = (n: number): string => String(n).padStart(2, '0');

function resolveDate(m: RegExpExecArray, today: DayKey): DayKey | undefined {
  const [, dd, mm, yyyy, diaN, depois, amanha, hoje, proxima, wd] = m;
  if (dd !== undefined && mm !== undefined) {
    const day = Number(dd);
    const month = Number(mm);
    if (yyyy !== undefined) {
      const key = `${yyyy}-${pad2(month)}-${pad2(day)}`;
      return isValidDayKey(key) ? key : undefined;
    }
    const year = Number(today.slice(0, 4));
    const thisYear = `${year}-${pad2(month)}-${pad2(day)}`;
    if (isValidDayKey(thisYear) && thisYear >= today) return thisYear;
    const nextYear = `${year + 1}-${pad2(month)}-${pad2(day)}`;
    return isValidDayKey(nextYear) ? nextYear : undefined;
  }
  if (diaN !== undefined) {
    const n = Number(diaN);
    if (n < 1 || n > 31) return undefined;
    const y0 = Number(today.slice(0, 4));
    const m0 = Number(today.slice(5, 7));
    for (let i = 0; i < 24; i++) {
      const idx = m0 - 1 + i;
      const y = y0 + Math.floor(idx / 12);
      const mo = (idx % 12) + 1;
      if (n > daysInMonth(y, mo)) continue;
      const key = `${y}-${pad2(mo)}-${pad2(n)}`;
      if (key >= today) return key;
    }
    return undefined;
  }
  if (depois !== undefined) return addDays(today, 2);
  if (amanha !== undefined) return addDays(today, 1);
  if (hoje !== undefined) return today;
  if (proxima !== undefined) {
    const delta = (1 - weekdayOf(today) + 7) % 7 || 7;
    return addDays(today, delta);
  }
  if (wd !== undefined) {
    const target = WEEKDAYS[wd];
    if (target === undefined) return undefined;
    return addDays(today, (target - weekdayOf(today) + 7) % 7);
  }
  return undefined;
}

export function parseCapture(input: string, today: DayKey): ParsedCapture {
  const s = input.normalize('NFC');
  const n = foldSameLength(s);
  const tokens: CaptureToken[] = [];
  const claimed: Span[] = [];
  const free = (sp: Span): boolean => !claimed.some((c) => overlaps(c, sp));
  const claim = (type: CaptureTokenType, start: number, end: number): void => {
    tokens.push({ type, text: s.slice(start, end), start, end });
    claimed.push({ start, end });
  };

  const result: ParsedCapture = { title: '', kind: 'mission', important: false, tokens };

  // Journey (#name) and area (@name)
  const journey = /(?<!\S)#(\S+)/u.exec(s);
  if (journey) {
    claim('journey', journey.index, journey.index + journey[0].length);
    result.journeyName = journey[1]!;
  }
  for (const m of n.matchAll(/(?<!\S)@(\S+)/gu)) {
    const sp = { start: m.index, end: m.index + m[0].length };
    if (!free(sp)) continue;
    claim('area', sp.start, sp.end);
    result.areaQuery = m[1]!;
    break;
  }

  // Important: standalone "!" or trailing "!" on the last word
  {
    const candidates: Span[] = [];
    const own = /(?<!\S)!+(?!\S)/u.exec(s);
    if (own) candidates.push({ start: own.index, end: own.index + own[0].length });
    const trailing = /(?<=\S)!+(?=\s*$)/u.exec(s);
    if (trailing) candidates.push({ start: trailing.index, end: trailing.index + trailing[0].length });
    candidates.sort((a, b) => a.start - b.start);
    const hit = candidates.find(free);
    if (hit) {
      claim('important', hit.start, hit.end);
      result.important = true;
    }
  }

  // Time
  for (const m of n.matchAll(TIME_RE)) {
    const [whole, as, colonH, colonM, plainH, hPart, hMin] = m;
    let minutes: number | undefined;
    if (colonH !== undefined && colonM !== undefined) {
      const h = Number(colonH);
      const mi = Number(colonM);
      if (h <= 23 && mi <= 59) minutes = h * 60 + mi;
    } else if (plainH !== undefined) {
      const h = Number(plainH);
      const mi = hMin !== undefined ? Number(hMin) : 0;
      const ok = as !== undefined ? h <= 23 : hPart !== undefined && h >= 7 && h <= 23;
      if (ok && mi <= 59) minutes = h * 60 + mi;
    }
    if (minutes === undefined) continue;
    const sp = { start: m.index, end: m.index + whole.length };
    if (!free(sp)) continue;
    claim('time', sp.start, sp.end);
    result.time = formatHHmm(minutes);
    break;
  }

  // Duration
  for (const m of n.matchAll(DURATION_RE)) {
    const [whole, h1, m1, minOnly, h3, m3] = m;
    let minutes: number;
    if (h1 !== undefined) {
      if (Number(m1) > 59) continue;
      minutes = Number(h1) * 60 + Number(m1);
    } else if (minOnly !== undefined) {
      minutes = Number(minOnly);
    } else {
      const h = Number(h3);
      if (h < 1 || h > 6) continue;
      if (m3 !== undefined && Number(m3) > 59) continue;
      if (/(?<![\p{L}\p{N}-])as\s+$/u.test(n.slice(0, m.index))) continue;
      minutes = h * 60 + (m3 !== undefined ? Number(m3) : 0);
    }
    const sp = { start: m.index, end: m.index + whole.length };
    if (!free(sp)) continue;
    claim('duration', sp.start, sp.end);
    result.durationMin = minutes;
    break;
  }

  // Date
  for (const m of n.matchAll(DATE_RE)) {
    const date = resolveDate(m, today);
    if (date === undefined) continue;
    let sp = { start: m.index, end: m.index + m[0].length };
    const weekday = m[9];
    if (weekday !== undefined) {
      const prev = PREV_WORD_RE.exec(n.slice(0, sp.start));
      const after = n.slice(sp.end);
      const queVem = QUE_VEM_RE.exec(after);
      if (AMBIGUOUS_WEEKDAYS.has(weekday)) {
        const gap = /^\s+/u.exec(after);
        const next = gap ? sp.end + gap[0].length : -1; // where the next word starts
        const inContext = (prev !== null && WEEKDAY_CONTEXT.has(prev[1]!))
          || ONLY_MARKERS_RE.test(after)
          || queVem !== null
          || (next >= 0 && tokens.some((t) => (t.type === 'time' || t.type === 'duration') && t.start === next))
          || (next >= 0 && dateTokenAt(n, next));
        if (!inContext) continue;
      }
      const wide = {
        start: prev !== null && WEEKDAY_GLUE.has(prev[1]!) ? prev.index : sp.start,
        end: sp.end + (queVem?.[0].length ?? 0),
      };
      if (free(wide)) sp = wide;
    }
    if (!free(sp)) continue;
    claim('date', sp.start, sp.end);
    result.date = date;
    break;
  }

  if (result.time !== undefined) {
    result.kind = 'commitment';
    result.date ??= today;
  }

  tokens.sort((a, b) => a.start - b.start);

  let title = '';
  let pos = 0;
  for (const t of tokens) {
    title += s.slice(pos, t.start) + ' ';
    pos = t.end;
  }
  title += s.slice(pos);
  result.title = title.replace(/\s+/g, ' ').trim();
  return result;
}

export function parseLines(input: string, today: DayKey): ParsedCapture[] {
  return input
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => parseCapture(l, today));
}
