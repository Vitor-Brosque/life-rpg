import { describe, expect, it } from 'vitest';
import { CLOZE_CLOSE, CLOZE_HIDDEN, CLOZE_OPEN } from '../src/cloze';
import { parseInline, parseMarkdown } from '../src/markdown';

describe('parseMarkdown', () => {
  it('paragraphs with line breaks, separated by blank lines', () => {
    expect(parseMarkdown('a\nb\n\nc')).toEqual([
      { t: 'p', c: [{ t: 'text', v: 'a' }, { t: 'br' }, { t: 'text', v: 'b' }] },
      { t: 'p', c: [{ t: 'text', v: 'c' }] },
    ]);
  });
  it('fenced code keeps indentation and the (lower-cased) language', () => {
    expect(parseMarkdown('```Python\ndef f():\n    return 1\n```\ndepois')).toEqual([
      { t: 'pre', lang: 'python', v: 'def f():\n    return 1' },
      { t: 'p', c: [{ t: 'text', v: 'depois' }] },
    ]);
    expect(parseMarkdown('```\nx')).toEqual([{ t: 'pre', lang: '', v: 'x' }]);
  });
  it('lists', () => {
    expect(parseMarkdown('- a\n- **b**\n\n1. um\n2) dois')).toEqual([
      { t: 'list', ordered: false, items: [[{ t: 'text', v: 'a' }], [{ t: 'strong', c: [{ t: 'text', v: 'b' }] }]] },
      { t: 'list', ordered: true, items: [[{ t: 'text', v: 'um' }], [{ t: 'text', v: 'dois' }]] },
    ]);
  });
  it('block math on its own lines or on one line', () => {
    expect(parseMarkdown('$$\nx^2\n$$')).toEqual([{ t: 'math', v: 'x^2' }]);
    expect(parseMarkdown('$$ a+b $$')).toEqual([{ t: 'math', v: 'a+b' }]);
  });
  it('HTML is plain text', () => {
    expect(parseMarkdown('<b>oi</b>')).toEqual([{ t: 'p', c: [{ t: 'text', v: '<b>oi</b>' }] }]);
  });
  it('keeps cloze sentinels in text and in code', () => {
    const s = `x ${CLOZE_OPEN}${CLOZE_HIDDEN}${CLOZE_CLOSE}`;
    expect(parseMarkdown(s)).toEqual([{ t: 'p', c: [{ t: 'text', v: s }] }]);
    expect(parseMarkdown('```\n' + s + '\n```')).toEqual([{ t: 'pre', lang: '', v: s }]);
  });
});

describe('parseInline', () => {
  it('strong, em and code', () => {
    expect(parseInline('**a** *b* `c*d`')).toEqual([
      { t: 'strong', c: [{ t: 'text', v: 'a' }] }, { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' ' }, { t: 'code', v: 'c*d' },
    ]);
  });
  it('inline math and the escaped dollar', () => {
    expect(parseInline('se $x^2$ então')).toEqual([{ t: 'text', v: 'se ' }, { t: 'math', v: 'x^2' }, { t: 'text', v: ' então' }]);
    expect(parseInline('custa \\$5')).toEqual([{ t: 'text', v: 'custa $5' }]);
  });
  it('prices, lone stars and snake_case stay text', () => {
    expect(parseInline('de $5 a $10')).toEqual([{ t: 'text', v: 'de $5 a $10' }]);
    expect(parseInline('2 * 3 * 4')).toEqual([{ t: 'text', v: '2 * 3 * 4' }]);
    expect(parseInline('snake_case_name')).toEqual([{ t: 'text', v: 'snake_case_name' }]);
  });
});
