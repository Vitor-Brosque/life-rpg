// Small Markdown subset for cards (spec §7): paragraphs, line breaks, **strong**, *em*, `code`,
// fenced code with a language, - / 1. lists, $math$ and $$math$$, \$ for a literal dollar.
// Marco 3c: media references `![legenda](media:<sha256>)` (image) and `[legenda](media:<sha256>)`
// (audio). Other links stay plain text. Output is a tree (never HTML): the web renders it as React.

export type MdInline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: MdInline[] }
  | { t: 'em'; c: MdInline[] }
  | { t: 'code'; v: string }
  | { t: 'math'; v: string }
  | { t: 'br' }
  | { t: 'img'; alt: string; hash: string }
  | { t: 'audio'; label: string; hash: string };

/** A media reference: `!` (image) or nothing (audio), the label, the file's SHA-256. */
export const MEDIA_REF_SOURCE = String.raw`(!?)\[([^\]\n]*)\]\(media:([0-9a-f]{64})\)`;
const MEDIA_REF_AT = new RegExp(MEDIA_REF_SOURCE, 'y');

export type MdBlock =
  | { t: 'p'; c: MdInline[] }
  | { t: 'pre'; lang: string; v: string }
  | { t: 'list'; ordered: boolean; items: MdInline[][] }
  | { t: 'math'; v: string };

const FENCE = /^\s*```\s*([\w+#-]*)\s*$/;
const FENCE_END = /^\s*```\s*$/;
const UL = /^\s*[-*]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: MdBlock[] = [];
  let para: string[] = [];
  const flush = (): void => {
    if (para.length) out.push({ t: 'p', c: parseInline(para.join('\n')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !FENCE_END.test(lines[i]!); i++) body.push(lines[i]!);
      out.push({ t: 'pre', lang: fence[1]!.toLowerCase(), v: body.join('\n') });
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
    const unordered = UL.test(line);
    const ordered = !unordered && OL.test(line);
    if (unordered || ordered) {
      flush();
      const re = ordered ? OL : UL;
      const items: MdInline[][] = [];
      for (; i < lines.length; i++) {
        const m = re.exec(lines[i]!);
        if (!m) break;
        items.push(parseInline(m[1]!));
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

const isSpace = (c: string | undefined): boolean => c === undefined || /\s/.test(c);

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

/** Closing `*` of an emphasis starting at `from` (not part of `**`, not after a space). */
function emEnd(s: string, from: number): number {
  if (isSpace(s[from])) return -1;
  for (let j = from; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '\n') return -1;
    if (s[j] === '*' && s[j + 1] !== '*' && !isSpace(s[j - 1])) return j;
  }
  return -1;
}

export function parseInline(s: string): MdInline[] {
  const out: MdInline[] = [];
  let text = '';
  const push = (n: MdInline): void => {
    if (text) { out.push({ t: 'text', v: text }); text = ''; }
    out.push(n);
  };
  for (let i = 0; i < s.length;) {
    const ch = s[i]!;
    if (ch === '\\' && '\\`*$'.includes(s[i + 1] ?? '\0')) { text += s[i + 1]; i += 2; continue; }
    if (ch === '\n') { push({ t: 'br' }); i++; continue; }
    if (ch === '!' || ch === '[') {
      MEDIA_REF_AT.lastIndex = i;
      const m = MEDIA_REF_AT.exec(s);
      if (m) {
        push(m[1] ? { t: 'img', alt: m[2]!, hash: m[3]! } : { t: 'audio', label: m[2]!, hash: m[3]! });
        i += m[0].length;
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
      if (j > i + 2) { push({ t: 'strong', c: parseInline(s.slice(i + 2, j)) }); i = j + 2; continue; }
    }
    if (ch === '*' && s[i + 1] !== '*') {
      const j = emEnd(s, i + 1);
      if (j > i + 1) { push({ t: 'em', c: parseInline(s.slice(i + 1, j)) }); i = j + 1; continue; }
    }
    text += ch;
    i++;
  }
  if (text) out.push({ t: 'text', v: text });
  return out;
}
