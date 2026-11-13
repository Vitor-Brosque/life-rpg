import { describe, expect, it } from 'vitest';
import type { Commitment, SleepLog } from '@life/shared';
import { DEFAULT_SLEEP } from '@life/shared';
import { WIND_DOWN_BODY, desiredReminders, desiredWindDown } from '../src/features/reminders/reminders';

const commitment = (p: Partial<Commitment> = {}): Commitment => ({
  id: 'c1', createdAt: 1, updatedAt: 1, deleted: false, title: 'Dentista',
  date: '2026-11-11', start: '15:00', end: '16:00', remind: true, ...p,
});

describe('desiredReminders', () => {
  it('a commitment earlier than dayStartHour is reminded on the next calendar morning', () => {
    const now = new Date(2026, 10, 11, 23, 0).getTime();
    const night = commitment({ title: 'Remédio', start: '02:00', end: '02:15' });
    const out = desiredReminders([night], '2026-11-11', 10, now, 4);
    expect(out).toEqual([{
      tag: 'commit:c1:2026-11-11', at: new Date(2026, 10, 12, 1, 50).getTime(),
      title: 'LIFE RPG', body: 'Remédio começa às 02:00',
    }]);
  });

  it('keeps the body within 300 characters and the title within 120', () => {
    const now = new Date(2026, 10, 11, 10, 0).getTime();
    const long = commitment({ title: 'x'.repeat(500) });
    const [r] = desiredReminders([long], '2026-11-11', 10, now, 4);
    expect(r!.body.length).toBeLessThanOrEqual(300);
    expect(r!.title.length).toBeLessThanOrEqual(120);
    expect(r!.body.endsWith('… começa às 15:00')).toBe(true);
    const [short] = desiredReminders([commitment()], '2026-11-11', 10, now, 4);
    expect(short!.body).toBe('Dentista começa às 15:00');
  });
});


describe('desiredWindDown', () => {
  const on = { ...DEFAULT_SLEEP, windDownReminder: true };
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
  const night = (n: string, bedAt?: number): SleepLog => ({ id: `sleep-${n}`, createdAt: 1, updatedAt: 1, deleted: false, night: n, ...(bedAt ? { bedAt } : {}) });

  it('off by default', () => {
    expect(desiredWindDown(DEFAULT_SLEEP, '2026-11-12', at(12, 10), [])).toEqual([]);
  });
  it('today and tomorrow, Monday to Friday, still ahead', () => {
    // Thursday 12 at 10:00: Thursday and Friday nights.
    expect(desiredWindDown(on, '2026-11-12', at(12, 10), [], 4)).toEqual([
      { tag: 'winddown:2026-11-12', at: at(12, 22, 45), title: 'LIFE RPG', body: WIND_DOWN_BODY },
      { tag: 'winddown:2026-11-13', at: at(13, 22, 45), title: 'LIFE RPG', body: WIND_DOWN_BODY },
    ]);
    // Friday 13 at 23:30: tonight's is past and Saturday has none.
    expect(desiredWindDown(on, '2026-11-13', at(13, 23, 30), [], 4)).toEqual([]);
  });
  it('a time before the day start is the next calendar morning; a logged "Deitei" skips that night', () => {
    const late = { ...on, windDownAt: '00:30' };
    expect(desiredWindDown(late, '2026-11-12', at(12, 10), [night('2026-11-12', at(12, 23, 50))], 4)).toEqual([
      { tag: 'winddown:2026-11-13', at: at(14, 0, 30), title: 'LIFE RPG', body: WIND_DOWN_BODY },
    ]);
  });
});
