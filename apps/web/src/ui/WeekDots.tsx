import type { DayKey } from '@life/shared';
import { weekdayOf } from '@life/shared';
import { WEEKDAY_ABBR } from './format';

export interface WorkdayCount {
  active: number;
  total: number;
  /** Oldest → newest, last entry = today (`activeWorkdays(...)`). */
  days: Array<{ day: DayKey; active: boolean; free: boolean }>;
}

/** "4 de 5 dias úteis" — constancy counts non-free days only (§9). */
export function workdaysText({ active, total }: Pick<WorkdayCount, 'active' | 'total'>): string {
  if (total === 0) return 'Só dias livres';
  return `${active} de ${total} ${total === 1 ? 'dia útil' : 'dias úteis'}`;
}

export interface WeekDotsProps {
  /** `useCharacterStats().weekWorkdays`. */
  week: WorkdayCount;
}

/**
 * Constancy (§9, §11): one pixel square per day of the last 7, labelled with the weekday / "hoje".
 * Free days read "livre": muted and left out of the count (activity on them still lights up).
 */
export function WeekDots({ week }: WeekDotsProps) {
  const last = week.days.length - 1;
  return (
    <ol className="week-dots" aria-label={`${workdaysText(week)} com atividade`}>
      {week.days.map(({ day, active, free }, i) => {
        const isToday = i === last;
        const freeLabel = free ? `${isToday ? 'Hoje, dia livre' : 'Dia livre'}${active ? ', com atividade' : ''}` : undefined;
        return (
          <li
            key={day}
            aria-label={freeLabel}
            className={['week-dots__day', active && 'is-on', isToday && 'is-today', free && 'is-free'].filter(Boolean).join(' ')}
          >
            <span className="week-dots__dot" aria-hidden="true" />
            <span className="week-dots__label">{isToday ? 'hoje' : free ? 'livre' : WEEKDAY_ABBR[weekdayOf(day)]}</span>
            {!free && <span className="visually-hidden">{active ? 'com atividade' : 'sem atividade'}</span>}
          </li>
        );
      })}
    </ol>
  );
}
