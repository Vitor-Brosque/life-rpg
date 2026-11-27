// Small Markdown subset for cards (spec §7): paragraphs, line breaks, **strong**, *em*, `code`,
// fenced code with a language, - / 1. lists, $math$ and $$math$$, \$ for a literal dollar.
// Marco 3c: media references `![legenda](media:<sha256>)` (image) and `[legenda](media:<sha256>)`
// (audio). Other links stay plain text. Output is a tree (never HTML): the web renders it as React.
// Caderno da disciplina (2026-11-26): with `{ doc: true }` (the notebook, the study profile and the apostilas) it also
// reads # headings, --- rules and [links](https://…); only http:// and https:// addresses become links.
// Linear time (review of 2026-11-26): an apostila has up to 40,000 characters, so headings, fences, links, media and
// emphasis are read with plain loops and with scans that remember how far they already looked, never with a pattern
// that backtracks over a long run (a line full of `[`, of spaces or of `*` would freeze the screen for seconds).

export type MdInline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: MdInline[] }
  | { t: 'em'; c: MdInline[] }
  | { t: 'code'; v: string }
  | { t: 'math'; v: string }
  | { t: 'br' }
  | { t: 'img'; alt: string; hash: string }
  | { t: 'audio'; label: string; hash: string }
  | { t: 'link'; href: string; c: MdInline[] };

/** A media reference: `!` (image) or nothing (audio), the label, the file's SHA-256. */
export const MEDIA_REF_SOURCE = String.raw`(!?)\[([^\]\n]*)\]\(media:([0-9a-f]{64})\)`;

export type MdBlock =
  | { t: 'p'; c: MdInline[] }
  | { t: 'pre'; lang: string; v: string }
  | { t: 'list'; ordered: boolean; items: MdInline[][] }
  | { t: 'math'; v: string }
  | { t: 'h'; level: 1 | 2 | 3 | 4 | 5 | 6; c: MdInline[] }
  | { t: 'hr' };

/** `doc`: the document subset (headings, rules and http(s) links) on top of the card subset. */
export interface MdOptions { doc?: boolean }

const FENCE_LANG = /^[\w+#-]*$/;
const UL = /^\s*[-*]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
/** Only the opening of a heading: the rest of the line is read by `headingOf` without a pattern. */
const HEADING_OPEN = /^\s{0,3}(#{1,6})\s+/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const HASH = /^[0-9a-f]{64}$/;
const WS = /\s/;
const isWs = (c: string | undefined): boolean => c !== undefined && WS.test(c);
/** U+2028 and U+2029: line separators that `.` in a pattern never crossed. */
const LINE_SEPARATORS = [String.fromCharCode(0x2028), String.fromCharCode(0x2029)];

/** An http:// or https:// address that parses; anything else (javascript:, data:, …) is never a link. */
export function isWebUrl(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** The language of a line that opens a fence (```` ```sql ````), or undefined. */
function fenceLang(line: string): string | undefined {
  const t = line.trim();
  if (!t.startsWith('```')) return undefined;
  const lang = t.slice(3).trimStart();
  return FENCE_LANG.test(lang) ? lang : undefined;
}

/** A `#` heading: its level and text, without a closing `#` run that follows a space (`## 1FN ##`). */
function headingOf(line: string): { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | undefined {
  const m = HEADING_OPEN.exec(line);
  if (!m) return undefined;
  const rest = line.slice(m[0].length).trimEnd();
  let text = rest;
  let k = rest.length;
  while (k > 0 && rest[k - 1] === '#') k--;
  if (k < rest.length && isWs(rest[k - 1])) {
    while (k > 0 && isWs(rest[k - 1])) k--;
    text = rest.slice(0, k);
  }
  // A line separator (U+2028, U+2029) inside the text never made a heading: it stays a paragraph, as before.
  if (LINE_SEPARATORS.some((c) => text.includes(c))) return undefined;
  return { level: m[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, text };
}

export function parseMarkdown(src: string, opts: MdOptions = {}): MdBlock[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: MdBlock[] = [];
  let para: string[] = [];
  const flush = (): void => {
    if (para.length) out.push({ t: 'p', c: parseInline(para.join('\n'), opts) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lang = fenceLang(line);
    if (lang !== undefined) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && lines[i]!.trim() !== '```'; i++) body.push(lines[i]!);
      out.push({ t: 'pre', lang: lang.toLowerCase(), v: body.join('\n') });
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === '$$') {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && lines[i]!.trim() !== '$$'; i++) body.push(lines[i]!);
      out.push({ t: 'math', v: body.join('\n').trim() });
      continue;
    }
    const oneLine = /^\$\$(.+)\$\$$/.exec(trimmed);
    if (oneLine) {
      flush();
      out.push({ t: 'math', v: oneLine[1]!.trim() });
      continue;
    }
    if (opts.doc) {
      const h = headingOf(line);
      if (h) {
        flush();
        out.push({ t: 'h', level: h.level, c: parseInline(h.text, opts) });
        continue;
      }
      if (RULE.test(line)) {
        flush();
        out.push({ t: 'hr' });
        continue;
      }
    }
    const unordered = UL.test(line);
    const ordered = !unordered && OL.test(line);
    if (unordered || ordered) {
      flush();
      const re = ordered ? OL : UL;
      const items: MdInline[][] = [];
      for (; i < lines.length; i++) {
        const m = re.exec(lines[i]!);
        if (!m) break;
        items.push(parseInline(m[1]!, opts));
      }
      i--;
      out.push({ t: 'list', ordered, items });
      continue;
    }
    if (trimmed === '') { flush(); continue; }
    para.push(line);
  }
  flush();
  return out;
}

const isSpace = (c: string | undefined): boolean => c === undefined || WS.test(c);

/** Closing `$` of inline math starting at `from`: content may not start or end with a space. */
function mathEnd(s: string, from: number): number {
  if (isSpace(s[from])) return -1;
  for (let j = from; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '\n') return -1;
    if (s[j] === '$') return isSpace(s[j - 1]) ? -1 : j;
  }
  return -1;
}

/** The http(s) address of a link that starts at `from` (right after `](`) and ends at `)`, or null. */
function webAddressAt(s: string, from: number): string | null {
  const start = s.startsWith('https://', from) ? from + 8 : s.startsWith('http://', from) ? from + 7 : -1;
  if (start < 0) return null;
  let end = start;
  while (end < s.length && s[end] !== '(' && s[end] !== ')' && !WS.test(s[end]!)) end++;
  if (end === start || s[end] !== ')') return null;
  const href = s.slice(from, end);
  return isWebUrl(href) ? href : null;
}

export function parseInline(s: string, opts: MdOptions = {}): MdInline[] {
  const out: MdInline[] = [];
  let text = '';
  const push = (n: MdInline): void => {
    if (text) { out.push({ t: 'text', v: text }); text = ''; }
    out.push(n);
  };

  // The end of a `[label]`: the first `]` or line break at or after `from`. The answer covers every `from` up to it,
  // so a run of `[` is scanned once.
  let stopFrom = -1;
  let stopAt = -1;
  const labelEnd = (from: number): number => {
    if (from < stopFrom || from > stopAt) {
      let j = from;
      while (j < s.length && s[j] !== ']' && s[j] !== '\n') j++;
      stopFrom = from;
      stopAt = j;
    }
    return stopAt;
  };

  /** `![label](media:<sha256>)` (image) or `[label](media:<sha256>)` (audio) at `i`. */
  const mediaAt = (i: number): { node: MdInline; end: number } | undefined => {
    const img = s[i] === '!';
    const open = img ? i + 1 : i;
    if (s[open] !== '[') return undefined;
    const close = labelEnd(open + 1);
    if (s[close] !== ']' || !s.startsWith('(media:', close + 1)) return undefined;
    const hash = s.slice(close + 8, close + 72);
    if (!HASH.test(hash) || s[close + 72] !== ')') return undefined;
    const label = s.slice(open + 1, close);
    return { node: img ? { t: 'img', alt: label, hash } : { t: 'audio', label, hash }, end: close + 73 };
  };

  // Every `[` before the same `]` shares the address after it: read it once.
  let addressAfter = -1;
  let address: string | null = null;
  /** `[label](http(s)://…)` at `i` (document mode). */
  const linkAt = (i: number): { href: string; label: string; end: number } | undefined => {
    const close = labelEnd(i + 1);
    if (close === i + 1 || s[close] !== ']' || s[close + 1] !== '(') return undefined;
    if (close !== addressAfter) { addressAfter = close; address = webAddressAt(s, close + 2); }
    if (address === null) return undefined;
    return { href: address, label: s.slice(i + 1, close), end: close + 3 + address.length };
  };

  // Closing `*` of an emphasis that starts at `from` (not part of `**`, not after a space). When a scan reaches the
  // end of the line without a closer, no later opener up to there has one either: the scans of the openers after it
  // walk the same characters (an opener is never the escaped character of a `\`).
  let emNoCloserUntil = -1;
  const emEnd = (from: number): number => {
    if (isSpace(s[from]) || from <= emNoCloserUntil) return -1;
    for (let j = from; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] === '\n') { emNoCloserUntil = j; return -1; }
      if (s[j] === '*' && s[j + 1] !== '*' && !isSpace(s[j - 1])) return j;
    }
    emNoCloserUntil = s.length;
    return -1;
  };

  for (let i = 0; i < s.length;) {
    const ch = s[i]!;
    if (ch === '\\' && '\\`*$'.includes(s[i + 1] ?? '\0')) { text += s[i + 1]; i += 2; continue; }
    if (ch === '\n') { push({ t: 'br' }); i++; continue; }
    if (ch === '!' || ch === '[') {
      const m = mediaAt(i);
      if (m) { push(m.node); i = m.end; continue; }
    }
    if (ch === '[' && opts.doc) {
      const m = linkAt(i);
      if (m) {
        // The label never holds another link.
        push({ t: 'link', href: m.href, c: parseInline(m.label) });
        i = m.end;
        continue;
      }
    }
    if (ch === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) { push({ t: 'code', v: s.slice(i + 1, j) }); i = j + 1; continue; }
    }
    if (ch === '$') {
      const j = mathEnd(s, i + 1);
      if (j > 0) { push({ t: 'math', v: s.slice(i + 1, j) }); i = j + 1; continue; }
    }
    if (s.startsWith('**', i)) {
      const j = s.indexOf('**', i + 2);
      if (j > i + 2) { push({ t: 'strong', c: parseInline(s.slice(i + 2, j), opts) }); i = j + 2; continue; }
    }
    if (ch === '*' && s[i + 1] !== '*') {
      const j = emEnd(i + 1);
      if (j > i + 1) { push({ t: 'em', c: parseInline(s.slice(i + 1, j), opts) }); i = j + 1; continue; }
    }
    text += ch;
    i++;
  }
  if (text) out.push({ t: 'text', v: text });
  return out;
}
