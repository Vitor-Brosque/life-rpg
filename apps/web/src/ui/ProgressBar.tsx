export interface ProgressBarProps { value: number; max: number; color?: string; label?: string }

/** Segmented pixel bar. `label` is shown above the bar and used as its accessible name. */
export function ProgressBar({ value, max, color, label }: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const pct = (clamped / safeMax) * 100;
  return (
    <div className="progress">
      {label && <span className="progress__label" aria-hidden="true">{label}</span>}
      <div
        className="progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={clamped}
        aria-label={label ?? `${clamped} de ${max}`}
      >
        <div
          className="progress__fill"
          style={{ width: `${pct}%`, ...(color ? { ['--bar-color' as string]: color } : {}) }}
        />
      </div>
    </div>
  );
}
