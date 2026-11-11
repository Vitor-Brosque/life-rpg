import { useEffect, useRef, useState } from 'react';
import { usePageHide } from '../../ui/usePageHide';

export interface EditableFieldProps {
  label: string;
  value?: string;
  /**
   * Called with the trimmed text when it changed: on blur, Enter in single-line fields, unmount,
   * and when the page is hidden or unloaded.
   */
  onSave(value: string): void;
  multiline?: boolean;
  placeholder?: string;
  /** Empty input reverts to the previous value instead of saving. */
  required?: boolean;
  className?: string;
}

/** Text field with a local draft that persists on blur; external updates show up while untouched. */
export function EditableField({ label, value, onSave, multiline, placeholder, required, className }: EditableFieldProps) {
  const [draft, setDraft] = useState(value ?? '');
  const dirty = useRef(false);
  const latest = useRef({ draft, value, onSave, required });
  latest.current = { draft, value, onSave, required };

  useEffect(() => {
    // A draft that only differs by surrounding spaces is what was just saved: keep it as typed
    // (the field may still have focus after a save on page hide).
    if (!dirty.current && (value ?? '') !== latest.current.draft.trim()) setDraft(value ?? '');
  }, [value]);

  const commitRef = useRef((onHide = false) => {
    if (!dirty.current) return;
    const { draft: d, value: v, onSave: save, required: req } = latest.current;
    const next = d.trim();
    if (req && next === '') {
      // Still being retyped: leave it alone on page hide; otherwise revert to the saved value.
      if (onHide) return;
      dirty.current = false;
      setDraft(v ?? '');
      return;
    }
    dirty.current = false;
    if (next !== (v ?? '')) save(next);
  });

  // Closing the sheet unmounts the field without a blur: flush the pending edit.
  useEffect(() => () => commitRef.current(), []);
  // The phone may kill or reload the app in the background without any blur or unmount.
  usePageHide(() => commitRef.current(true));

  const common = {
    value: draft,
    placeholder,
    onChange: (e: { target: { value: string } }) => { dirty.current = true; setDraft(e.target.value); },
    onBlur: () => commitRef.current(),
  };

  return (
    <label className={className ? `field ${className}` : 'field'}>
      <span className="field__label">{label}</span>
      {multiline ? (
        <textarea rows={3} {...common} />
      ) : (
        <input
          type="text"
          enterKeyHint="done"
          {...common}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitRef.current(); } }}
        />
      )}
    </label>
  );
}
