import { describe, expect, it } from 'vitest';
import { patternSettingsOf } from '../src/types';
import {
  addMonths, completedMonths, completedWeeks, monthEnd, monthKeyOf, monthName, monthPeriod, partOfDay,
  periodDays, periodsSince, weekPeriod,
} from '../src/periods';

describe('months', () => {
  it('keys, arithmetic across years, ends and names', () => {
    expect(monthKeyOf('2026-11-13')).toBe('2026-11');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
    expect(monthName('2026-10')).toBe('outubro');
    expect(monthPeriod('2026-10')).toEqual({ kind: 'month', key: '2026-10', start: '2026-10-01', end: '2026-10-31', label: 'out' });
  });
});

describe('completed periods', () => {
  it('whole weeks before the week of today, oldest first', () => {
    const w = completedWeeks('2026-11-13', 3);
    expect(w.map((p) => p.key)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
    expect(w.map((p) => p.label)).toEqual(['19/10', '26/10', '02/11']);
    expect(w[2]!.end).toBe('2026-11-08');
    expect(completedWeeks('2026-11-09', 1).map((p) => p.key)).toEqual(['2026-11-02']);
  });
  it('whole months before the month of today', () => {
    expect(completedMonths('2026-11-13', 2).map((p) => [p.key, p.label])).toEqual([['2026-09', 'set'], ['2026-10', 'out']]);
    expect(completedMonths('2026-01-05', 1).map((p) => p.key)).toEqual(['2025-12']);
  });
  it('periodDays and periodsSince', () => {
    const days = periodDays(weekPeriod('2026-11-02'));
    expect(days).toHaveLength(7);
    expect([days[0], days[6]]).toEqual(['2026-11-02', '2026-11-08']);
    const weeks = completedWeeks('2026-11-13', 3);
    expect(periodsSince(weeks, '2026-10-28').map((p) => p.key)).toEqual(['2026-10-26', '2026-11-02']);
    expect(periodsSince(weeks, undefined)).toEqual([]);
  });
});

describe('partOfDay (day starts at 4)', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 13, h, m).getTime();
  it('morning from the day start to noon, afternoon to 18h, night otherwise', () => {
    expect(partOfDay(at(3, 59), 4)).toBe('noite');
    expect(partOfDay(at(4), 4)).toBe('manha');
    expect(partOfDay(at(11, 59), 4)).toBe('manha');
    expect(partOfDay(at(12), 4)).toBe('tarde');
    expect(partOfDay(at(17, 59), 4)).toBe('tarde');
    expect(partOfDay(at(18), 4)).toBe('noite');
    expect(partOfDay(at(23), 4)).toBe('noite');
  });
});

describe('patternSettingsOf', () => {
  it('defaults to an empty list and drops what is not text', () => {
    expect(patternSettingsOf(undefined)).toEqual({ watchDismissed: [] });
    expect(patternSettingsOf({ patterns: { watchDismissed: ['a', 3 as never, 'b'] } })).toEqual({ watchDismissed: ['a', 'b'] });
    expect(patternSettingsOf({ patterns: { watchDismissed: 'x' as never } })).toEqual({ watchDismissed: [] });
  });
});
