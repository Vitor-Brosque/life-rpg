import { describe, expect, it } from 'vitest';
import type { CardSchedule, Rating } from '../src/types';
import {
  dayStartTimestamp, intervalLabel, newSchedule, nextDayStart, placeDue, previews, rate, retrievability,
  scheduleOf, shiftRestDay, type ScheduleCtx,
} from '../src/scheduler';

// 2026-11-12 is a Thursday; 13 Fri, 14 Sat, 15 Sun, 16 Mon.
const ctx: ScheduleCtx = { dayStartHour: 4, restDays: [0, 6], retention: 0.9 };
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const NOW = at(12, 10);

describe('day boundaries', () => {
  it('dayStartTimestamp / nextDayStart use dayStartHour', () => {
    expect(dayStartTimestamp('2026-11-12', 4)).toBe(at(12, 4));
    expect(nextDayStart('2026-11-12', 4)).toBe(at(13, 4));
  });
});

describe('shiftRestDay', () => {
  it('Saturday → Friday, Sunday → Monday', () => {
    expect(shiftRestDay('2026-11-14', '2026-11-12', [0, 6])).toBe('2026-11-13');
    expect(shiftRestDay('2026-11-15', '2026-11-12', [0, 6])).toBe('2026-11-16');
  });
  it('never moves to today or earlier: reviewed Friday with 1 day → Monday', () => {
    expect(shiftRestDay('2026-11-14', '2026-11-13', [0, 6])).toBe('2026-11-16');
  });
  it('a tie goes to the earlier study day', () => {
    expect(shiftRestDay('2026-11-18', '2026-11-12', [3])).toBe('2026-11-17');
  });
  it('works with a single study day (Saturday)', () => {
    expect(shiftRestDay('2026-11-16', '2026-11-12', [0, 1, 2, 3, 4, 5])).toBe('2026-11-14');
  });
  it('leaves study days and the all-rest configuration alone', () => {
    expect(shiftRestDay('2026-11-17', '2026-11-12', [0, 6])).toBe('2026-11-17');
    expect(shiftRestDay('2026-11-14', '2026-11-12', [0, 1, 2, 3, 4, 5, 6])).toBe('2026-11-14');
  });
});

describe('placeDue', () => {
  const review = (due: number, scheduledDays: number): CardSchedule => ({
    ...newSchedule(0), state: 'review', due, scheduledDays, stability: 3, difficulty: 5, reps: 2,
  });
  it('moves a day interval to the start of its logical day, off rest days', () => {
    const s = placeDue(review(at(15, 10), 3), NOW, ctx);
    expect(s.due).toBe(at(16, 4));
    expect(s.scheduledDays).toBe(4);
  });
  it('a review at 02:00 belongs to the previous logical day', () => {
    const s = placeDue(review(at(14, 2), 1), at(13, 2), ctx); // logical today = 12th, due logical 13th
    expect(s.due).toBe(at(13, 4));
    expect(s.scheduledDays).toBe(1);
  });
  it('keeps short steps (minutes) and new cards untouched', () => {
    const step: CardSchedule = { ...newSchedule(0), state: 'learning', due: NOW + 600_000, scheduledDays: 0 };
    expect(placeDue(step, NOW, ctx)).toEqual(step);
    expect(placeDue(newSchedule(NOW), NOW, ctx)).toEqual(newSchedule(NOW));
  });
});

describe('rate and previews', () => {
  it('new card: Errei 1 min, Difícil 6 min, Bom 10 min in learning; Fácil graduates to a study day', () => {
    const p = previews(newSchedule(NOW), NOW, ctx);
    expect(p[1].schedule).toMatchObject({ state: 'learning', due: NOW + 60_000 });
    expect(p[2].schedule).toMatchObject({ state: 'learning', due: NOW + 6 * 60_000 });
    expect(p[3].schedule).toMatchObject({ state: 'learning', due: NOW + 10 * 60_000 });
    expect(p[1].short).toBe('1 min');
    expect(p[3].long).toBe('10 minutos');
    const easy = p[4].schedule;
    expect(easy.state).toBe('review');
    expect(easy.scheduledDays).toBeGreaterThanOrEqual(1);
    expect(new Date(easy.due).getHours()).toBe(4);
    expect([0, 6]).not.toContain(new Date(easy.due).getDay());
  });

  it('rate gives the same schedule the preview showed', () => {
    for (const r of [1, 2, 3, 4] as Rating[]) {
      expect(rate(newSchedule(NOW), r, NOW, ctx)).toEqual(previews(newSchedule(NOW), NOW, ctx)[r].schedule);
    }
  });

  it('a review card: intervals grow from Difícil to Fácil and Errei relearns in 10 min', () => {
    const learned = rate(rate(newSchedule(NOW), 3, NOW, ctx), 3, NOW + 10 * 60_000, ctx);
    expect(learned.state).toBe('review');
    const later = learned.due + 3600_000;
    const p = previews(learned, later, ctx);
    expect(p[1].schedule).toMatchObject({ state: 'relearning', due: later + 10 * 60_000 });
    expect(p[2].schedule.scheduledDays).toBeLessThanOrEqual(p[3].schedule.scheduledDays);
    expect(p[3].schedule.scheduledDays).toBeLessThanOrEqual(p[4].schedule.scheduledDays);
    expect(p[3].schedule.lastReview).toBe(later);
    expect(p[1].schedule.lapses).toBe(learned.lapses + 1);
  });

  it('topics skip short steps: a new topic goes to 1, 2, 3 or 6 days; Errei later comes back next day', () => {
    const topic: ScheduleCtx = { ...ctx, restDays: [], shortTerm: false };
    const p = previews(newSchedule(NOW), NOW, topic);
    expect(([1, 2, 3, 4] as Rating[]).map((r) => [p[r].schedule.state, p[r].schedule.scheduledDays]))
      .toEqual([['review', 1], ['review', 2], ['review', 3], ['review', 6]]);
    const learned = rate(newSchedule(NOW), 3, NOW, topic);
    expect(rate(learned, 1, learned.due + 3600_000, topic)).toMatchObject({ state: 'review', scheduledDays: 1, lapses: 1 });
  });

  it('caps intervals near one year', () => {
    let s = rate(newSchedule(NOW), 4, NOW, ctx);
    for (let i = 0; i < 12; i++) s = rate(s, 4, s.due + 3600_000, ctx);
    expect(s.scheduledDays).toBeLessThanOrEqual(368);
  });
});

describe('intervalLabel', () => {
  const days = (n: number): CardSchedule => ({ ...newSchedule(0), state: 'review', scheduledDays: n });
  it('formats days, weeks, months and a year', () => {
    expect(intervalLabel(days(1), 0)).toEqual({ short: '1 d', long: '1 dia' });
    expect(intervalLabel(days(9), 0)).toEqual({ short: '9 d', long: '9 dias' });
    expect(intervalLabel(days(21), 0)).toEqual({ short: '3 sem', long: '3 semanas' });
    expect(intervalLabel(days(120), 0)).toEqual({ short: '4 m', long: '4 meses' });
    expect(intervalLabel(days(366), 0)).toEqual({ short: '1 a', long: '1 ano' });
  });
  it('formats minutes and hours for short steps', () => {
    const step = (ms: number): CardSchedule => ({ ...newSchedule(0), state: 'learning', due: ms, scheduledDays: 0 });
    expect(intervalLabel(step(5 * 60_000), 0)).toEqual({ short: '5 min', long: '5 minutos' });
    expect(intervalLabel(step(90 * 60_000), 0)).toEqual({ short: '2 h', long: '2 horas' });
  });
});

describe('retrievability and scheduleOf', () => {
  it('is 1 for new cards and decreases with time for learned ones', () => {
    expect(retrievability(newSchedule(NOW), NOW)).toBe(1);
    const s = rate(newSchedule(NOW), 4, NOW, ctx);
    const soon = retrievability(s, NOW + 3600_000);
    const late = retrievability(s, NOW + 30 * 86400_000);
    expect(soon).toBeGreaterThan(late);
    expect(late).toBeGreaterThan(0);
  });
  it('scheduleOf keeps only schedule fields', () => {
    const card = { ...newSchedule(1), id: 'x', noteId: 'n', ord: 0, suspended: false, lastReview: 7 };
    expect(scheduleOf(card)).toEqual({ ...newSchedule(1), lastReview: 7 });
    expect(scheduleOf(newSchedule(1))).not.toHaveProperty('lastReview');
  });
});
