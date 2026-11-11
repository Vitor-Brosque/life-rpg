import type { DayKey } from '@life/shared';
import { weekdayOf } from '@life/shared';
import { Button } from '../../ui/Button';
import { WEEKDAY_ABBR } from '../../ui/format';
import { dayLabel } from './planShared';

export interface WeekStripProps {
  days: DayKey[];
  today: DayKey;
  selected: DayKey;
  /** Items (missions + commitments) per day, shown as badges. */
  counts: Map<DayKey, number>;
  onSelect(day: DayKey): void;
  onShift(weeks: number): void;
  /** Hide the day buttons (wide layout shows all 7 days anyway). */
  showStrip: boolean;
  /** Back to the current week; only given when another week is showing. */
  onReset?: () => void;
}

/** Week navigation: arrows shift by 7 days; the strip selects the day shown below. */
export function WeekStrip({ days, today, selected, counts, onSelect, onShift, showStrip, onReset }: WeekStripProps) {
  const first = days[0];
  const last = days[days.length - 1];
  return (
    <div className="week-nav">
      <div className="week-nav__bar">
        <Button size="sm" icon="skip" className="week-nav__prev" aria-label="Semana anterior" onClick={() => onShift(-1)} />
        <p className="week-nav__range" aria-live="polite">
          {dayLabel(first!)} – {dayLabel(last!)}
        </p>
        <Button size="sm" icon="skip" aria-label="Próxima semana" onClick={() => onShift(1)} />
        {onReset && <Button size="sm" variant="ghost" onClick={onReset}>Hoje</Button>}
      </div>
      {showStrip && (
        <ol className="week-strip" aria-label="Dias da semana">
          {days.map((d) => {
            const n = counts.get(d) ?? 0;
            const isSel = d === selected;
            return (
              <li key={d}>
                <button
                  type="button"
                  className={`week-strip__day${isSel ? ' is-selected' : ''}${d === today ? ' is-today' : ''}`}
                  aria-pressed={isSel}
                  aria-label={`${dayLabel(d)}${d === today ? ', hoje' : ''}, ${n} ${n === 1 ? 'item' : 'itens'}`}
                  onClick={() => onSelect(d)}
                >
                  <span className="week-strip__wd">{WEEKDAY_ABBR[weekdayOf(d)]}</span>
                  <span className="week-strip__num">{d.slice(8)}</span>
                  <span className={`week-strip__badge${n === 0 ? ' is-empty' : ''}`} aria-hidden="true">{n}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
