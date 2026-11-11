import { describe, expect, it } from 'vitest';
import type { Commitment } from '@life/shared';
import { desiredReminders } from '../src/features/reminders/reminders';

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
