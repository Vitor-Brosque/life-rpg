import { useEffect, useState } from 'react';
import type { DayKey, Recurrence } from '@life/shared';
import { dayKeyToDate, describeRecurrence } from '@life/shared';
import { Chip } from '../../ui/Chip';

type Kind = Recurrence['kind'] | 'none';

const KINDS: Array<{ kind: Kind; label: string }> = [
  { kind: 'none', label: 'Não repete' },
  { kind: 'daily', label: 'Todo dia' },
  { kind: 'weekly', label: 'Semanal' },
  { kind: 'monthly', label: 'Mensal' },
  { kind: 'afterDays', label: 'Após concluir' },
];

const WEEKDAYS = [
  { short: 'D', name: 'domingo' }, { short: 'S', name: 'segunda' }, { short: 'T', name: 'terça' },
  { short: 'Q', name: 'quarta' }, { short: 'Q', name: 'quinta' }, { short: 'S', name: 'sexta' },
  { short: 'S', name: 'sábado' },
];

function defaultFor(kind: Kind, base: DayKey): Recurrence | undefined {
  const d = dayKeyToDate(base);
  switch (kind) {
    case 'none': return undefined;
    case 'daily': return { kind: 'daily' };
    case 'weekly': return { kind: 'weekly', weekdays: [d.getDay()] };
    case 'monthly': return { kind: 'monthly', day: d.getDate() };
    case 'afterDays': return { kind: 'afterDays', days: 7 };
  }
}

/** Number input that keeps a local draft and only reports valid values. */
function NumberField({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange(n: number): void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="recurrence__number">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (Number.isInteger(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={() => setDraft(String(value))}
      />
    </label>
  );
}

export interface RecurrencePickerProps {
  value?: Recurrence;
  /** Day used for sensible defaults (weekday / day of month). */
  baseDay: DayKey;
  onChange(rec: Recurrence | undefined): void;
}

export function RecurrencePicker({ value, baseDay, onChange }: RecurrencePickerProps) {
  const kind: Kind = value?.kind ?? 'none';
  return (
    <fieldset className="recurrence">
      <legend className="field__label">Repetição</legend>
      <div className="cluster">
        {KINDS.map((k) => (
          <Chip key={k.kind} selected={kind === k.kind}
            onClick={() => { if (kind !== k.kind) onChange(defaultFor(k.kind, baseDay)); }}>
            {k.label}
          </Chip>
        ))}
      </div>
      {value?.kind === 'weekly' && (
        <div className="recurrence__weekdays" role="group" aria-label="Dias da semana">
          {WEEKDAYS.map((w, i) => {
            const on = value.weekdays.includes(i);
            return (
              <button
                key={w.name}
                type="button"
                className="weekday-toggle"
                aria-pressed={on}
                aria-label={w.name}
                onClick={() => {
                  const next = on ? value.weekdays.filter((d) => d !== i) : [...value.weekdays, i].sort((a, b) => a - b);
                  if (next.length > 0) onChange({ kind: 'weekly', weekdays: next });
                }}
              >
                {w.short}
              </button>
            );
          })}
        </div>
      )}
      {value?.kind === 'monthly' && (
        <NumberField label="Dia do mês" value={value.day} min={1} max={31}
          onChange={(day) => onChange({ kind: 'monthly', day })} />
      )}
      {value?.kind === 'afterDays' && (
        <NumberField label="Dias depois de concluir" value={value.days} min={1} max={365}
          onChange={(days) => onChange({ kind: 'afterDays', days })} />
      )}
      {value && <p className="recurrence__desc">Repete {describeRecurrence(value)}.</p>}
    </fieldset>
  );
}
