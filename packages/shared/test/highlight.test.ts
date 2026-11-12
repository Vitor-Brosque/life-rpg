import { describe, expect, it } from 'vitest';
import { highlight, langOf } from '../src/highlight';

const kinds = (code: string, lang: string) => highlight(code, lang).filter((t) => t.k !== 'plain').map((t) => [t.k, t.v]);

describe('highlight', () => {
  it('python', () => {
    expect(kinds('def soma(x):  # soma\n    return "a" + 1', 'python')).toEqual([
      ['keyword', 'def'], ['comment', '# soma'], ['keyword', 'return'], ['string', '"a"'], ['number', '1'],
    ]);
  });
  it('sql is case-insensitive', () => {
    expect(kinds("select * FROM t WHERE a = 'x' -- fim", 'sql')).toEqual([
      ['keyword', 'select'], ['keyword', 'FROM'], ['keyword', 'WHERE'], ['string', "'x'"], ['comment', '-- fim'],
    ]);
  });
  it('javascript template strings and comments', () => {
    expect(kinds('const a = `x${1}`; // ok', 'js')).toEqual([['keyword', 'const'], ['string', '`x${1}`'], ['comment', '// ok']]);
  });
  it('bash: # starts a comment only at the start or after a space', () => {
    expect(kinds('echo $# # n', 'sh')).toEqual([['keyword', 'echo'], ['comment', '# n']]);
  });
  it('unknown language = one plain token; text always round-trips', () => {
    expect(highlight('a < b', 'text')).toEqual([{ k: 'plain', v: 'a < b' }]);
    expect(highlight('', 'python')).toEqual([]);
    const samples: Array<[string, string]> = [['def f():\n  pass # x', 'python'], ["SELECT 'a''b'", 'sql'], ['x = […]', 'python']];
    for (const [code, lang] of samples) expect(highlight(code, lang).map((t) => t.v).join('')).toBe(code);
    expect(langOf('PY')).toBe('python');
    expect(langOf('ruby')).toBeUndefined();
  });
});
