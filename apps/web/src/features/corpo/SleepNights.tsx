import type { SleepNight } from '@life/shared';
import { nightText, shortDay } from './corpoFormat';
import { useSleepSheet } from './SleepSheet';

/** The sleep bar's axis, in minutes from noon: 20:00 → 14:00 of the next day. */
const AXIS_FROM = 8 * 60;
const AXIS_SPAN = 18 * 60;
const pct = (min: number): number => Math.min(100, Math.max(0, ((min - AXIS_FROM) / AXIS_SPAN) * 100));

/** "Últimas 14 noites", newest first; each row opens the night sheet (spec §6.3). */
export function SleepNights({ nights }: { nights: SleepNight[] }) {
  return (
    <ul className="sleep-nights" aria-label="Últimas 14 noites">
      {[...nights].reverse().map((n) => {
        const text = nightText(n);
        const bar = n.bedMin !== undefined && n.wakeMin !== undefined && n.minutes !== undefined;
        return (
          <li key={n.night}>
            <button type="button" className="sleep-night" aria-label={`Noite de ${shortDay(n.night)}: ${text}. Editar`}
              onClick={() => useSleepSheet.getState().open(n.night)}>
              <span className="sleep-night__day">{shortDay(n.night)}</span>
              <span className="sleep-night__track" aria-hidden="true">
                {bar && (
                  <span className="sleep-night__bar"
                    style={{ left: `${pct(n.bedMin!)}%`, width: `${pct(n.wakeMin!) - pct(n.bedMin!)}%` }} />
                )}
              </span>
              <span className="sleep-night__text">{text}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
