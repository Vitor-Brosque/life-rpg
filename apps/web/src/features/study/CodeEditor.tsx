import { useId, useRef, type KeyboardEvent } from 'react';
import { useMediaQuery } from '../../ui/useMediaQuery';
import { indentLines, newlineIndent, type EditResult } from './codeEdit';

export interface CodeEditorProps {
  value: string;
  onChange(value: string): void;
  label: string;
  id?: string;
  readOnly?: boolean;
  rows?: number;
  autoFocus?: boolean;
  placeholder?: string;
}

/**
 * Monospace code field (spec §6): Tab / Shift+Tab (de)indent, Enter keeps the indentation, Esc
 * leaves the field (Tab is captured, so this is the keyboard way out). Touch screens get ⇥ ⇤.
 */
export function CodeEditor({ value, onChange, label, id, readOnly, rows = 8, autoFocus, placeholder }: CodeEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const touch = useMediaQuery('(pointer: coarse)');

  const apply = (r: EditResult): void => {
    onChange(r.value);
    requestAnimationFrame(() => ref.current?.setSelectionRange(r.start, r.end));
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
    const el = ref.current;
    if (el) apply(indentLines(el.value, el.selectionStart, el.selectionEnd, outdent));
  };

  return (
    <div className="code-editor field">
      <label className="field__label" htmlFor={inputId}>{label}</label>
      {touch && !readOnly && (
        <div className="code-editor__tools">
          <button type="button" className="code-editor__tool" aria-label="Indentar"
            onPointerDown={(e) => e.preventDefault()} onClick={() => tool(false)}>⇥</button>
          <button type="button" className="code-editor__tool" aria-label="Desindentar"
            onPointerDown={(e) => e.preventDefault()} onClick={() => tool(true)}>⇤</button>
        </div>
      )}
      <textarea
        ref={ref} id={inputId} className="code-editor__input" value={value} rows={rows} readOnly={readOnly}
        placeholder={placeholder} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off"
        wrap="off" autoFocus={autoFocus} aria-describedby={readOnly ? undefined : hintId}
        onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown}
      />
      {!readOnly && <p id={hintId} className="code-editor__hint">Tab indenta · Shift+Tab desindenta · Esc para sair</p>}
    </div>
  );
}
