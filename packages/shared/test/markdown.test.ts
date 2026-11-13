import { describe, expect, it } from 'vitest';
import { CLOZE_CLOSE, CLOZE_HIDDEN, CLOZE_OPEN, renderCloze } from '../src/cloze';
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

describe('media references', () => {
  const H1 = 'a'.repeat(64);
  const H2 = 'b'.repeat(64);
  it('image and audio nodes; other links stay text', () => {
    expect(parseInline(`a ![m](media:${H1}) b [ouça](media:${H2})`)).toEqual([
      { t: 'text', v: 'a ' }, { t: 'img', alt: 'm', hash: H1 }, { t: 'text', v: ' b ' }, { t: 'audio', label: 'ouça', hash: H2 },
    ]);
    expect(parseInline('[site](https://x.y) ![a](media:zz)')).toEqual([{ t: 'text', v: '[site](https://x.y) ![a](media:zz)' }]);
    expect(parseInline(`!![e](media:${H1})`)).toEqual([{ t: 'text', v: '!' }, { t: 'img', alt: 'e', hash: H1 }]);
  });
  it('inside strong and lists, never inside code', () => {
    expect(parseInline(`**![b](media:${H1})**`)).toEqual([{ t: 'strong', c: [{ t: 'img', alt: 'b', hash: H1 }] }]);
    expect(parseInline('`![c](media:' + H1 + ')`')).toEqual([{ t: 'code', v: `![c](media:${H1})` }]);
    expect(parseMarkdown(`- ponto\n- ![d](media:${H1})`)).toEqual([
      { t: 'list', ordered: false, items: [[{ t: 'text', v: 'ponto' }], [{ t: 'img', alt: 'd', hash: H1 }]] },
    ]);
  });
  it('a cloze hides the image on the front and wraps it on the back', () => {
    const src = `Capital: {{1::![Brasília](media:${H1})}}`;
    expect(renderCloze(src, 1, 'front')).toBe(`Capital: ${CLOZE_OPEN}${CLOZE_HIDDEN}${CLOZE_CLOSE}`);
    expect(parseInline(renderCloze(src, 1, 'back'))).toEqual([
      { t: 'text', v: `Capital: ${CLOZE_OPEN}` }, { t: 'img', alt: 'Brasília', hash: H1 }, { t: 'text', v: CLOZE_CLOSE },
    ]);
  });
});
