import { useId } from 'react';
import type { Area, BlockKind, Journey } from '@life/shared';
import { Icon } from '../../art/icons';
import { WEEKDAY_ABBR, formatDuration } from '../../ui/format';
import { KIND_ICON, KIND_LABEL, KIND_OPTIONS, WEEK_ORDER, WEEKDAY_NAME } from './routineShared';

// Form pieces of the block sheet (and the copy sheet's weekday toggles), sized for thumbs.

export function FieldError({ id, text }: { id: string; text?: string }) {
  return text ? <p id={id} className="block-form__error">{text}</p> : null;
}

export interface MinutesFieldProps {
  label: string;
  value: string;
  step: number;
  error?: string;
  onChange(value: string): void;
}

/** Minutes with big − / + steppers; the typed number stays editable. */
export function MinutesField({ label, value, step, error, onChange }: MinutesFieldProps) {
  const id = useId();
  const n = /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  const bump = (delta: number) => {
    const base = Number.isNaN(n) ? 0 : n;
    onChange(String(Math.max(step, Math.round((base + delta) / step) * step)));
  };
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <div className="minutes">
        <button type="button" className="minutes__step" aria-label={`${label}: menos ${step}`} onClick={() => bump(-step)}>−</button>
        <input id={id} type="number" inputMode="numeric" value={value}
          aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="minutes__step" aria-label={`${label}: mais ${step}`} onClick={() => bump(step)}>+</button>
        <span className="minutes__hint" aria-hidden="true">{!Number.isNaN(n) && n >= 60 ? formatDuration(n) : ''}</span>
      </div>
      <FieldError id={`${id}-error`} text={error} />
    </div>
  );
}

/** The five block kinds as large icon buttons (one selected). */
export function KindPicker({ value, onChange }: { value: BlockKind; onChange(kind: BlockKind): void }) {
  return (
    <fieldset className="field">
      <legend className="field__label">Tipo</legend>
      <div className="kind-picker">
        {KIND_OPTIONS.map((k) => (
          <button key={k} type="button" className={`kind-picker__option kind--${k}`} aria-pressed={value === k}
            onClick={() => onChange(k)}>
            <Icon name={KIND_ICON[k]} size={24} />
            <span>{KIND_LABEL[k]}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export interface WeekdayTogglesProps {
  legend: string;
  value: number[];
  onToggle(weekday: number): void;
  /** Shown but not selectable (the day being copied). */
  disabled?: number;
  error?: string;
}

/** seg … dom toggles (Monday first). */
export function WeekdayToggles({ legend, value, onToggle, disabled, error }: WeekdayTogglesProps) {
  const id = useId();
  return (
    <fieldset className="field" aria-describedby={error ? id : undefined}>
      <legend className="field__label">{legend}</legend>
      <div className="routine-weekdays">
        {WEEK_ORDER.map((d) => (
          <button key={d} type="button" className="weekday-toggle" aria-pressed={value.includes(d)}
            aria-label={WEEKDAY_NAME[d]} disabled={d === disabled} onClick={() => onToggle(d)}>
            {WEEKDAY_ABBR[d]}
          </button>
        ))}
      </div>
      <FieldError id={id} text={error} />
    </fieldset>
  );
}

export interface LinkSelectProps {
  value: string;
  areas: Area[];
  journeys: Journey[];
  onChange(value: string): void;
  hint?: string;
}

/** "Sem ligação", a (non-archived) area or an active journey: their missions come to the block. */
export function LinkSelect({ value, areas, journeys, onChange, hint = 'As missões dessa área ou jornada aparecem no bloco.' }: LinkSelectProps) {
  const id = useId();
  const liveAreas = areas.filter((a) => !a.archived || value === `area:${a.id}`);
  const liveJourneys = journeys.filter((j) => j.status === 'active' || value === `journey:${j.id}`);
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>Ligação</label>
      <select id={id} value={value} aria-describedby={`${id}-hint`} onChange={(e) => onChange(e.target.value)}>
        <option value="">Sem ligação</option>
        {liveAreas.length > 0 && (
          <optgroup label="Áreas">
            {liveAreas.map((a) => <option key={a.id} value={`area:${a.id}`}>{a.name}</option>)}
          </optgroup>
        )}
        {liveJourneys.length > 0 && (
          <optgroup label="Jornadas">
            {liveJourneys.map((j) => <option key={j.id} value={`journey:${j.id}`}>{j.title}</option>)}
          </optgroup>
        )}
      </select>
      <p id={`${id}-hint`} className="block-form__hint">{hint}</p>
    </div>
  );
}
