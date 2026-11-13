import type { DayKey } from '@life/shared';
import { weekdayOf } from '@life/shared';
import { WEEKDAY_ABBR } from '../../ui/format';

/**
 * Forecast minutes, one rule for the bars and the text: nothing due → "0" / "nada previsto",
 * under half a minute → "<1" / "menos de 1 min", otherwise rounded.
 */
export function forecastMinutes(min: number): { label: string; text: string; spoken: string } {
  if (min <= 0) return { label: '0', text: 'nada previsto', spoken: 'nada previsto' };
  if (min < 0.5) return { label: '<1', text: 'menos de 1 min', spoken: 'menos de 1 min' };
  const m = Math.round(min);
  return { label: String(m), text: `~${m} min`, spoken: `cerca de ${m} min` };
}

/** Minutes expected on the next study days, with the daily budget drawn as a line (no alarm colours). */
export function ForecastBars({ forecast, budgetMin }: { forecast: Array<{ day: DayKey; min: number }>; budgetMin: number }) {
  if (forecast.length === 0) return null;
  const top = Math.max(budgetMin, ...forecast.map((f) => f.min), 1);
  return (
    <div className="forecast">
      <div className="forecast__chart" aria-hidden="true">
        <span className="forecast__line" style={{ bottom: `${(budgetMin / top) * 100}%` }} />
        {forecast.map((f) => <span key={f.day} className="forecast__bar" style={{ height: `${(f.min / top) * 100}%` }} />)}
      </div>
      <ul className="forecast__days" aria-label={`Minutos previstos nos próximos dias de estudo; orçamento de ${budgetMin} min por dia`}>
        {forecast.map((f) => {
          const min = forecastMinutes(f.min);
          const name = WEEKDAY_ABBR[weekdayOf(f.day)]!;
          return (
            <li key={f.day} aria-label={`${name}: ${min.spoken}`}>
              <span className="forecast__min" aria-hidden="true">{min.label}</span>
              <span className="forecast__label" aria-hidden="true">{name}</span>
            </li>
          );
        })}
      </ul>
      <p className="forecast__legend">A linha marca o orçamento de {budgetMin} min.</p>
    </div>
  );
}
