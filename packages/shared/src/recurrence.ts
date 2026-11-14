import type { DayKey, Recurrence } from './types';
import { addDays, daysInMonth, weekdayOf } from './dates';

const WEEKDAY_ABBR = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Next day a recurring mission comes back, given when it was planned and completed. */
export function nextOccurrence(
  rec: Recurrence,
  plannedDay: DayKey | undefined,
  completedDay: DayKey,
): DayKey {
  const planned = plannedDay ?? completedDay;
  const base = planned > completedDay ? planned : completedDay;
  switch (rec.kind) {
    case 'daily':
      return addDays(base, 1);
    case 'weekly': {
      if (rec.weekdays.length === 0) return addDays(base, 7);
      for (let i = 1; i <= 7; i++) {
        const d = addDays(base, i);
        if (rec.weekdays.includes(weekdayOf(d))) return d;
      }
      return addDays(base, 7);
    }
    case 'monthly': {
      let year = Number(base.slice(0, 4));
      let month = Number(base.slice(5, 7));
      const baseDay = Number(base.slice(8, 10));
      for (let i = 0; i < 2; i++) {
        const day = Math.min(rec.day, daysInMonth(year, month));
        if (i > 0 || day > baseDay) {
          return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
        month += 1;
        if (month > 12) { month = 1; year += 1; }
      }
      throw new Error('unreachable');
    }
    case 'afterDays':
      return addDays(completedDay, rec.days);
  }
}

export function describeRecurrence(rec: Recurrence): string {
  switch (rec.kind) {
    case 'daily':
      return 'todo dia';
    case 'weekly': {
      const set = [...new Set(rec.weekdays)].sort((a, b) => a - b);
      if (set.length === 7) return 'todo dia';
      const days = set.map((d) => WEEKDAY_ABBR[d]);
      return `toda ${days.join(', ')}`;
    }
    case 'monthly':
      return `todo dia ${rec.day}`;
    case 'afterDays':
      return rec.days === 1
        ? 'a cada 1 dia após concluir'
        : `a cada ${rec.days} dias após concluir`;
  }
}
