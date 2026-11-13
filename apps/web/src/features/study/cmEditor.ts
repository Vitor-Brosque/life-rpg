// CodeMirror 6 behind CodeEditor (Marco 3b, spec §7). Only CodeEditor.tsx imports this file, and
// only through import(): none of it lands in the main bundle. The chunk is precached by the
// service worker like every built .js file, so the editor works offline.
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder as placeholderText } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { tagHighlighter, tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { PostgreSQL, sql } from '@codemirror/lang-sql';
import type { CodeLang } from '@life/shared';

export interface CmOptions {
  doc: string;
  language: CodeLang;
  readOnly: boolean;
  rows: number;
  /** Coarse pointer: 16 px text so iOS does not zoom in on focus. */
  touch: boolean;
  placeholder?: string;
  /** Attributes of the editable element (id, aria-labelledby). */
  attrs: Record<string, string>;
  /** id of the "Esc para sair" hint, described while editable. */
  describedBy?: string;
  onChange(value: string): void;
}

export interface CmHandle {
  /** Replaces the text, with a fresh undo history, when `value` differs from the editor's. Never calls onChange. */
  setValue(value: string): void;
  setReadOnly(readOnly: boolean): void;
  setLanguage(language: CodeLang): void;
  /** The ⇥ / ⇤ buttons of touch screens. */
  indent(outdent: boolean): void;
  /** Focuses, optionally putting the cursor at `pos`. */
  focus(pos?: number): void;
  destroy(): void;
}

const INDENT = '    ';

/** Same classes as the read-only highlighter (Rich / CodeView): the colours come from study.css. */
const highlighter = tagHighlighter([
  { tag: [t.keyword, t.bool, t.null], class: 'tok--keyword' },
  { tag: [t.string, t.regexp], class: 'tok--string' },
  { tag: t.comment, class: 'tok--comment' },
  { tag: t.number, class: 'tok--number' },
]);

function languageOf(lang: CodeLang): Extension {
  switch (lang) {
    case 'python': return python();
    case 'sql': return sql({ dialect: PostgreSQL }); // the Tech News database
    case 'javascript': return javascript();
    default: return []; // bash, text: plain (the read-only view still highlights bash)
  }
}

/** Tab: 4 spaces at a collapsed cursor; with a selection, indent the touched lines. */
export function tabKey(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly) return false;
  if (state.selection.ranges.some((r) => !r.empty)) return indentMore(view);
  view.dispatch(state.update(state.replaceSelection(INDENT), { scrollIntoView: true, userEvent: 'input' }));
  return true;
}

/** Esc leaves the editor (Tab is taken, so this is the keyboard way out); the event stops here. */
const escapeKey = Prec.highest(keymap.of([{
  key: 'Escape',
  run: (view) => { view.contentDOM.blur(); return true; },
  stopPropagation: true,
}]));

const keys = keymap.of([
  { key: 'Tab', run: tabKey, shift: indentLess },
  // Ctrl/Cmd+Enter belongs to the screen ("Salvar e próximo"), not to insertBlankLine.
  ...defaultKeymap.filter((b) => b.key !== 'Mod-Enter'),
  ...historyKeymap,
]);

function theme(rows: number, touch: boolean): Extension {
  return EditorView.theme({
    '&': {
      color: 'var(--text)',
      backgroundColor: 'var(--bg)',
      fontSize: touch ? '1rem' : '0.9375rem',
      boxShadow: 'inset 0 0 0 2px var(--stone-light)',
    },
    '&.cm-focused': { outline: '3px solid var(--gold)', outlineOffset: '0' },
    '.cm-scroller': { fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace", lineHeight: '1.5' },
    '.cm-content': { minHeight: `${rows * 1.5}em`, padding: '10px 0', caretColor: 'var(--gold)' },
    '.cm-line': { padding: '0 12px 0 6px' },
    '.cm-gutters': { color: 'var(--text-dim)', backgroundColor: 'var(--bg-2)', border: 'none' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--gold)' },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--stone-light)', outline: '1px solid var(--gold-dark)' },
    '.cm-placeholder': { color: 'var(--text-dim)' },
  }, { dark: true });
}

export function createCodeEditor(parent: HTMLElement, o: CmOptions): CmHandle {
  const lang = new Compartment();
  const ro = new Compartment();
  const attrs = new Compartment();
  let current = { readOnly: o.readOnly, language: o.language };
  const roExt = (readOnly: boolean): Extension => [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
  const attrsExt = (readOnly: boolean): Extension => EditorView.contentAttributes.of({
    ...o.attrs,
    ...(readOnly ? { 'aria-readonly': 'true', tabindex: '0' } : o.describedBy ? { 'aria-describedby': o.describedBy } : {}),
  });
  const makeState = (doc: string): EditorState => EditorState.create({
    doc,
    extensions: [
      escapeKey,
      keys,
      lineNumbers(),
      history(),
      indentOnInput(),
      bracketMatching(),
      syntaxHighlighting(highlighter),
      indentUnit.of(INDENT),
      EditorState.tabSize.of(4),
      lang.of(languageOf(current.language)),
      ro.of(roExt(current.readOnly)),
      attrs.of(attrsExt(current.readOnly)),
      o.placeholder ? placeholderText(o.placeholder) : [],
      theme(o.rows, o.touch),
      EditorView.updateListener.of((u) => { if (u.docChanged) o.onChange(u.state.doc.toString()); }),
    ],
  });
  const view = new EditorView({ state: makeState(o.doc), parent });

  return {
    setValue(value) {
      if (value !== view.state.doc.toString()) view.setState(makeState(value));
    },
    setReadOnly(readOnly) {
      if (readOnly === current.readOnly) return;
      current = { ...current, readOnly };
      view.dispatch({ effects: [ro.reconfigure(roExt(readOnly)), attrs.reconfigure(attrsExt(readOnly))] });
    },
    setLanguage(language) {
      if (language === current.language) return;
      current = { ...current, language };
      view.dispatch({ effects: lang.reconfigure(languageOf(language)) });
    },
    indent(outdent) {
      if (outdent) indentLess(view);
      else tabKey(view);
      view.focus();
    },
    focus(pos) {
      if (pos !== undefined) view.dispatch({ selection: { anchor: Math.min(pos, view.state.doc.length) } });
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}
