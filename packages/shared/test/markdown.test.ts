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

describe('document mode (caderno, perfil de estudo e apostilas)', () => {
  const doc = { doc: true };
  it('headings, rules and the card subset', () => {
    expect(parseMarkdown('# Normalização\n## 1FN ##\ntexto\n\n---\n- a', doc)).toEqual([
      { t: 'h', level: 1, c: [{ t: 'text', v: 'Normalização' }] },
      { t: 'h', level: 2, c: [{ t: 'text', v: '1FN' }] },
      { t: 'p', c: [{ t: 'text', v: 'texto' }] },
      { t: 'hr' },
      { t: 'list', ordered: false, items: [[{ t: 'text', v: 'a' }]] },
    ]);
    expect(parseMarkdown('#sem espaço', doc)).toEqual([{ t: 'p', c: [{ t: 'text', v: '#sem espaço' }] }]);
  });
  it('only http:// and https:// addresses become links; anything else stays text', () => {
    expect(parseInline('veja [o livro](https://exemplo.test/l?a=1) e [**site**](http://exemplo.test)', doc)).toEqual([
      { t: 'text', v: 'veja ' }, { t: 'link', href: 'https://exemplo.test/l?a=1', c: [{ t: 'text', v: 'o livro' }] },
      { t: 'text', v: ' e ' }, { t: 'link', href: 'http://exemplo.test', c: [{ t: 'strong', c: [{ t: 'text', v: 'site' }] }] },
    ]);
    for (const bad of ['[x](javascript:alert(1))', '[x](data:text/html,oi)', '[x](//exemplo.test)', '[x](ftp://exemplo.test)', '[x](https://)']) {
      expect(parseInline(bad, doc).every((n) => n.t !== 'link')).toBe(true);
    }
    expect(parseInline('**[a](https://exemplo.test)**', doc)).toEqual([{ t: 'strong', c: [{ t: 'link', href: 'https://exemplo.test', c: [{ t: 'text', v: 'a' }] }] }]);
  });
  it('cards keep the card subset: no headings, rules or links', () => {
    expect(parseMarkdown('# título\n---')).toEqual([{ t: 'p', c: [{ t: 'text', v: '# título' }, { t: 'br' }, { t: 'text', v: '---' }] }]);
    expect(parseInline('[site](https://x.y)')).toEqual([{ t: 'text', v: '[site](https://x.y)' }]);
  });
  it('a closing # run is dropped only after a space; tabs open a heading too', () => {
    const h = (src: string) => parseMarkdown(src, doc)[0];
    expect(h('# C# ##')).toEqual({ t: 'h', level: 1, c: [{ t: 'text', v: 'C#' }] });
    expect(h('### C#')).toEqual({ t: 'h', level: 3, c: [{ t: 'text', v: 'C#' }] });
    expect(h('# ##')).toEqual({ t: 'h', level: 1, c: [{ t: 'text', v: '##' }] });
    expect(h('#\tSQL \t#  ')).toEqual({ t: 'h', level: 1, c: [{ t: 'text', v: 'SQL' }] });
    expect(h('####### sete')).toEqual({ t: 'p', c: [{ t: 'text', v: '####### sete' }] });
    expect(h('    # recuado')).toEqual({ t: 'p', c: [{ t: 'text', v: '    # recuado' }] });
  });
  it('brackets: the label ends at the first ], and only an http(s) address closed by ) is a link', () => {
    expect(parseInline('[[x](https://a.test)](javascript:1)', doc)).toEqual([
      { t: 'link', href: 'https://a.test', c: [{ t: 'text', v: '[x' }] }, { t: 'text', v: '](javascript:1)' },
    ]);
    expect(parseInline('[a](https://a.test b)', doc)).toEqual([{ t: 'text', v: '[a](https://a.test b)' }]);
    const link = parseInline('[x](https://a.test/"onmouseover="x)', doc)[0];
    expect(link).toEqual({ t: 'link', href: 'https://a.test/"onmouseover="x', c: [{ t: 'text', v: 'x' }] });
  });
});

describe('linear time on long lines (an apostila has up to 40,000 characters)', () => {
  // Each shape took seconds with the old backtracking patterns; a generous ceiling still catches a regression.
  const N = 40_000;
  const H = 'a'.repeat(64);
  const shapes: [string, string][] = [
    ['a heading with a long run of spaces', '# a' + ' '.repeat(N - 4) + 'x'],
    ['a heading with spaces and tabs before a #', '# a' + ' \t'.repeat((N - 5) / 2) + '#x'],
    ['a line full of [', '['.repeat(N)],
    ['a line of [a', '[a'.repeat(N / 2)],
    ['a line of ![a', '![a'.repeat(N / 3)],
    ['many [ before one ](https://… never closed', '['.repeat(N / 2) + '](https://' + 'a'.repeat(N / 2)],
    ['many [ before one ](media:… never closed', '['.repeat(N - 80) + '](media:' + H],
    ['emphasis openers without a closer', '*a '.repeat(N / 3)],
    ['a fence line with a long run of spaces', '```' + ' '.repeat(N) + 'x y'],
  ];
  for (const [name, src] of shapes) {
    it(name, () => {
      for (const mode of [{}, { doc: true }]) {
        const t0 = performance.now();
        parseMarkdown(src, mode);
        expect(performance.now() - t0).toBeLessThan(500);
      }
    });
  }
});
