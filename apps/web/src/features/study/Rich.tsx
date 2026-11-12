import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MdBlock, MdInline } from '@life/shared';
import { CLOZE_CLOSE, CLOZE_OPEN, highlight, langOf, parseMarkdown } from '@life/shared';

// Card Markdown as React elements (spec §7). Cloze sentinels may span several nodes, so one
// cursor walks every text piece in render order and wraps the marked parts in <mark class="cloze">.

interface Cursor { open: boolean }

function pieces(text: string, cur: Cursor, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = '';
  const flush = (): void => {
    if (!buf) return;
    const k = `${key}-${out.length}`;
    out.push(cur.open ? <mark key={k} className="cloze">{buf}</mark> : <Fragment key={k}>{buf}</Fragment>);
    buf = '';
  };
  for (const ch of text) {
    if (ch === CLOZE_OPEN) { flush(); cur.open = true; }
    else if (ch === CLOZE_CLOSE) { flush(); cur.open = false; }
    else buf += ch;
  }
  flush();
  return out;
}

/** Math without sentinels, and whether any part of it is marked. */
function consumeMath(tex: string, cur: Cursor): { clean: string; marked: boolean } {
  let marked = cur.open;
  let clean = '';
  for (const ch of tex) {
    if (ch === CLOZE_OPEN) { cur.open = true; marked = true; }
    else if (ch === CLOZE_CLOSE) cur.open = false;
    else clean += ch;
  }
  return { clean, marked };
}

type KatexRender = (tex: string, display: boolean) => string;
let katexLoad: Promise<KatexRender> | undefined;

/** Loads KaTeX (JS + CSS + fonts) once, on the first formula. */
export function loadKatex(): Promise<KatexRender> {
  katexLoad ??= import('./katexRender').then((m) => m.renderTex);
  return katexLoad;
}

function MathTex({ tex, display, marked }: { tex: string; display: boolean; marked: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setHtml(null);
    loadKatex().then((render) => {
      if (!alive) return;
      try { setHtml(render(tex, display)); } catch { setHtml(null); }
    }, () => undefined);
    return () => { alive = false; };
  }, [tex, display]);
  const cls = display ? 'rich__math rich__math--block' : 'rich__math';
  let body: ReactNode;
  if (html === null) body = <code className="rich__math-src">{display ? `$$${tex}$$` : `$${tex}$`}</code>;
  // KaTeX output with trust: false is the one place raw HTML is allowed (spec §7).
  else if (display) body = <div className={cls} dangerouslySetInnerHTML={{ __html: html }} />;
  else body = <span className={cls} dangerouslySetInnerHTML={{ __html: html }} />;
  return marked ? <mark className="cloze">{body}</mark> : body;
}

function inlines(nodes: MdInline[], cur: Cursor, key: string): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}.${i}`;
    switch (n.t) {
      case 'text': return <Fragment key={k}>{pieces(n.v, cur, k)}</Fragment>;
      case 'br': return <br key={k} />;
      case 'strong': return <strong key={k}>{inlines(n.c, cur, k)}</strong>;
      case 'em': return <em key={k}>{inlines(n.c, cur, k)}</em>;
      case 'code': return <code key={k} className="rich__code">{pieces(n.v, cur, k)}</code>;
      case 'math': {
        const m = consumeMath(n.v, cur);
        return <MathTex key={k} tex={m.clean} display={false} marked={m.marked} />;
      }
    }
  });
}

function codeBlock(code: string, lang: string | undefined, cur: Cursor, key: string): ReactNode {
  return (
    <pre key={key} className="rich__pre" data-lang={langOf(lang)}>
      <code>
        {highlight(code, lang).map((t, i) => {
          const k = `${key}.${i}`;
          return t.k === 'plain'
            ? <Fragment key={k}>{pieces(t.v, cur, k)}</Fragment>
            : <span key={k} className={`tok tok--${t.k}`}>{pieces(t.v, cur, k)}</span>;
        })}
      </code>
    </pre>
  );
}

function block(b: MdBlock, cur: Cursor, key: string): ReactNode {
  switch (b.t) {
    case 'p': return <p key={key}>{inlines(b.c, cur, key)}</p>;
    case 'pre': return codeBlock(b.v, b.lang, cur, key);
    case 'list': {
      const items = b.items.map((it, i) => <li key={`${key}.${i}`}>{inlines(it, cur, `${key}.${i}`)}</li>);
      return b.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    case 'math': {
      const m = consumeMath(b.v, cur);
      return <MathTex key={key} tex={m.clean} display marked={m.marked} />;
    }
  }
}

export interface RichProps { text: string; className?: string }

export function Rich({ text, className }: RichProps) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const cur: Cursor = { open: false };
  return <div className={['rich', className].filter(Boolean).join(' ')}>{blocks.map((b, i) => block(b, cur, `b${i}`))}</div>;
}

/** A code answer or solution, highlighted like a fenced block. */
export function CodeView({ code, lang, className }: { code: string; lang?: string; className?: string }) {
  return <div className={['rich', className].filter(Boolean).join(' ')}>{codeBlock(code, lang, { open: false }, 'code')}</div>;
}
