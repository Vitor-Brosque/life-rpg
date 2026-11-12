// Cloze syntax (spec §3): {{N::text}}. Saved text is always numbered, so inserting a new cloze
// never moves progress between cards. Private-use sentinels mark the span the renderer styles.

export const CLOZE_OPEN = '';
export const CLOZE_CLOSE = '';
export const CLOZE_HIDDEN = '[…]';

const CLOZE_RE = /\{\{(?:(\d+)::)?([\s\S]*?)\}\}/g;

/** Every {{…}} without a number gets the next free number, in reading order. */
export function numberClozes(text: string): string {
  let max = 0;
  for (const m of text.matchAll(CLOZE_RE)) if (m[1]) max = Math.max(max, Number(m[1]));
  return text.replace(CLOZE_RE, (all: string, n: string | undefined, inner: string) => (n ? all : `{{${++max}::${inner}}}`));
}

/** Distinct numbers of the non-empty clozes, ascending (one card each). */
export function clozeNumbers(text: string): number[] {
  const set = new Set<number>();
  for (const m of numberClozes(text).matchAll(CLOZE_RE)) if (m[2]!.trim() !== '') set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
}

/** Card `n`: the front hides group n as "[…]", the back reveals it; other groups read as plain text. */
export function renderCloze(text: string, n: number, side: 'front' | 'back'): string {
  return numberClozes(text).replace(CLOZE_RE, (_all: string, num: string, inner: string) => {
    if (Number(num) !== n) return inner;
    return CLOZE_OPEN + (side === 'front' ? CLOZE_HIDDEN : inner) + CLOZE_CLOSE;
  });
}

/** The answers in place of the markup (list titles, search). */
export function stripCloze(text: string): string {
  return text.replace(CLOZE_RE, (_all: string, _n: string | undefined, inner: string) => inner);
}

const MARK = '';

/**
 * The editor's "Lacuna": numbers the existing clozes, then wraps the selection [start, end) in
 * the next number. `cursor` is after the new cloze, or inside it when the selection was empty.
 */
export function wrapCloze(text: string, start: number, end: number): { text: string; cursor: number } {
  const selected = text.slice(start, end);
  const numbered = numberClozes(text.slice(0, start) + MARK + text.slice(end));
  let max = 0;
  for (const m of numbered.matchAll(CLOZE_RE)) max = Math.max(max, Number(m[1]));
  const open = `{{${max + 1}::`;
  const inserted = `${open}${selected}}}`;
  const at = numbered.indexOf(MARK);
  return {
    text: numbered.slice(0, at) + inserted + numbered.slice(at + MARK.length),
    cursor: at + (selected === '' ? open.length : inserted.length),
  };
}
