import type { DayKey } from '@life/shared';
import { addDays, weekdayOf } from '@life/shared';
import { WEEKDAY_ABBR } from './format';

export interface WeekDotsProps {
  /** Oldest → newest, last entry = today (`useCharacterStats().week`). */
  week: boolean[];
  today: DayKey;
}

/** Constancy (§11): one pixel square per day of the last 7, labelled with the weekday / "hoje". */
export function WeekDots({ week, today }: WeekDotsProps) {
  const count = week.filter(Boolean).length;
  return (
    <ol className="week-dots" aria-label={`${count} de ${week.length} dias com atividade`}>
      {week.map((on, i) => {
        const day = addDays(today, i - (week.length - 1));
        const isToday = i === week.length - 1;
        return (
          <li key={day} className={['week-dots__day', on && 'is-on', isToday && 'is-today'].filter(Boolean).join(' ')}>
            <span className="week-dots__dot" aria-hidden="true" />
            <span className="week-dots__label">{isToday ? 'hoje' : WEEKDAY_ABBR[weekdayOf(day)]}</span>
            <span className="visually-hidden">{on ? 'com atividade' : 'sem atividade'}</span>
          </li>
        );
      })}
    </ol>
  );
}
