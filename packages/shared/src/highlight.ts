// Tiny syntax highlighter for card code (spec §7): keywords, strings, comments and numbers in
// python, sql, javascript and bash. Tokens always concatenate back to the input (cloze
// sentinels survive inside plain tokens).

export type TokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number';
export interface CodeToken { k: TokenKind; v: string }
export type HighlightLang = 'python' | 'sql' | 'javascript' | 'bash';

const ALIASES: Record<string, HighlightLang> = {
  python: 'python', py: 'python',
  sql: 'sql', postgres: 'sql', postgresql: 'sql',
  javascript: 'javascript', js: 'javascript', jsx: 'javascript', ts: 'javascript', tsx: 'javascript', typescript: 'javascript',
  bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash',
};

export function langOf(name?: string): HighlightLang | undefined {
  return name ? ALIASES[name.toLowerCase()] : undefined;
}

interface LangDef { comment: RegExp; string: RegExp; keywords: Set<string>; caseInsensitive?: boolean; commentAfterSpace?: boolean }
const words = (s: string): Set<string> => new Set(s.trim().split(/\s+/));

const LANGS: Record<HighlightLang, LangDef> = {
  python: {
    comment: /#[^\n]*/y,
    string: /(?:[rRbBfFuU]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)/y,
    keywords: words(`False None True and as assert async await break class continue def del elif else except
      finally for from global if import in is lambda nonlocal not or pass raise return try while with yield
      match case self print len range`),
  },
  sql: {
    comment: /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y,
    string: /'(?:''|[^'])*'?/y,
    keywords: words(`select from where and or not insert into values update set delete create table drop alter
      add column join inner left right full outer cross on using group by order having limit offset as distinct
      union all null is in like ilike between exists case when then else end primary key foreign references
      index view with returning asc desc count sum avg min max coalesce cast true false default constraint
      unique serial integer int bigint text varchar boolean date timestamp`),
    caseInsensitive: true,
  },
  javascript: {
    comment: /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y,
    string: /"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\[\s\S]|[^`\\])*`?/y,
    keywords: words(`const let var function return if else for while do switch case break continue new class
      extends import export from default async await try catch finally throw typeof instanceof in of null
      undefined true false this super yield delete void`),
  },
  bash: {
    comment: /#[^\n]*/y,
    string: /"(?:\\.|[^"\\])*"?|'[^']*'?/y,
    keywords: words(`if then else elif fi for while until do done case esac in function return export local
      echo cd ls grep cat sudo git npm pip python docker source`),
    commentAfterSpace: true,
  },
};

const WORD = /[A-Za-z_]\w*/y;
const NUMBER = /\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

export function highlight(code: string, lang?: string): CodeToken[] {
  const id = langOf(lang);
  if (!id) return code ? [{ k: 'plain', v: code }] : [];
  const def = LANGS[id];
  const out: CodeToken[] = [];
  const push = (k: TokenKind, v: string): void => {
    const last = out[out.length - 1];
    if (last && last.k === k) last.v += v;
    else out.push({ k, v });
  };
  let i = 0;
  const match = (re: RegExp): string | undefined => {
    re.lastIndex = i;
    const m = re.exec(code);
    return m && m[0] ? m[0] : undefined;
  };
  while (i < code.length) {
    const commentOk = !def.commentAfterSpace || i === 0 || /\s/.test(code[i - 1]!);
    let m: string | undefined;
    if (commentOk && (m = match(def.comment))) push('comment', m);
    else if ((m = match(def.string))) push('string', m);
    else if ((m = match(WORD))) push(def.keywords.has(def.caseInsensitive ? m.toLowerCase() : m) ? 'keyword' : 'plain', m);
    else if ((m = match(NUMBER))) push('number', m);
    else { m = code[i]!; push('plain', m); }
    i += m.length;
  }
  return out;
}
