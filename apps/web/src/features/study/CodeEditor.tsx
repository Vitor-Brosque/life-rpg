import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import type { CodeLang } from '@life/shared';
import { useMediaQuery } from '../../ui/useMediaQuery';
import { indentLines, newlineIndent, type EditResult } from './codeEdit';
import type { CmHandle } from './cmEditor';

export interface CodeEditorProps {
  value: string;
  onChange(value: string): void;
  label: string;
  id?: string;
  readOnly?: boolean;
  /** Minimum visible lines (read once, when the editor is created). */
  rows?: number;
  autoFocus?: boolean;
  placeholder?: string;
  /** Highlighting and auto-indent rules. 'bash' and 'text' (the default) are plain. */
  language?: CodeLang;
}

/**
 * Off in tests (test/setup.ts): jsdom has no layout for CodeMirror, so other suites keep the
 * textarea. codeMirror.test.tsx turns it on.
 */
export const codeEditorOptions = { enhanced: true };

type CmModule = typeof import('./cmEditor');
let cmLoad: Promise<CmModule> | undefined;

/** Loads the CodeMirror chunk once. A failed load (offline before the first cache) is retried on the next mount. */
export function loadCodeMirror(): Promise<CmModule> {
  cmLoad ??= import('./cmEditor').catch((e: unknown) => {
    cmLoad = undefined;
    throw e;
  });
  return cmLoad;
}

/**
 * Code field (spec §7): CodeMirror 6 once its chunk is loaded; until then, or if it fails, the
 * Marco 3 textarea with the same Tab / Shift+Tab / Enter / Esc keys. Touch screens get ⇥ ⇤.
 */
export function CodeEditor({
  value, onChange, label, id, readOnly = false, rows = 8, autoFocus, placeholder, language = 'text',
}: CodeEditorProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const labelId = `${inputId}-label`;
  const hintId = `${inputId}-hint`;
  const touch = useMediaQuery('(pointer: coarse)');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const cmRef = useRef<CmHandle | null>(null);
  const [cmReady, setCmReady] = useState(false);
  // Latest props for the async creation and for CodeMirror's listener.
  const latest = useRef({ value, onChange, readOnly, language });
  latest.current = { value, onChange, readOnly, language };

  useEffect(() => {
    if (!codeEditorOptions.enhanced) return;
    let alive = true;
    loadCodeMirror().then((cm) => {
      const host = hostRef.current;
      if (!alive || !host) return;
      const ta = taRef.current;
      const hadFocus = !!ta && document.activeElement === ta;
      const caret = ta?.selectionStart ?? 0;
      const now = latest.current;
      cmRef.current = cm.createCodeEditor(host, {
        doc: now.value, language: now.language, readOnly: now.readOnly, rows, touch, placeholder,
        attrs: { id: inputId, 'aria-labelledby': labelId }, describedBy: hintId,
        onChange: (v) => latest.current.onChange(v),
      });
      // Swap before the next paint: the textarea leaves in the same frame CodeMirror appears.
      flushSync(() => setCmReady(true));
      if (hadFocus) cmRef.current.focus(caret);
      else if (autoFocus && (!ta || document.activeElement === document.body)) cmRef.current.focus();
    }).catch((e: unknown) => {
      cmRef.current?.destroy();
      cmRef.current = null;
      console.warn('CodeMirror indisponível; o campo simples continua.', e);
    });
    return () => {
      alive = false;
      cmRef.current?.destroy();
      cmRef.current = null;
      setCmReady(false);
    };
    // Created once per mount; later prop changes go through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { cmRef.current?.setValue(value); }, [value, cmReady]);
  useEffect(() => { cmRef.current?.setReadOnly(readOnly); }, [readOnly, cmReady]);
  useEffect(() => { cmRef.current?.setLanguage(language); }, [language, cmReady]);

  const apply = (r: EditResult): void => {
    onChange(r.value);
    requestAnimationFrame(() => taRef.current?.setSelectionRange(r.start, r.end));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (readOnly || e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      apply(indentLines(el.value, el.selectionStart, el.selectionEnd, e.shiftKey));
    } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      apply(newlineIndent(el.value, el.selectionStart, el.selectionEnd));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      el.blur();
    }
  };
  const tool = (outdent: boolean): void => {
    if (cmRef.current) { cmRef.current.indent(outdent); return; }
    const el = taRef.current;
    if (el) apply(indentLines(el.value, el.selectionStart, el.selectionEnd, outdent));
  };

  return (
    <div className="code-editor field">
      <label className="field__label" id={labelId} htmlFor={cmReady ? undefined : inputId}
        onClick={cmReady ? () => cmRef.current?.focus() : undefined}>{label}</label>
      {touch && !readOnly && (
        <div className="code-editor__tools">
          <button type="button" className="code-editor__tool" aria-label="Indentar"
            onPointerDown={(e) => e.preventDefault()} onClick={() => tool(false)}>⇥</button>
          <button type="button" className="code-editor__tool" aria-label="Desindentar"
            onPointerDown={(e) => e.preventDefault()} onClick={() => tool(true)}>⇤</button>
        </div>
      )}
      {!cmReady && (
        <textarea
          ref={taRef} id={inputId} className="code-editor__input" value={value} rows={rows} readOnly={readOnly}
          placeholder={placeholder} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off"
          wrap="off" autoFocus={autoFocus} aria-describedby={readOnly ? undefined : hintId}
          onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown}
        />
      )}
      <div ref={hostRef} className="code-editor__cm" />
      {!readOnly && <p id={hintId} className="code-editor__hint">Tab indenta · Shift+Tab desindenta · Esc para sair</p>}
    </div>
  );
}
