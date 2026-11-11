import { useEffect, useRef, useState } from 'react';

export interface EditableFieldProps {
  label: string;
  value?: string;
  /** Called with the trimmed text when it changed (on blur, Enter in single-line fields, or unmount). */
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
    if (!dirty.current) setDraft(value ?? '');
  }, [value]);

  const commitRef = useRef(() => {
    if (!dirty.current) return;
    dirty.current = false;
    const { draft: d, value: v, onSave: save, required: req } = latest.current;
    const next = d.trim();
    if (req && next === '') { setDraft(v ?? ''); return; }
    if (next !== (v ?? '')) save(next);
  });

  // Closing the sheet unmounts the field without a blur: flush the pending edit.
  useEffect(() => () => commitRef.current(), []);

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
