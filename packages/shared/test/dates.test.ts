import { describe, it, expect } from 'vitest';
import {
  dayKeyOf, addDays, diffDays, weekdayOf, parseHHmm, formatHHmm,
  timestampAt, daysInMonth, isValidDayKey, toDayKey, dayKeyToDate,
} from '../src/dates';

describe('dates', () => {
  it('dayKeyOf honours dayStartHour', () => {
    expect(dayKeyOf(new Date(2026, 10, 12, 3, 30).getTime(), 4)).toBe('2026-11-11');
    expect(dayKeyOf(new Date(2026, 10, 12, 4, 0).getTime(), 4)).toBe('2026-11-12');
    expect(dayKeyOf(new Date(2026, 10, 12, 0, 30).getTime(), 0)).toBe('2026-11-12');
  });
  it('toDayKey / dayKeyToDate round trip', () => {
    expect(toDayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(dayKeyToDate('2026-01-05').getTime()).toBe(new Date(2026, 0, 5).getTime());
  });
  it('addDays', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });
  it('diffDays', () => {
    expect(diffDays('2026-11-11', '2026-11-18')).toBe(7);
    expect(diffDays('2026-11-18', '2026-11-11')).toBe(-7);
  });
  it('weekdayOf', () => {
    expect(weekdayOf('2026-11-11')).toBe(3);
  });
  it('HH:mm helpers', () => {
    expect(parseHHmm('09:05')).toBe(545);
    expect(formatHHmm(545)).toBe('09:05');
  });
  it('timestampAt', () => {
    expect(timestampAt('2026-11-11', '15:00')).toBe(new Date(2026, 10, 11, 15, 0).getTime());
  });
  it('daysInMonth', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
  });
  it('isValidDayKey', () => {
    expect(isValidDayKey('2026-02-31')).toBe(false);
    expect(isValidDayKey('2026-02-28')).toBe(true);
  });
});
