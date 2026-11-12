import type { DayKey } from '@life/shared';
import { weekdayOf } from '@life/shared';
import { WEEKDAY_ABBR } from '../../ui/format';

/** Minutes expected on the next study days, with the daily budget drawn as a line (no alarm colours). */
export function ForecastBars({ forecast, budgetMin }: { forecast: Array<{ day: DayKey; min: number }>; budgetMin: number }) {
  if (forecast.length === 0) return null;
  const top = Math.max(budgetMin, ...forecast.map((f) => f.min), 1);
  return (
    <div className="forecast">
      <ul className="forecast__bars" aria-label={`Minutos previstos nos próximos dias de estudo; orçamento de ${budgetMin} min por dia`}>
        <li className="forecast__line" aria-hidden="true" style={{ bottom: `${(budgetMin / top) * 100}%` }} />
        {forecast.map((f) => {
          const min = Math.round(f.min);
          const name = WEEKDAY_ABBR[weekdayOf(f.day)]!;
          return (
            <li key={f.day} className="forecast__day" aria-label={`${name}: cerca de ${min} min`}>
              <span className="forecast__track" aria-hidden="true">
                <span className="forecast__bar" style={{ height: `${(f.min / top) * 100}%` }} />
              </span>
              <span className="forecast__min" aria-hidden="true">{min}</span>
              <span className="forecast__label" aria-hidden="true">{name}</span>
            </li>
          );
        })}
      </ul>
      <p className="forecast__legend">A linha marca o orçamento de {budgetMin} min.</p>
    </div>
  );
}
