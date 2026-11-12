// Pure text edits behind the code editor (spec §6). Offsets are textarea selection offsets.

export const INDENT = '    ';
export interface EditResult { value: string; start: number; end: number }

const lineStartOf = (v: string, pos: number): number => (pos === 0 ? 0 : v.lastIndexOf('\n', pos - 1) + 1);

/** Tab: 4 spaces at a collapsed cursor, else indent every touched line. Shift+Tab: outdent them. */
export function indentLines(value: string, start: number, end: number, outdent: boolean): EditResult {
  if (start === end && !outdent) {
    const pos = start + INDENT.length;
    return { value: value.slice(0, start) + INDENT + value.slice(end), start: pos, end: pos };
  }
  const from = lineStartOf(value, start);
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const nl = value.indexOf('\n', last);
  const to = nl === -1 ? value.length : nl;
  let removedFirst = 0;
  let delta = 0;
  const lines = value.slice(from, to).split('\n').map((line, i) => {
    if (!outdent) { delta += INDENT.length; return INDENT + line; }
    const n = line.startsWith('\t') ? 1 : (/^ {1,4}/.exec(line)?.[0].length ?? 0);
    if (i === 0) removedFirst = n;
    delta -= n;
    return line.slice(n);
  });
  const next = value.slice(0, from) + lines.join('\n') + value.slice(to);
  if (!outdent) return { value: next, start: start + INDENT.length, end: end + delta };
  return { value: next, start: Math.max(from, start - removedFirst), end: Math.max(from, end + delta) };
}

/** Enter: a new line that starts with the current line's indentation. */
export function newlineIndent(value: string, start: number, end: number): EditResult {
  const indent = /^[ \t]*/.exec(value.slice(lineStartOf(value, start), start))![0];
  const insert = `\n${indent}`;
  const pos = start + insert.length;
  return { value: value.slice(0, start) + insert + value.slice(end), start: pos, end: pos };
}
