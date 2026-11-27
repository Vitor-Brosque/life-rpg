import { describe, expect, it } from 'vitest';
import type { Commitment, SleepLog } from '@life/shared';
import { DEFAULT_SLEEP, DEFAULT_STUDY } from '@life/shared';
import { WIND_DOWN_BODY, desiredReminders, desiredStudyReminders, desiredWindDown } from '../src/features/reminders/reminders';

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

describe('desiredStudyReminders', () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
  const study = { ...DEFAULT_STUDY, reminderAt: '18:00' };
  const base = {
    study, today: '2026-11-12', now: at(12, 10), mode: 'normal' as const, goalMet: false, dayStartHour: 4,
    remaining: { count: 12, minutes: 4 },
    forecast: [
      { day: '2026-11-13', min: 3 }, { day: '2026-11-16', min: 0 }, { day: '2026-11-17', min: 2 },
      { day: '2026-11-18', min: 1 }, { day: '2026-11-19', min: 5 },
    ],
  };
  const tags = (o: ReturnType<typeof desiredStudyReminders>) => o.map((r) => r.tag);

  it('off without reminderAt', () => {
    expect(desiredStudyReminders({ ...base, study: DEFAULT_STUDY })).toEqual([]);
  });
  it("today uses the plan's count and minutes; later days say there are cards waiting; rest days and empty days are skipped", () => {
    const out = desiredStudyReminders(base);
    // Thu 12 today, Fri 13, (Sat/Sun rest), Mon 16 has no cards, Tue 17, Wed 18.
    expect(tags(out)).toEqual(['study:2026-11-12', 'study:2026-11-13', 'study:2026-11-17', 'study:2026-11-18']);
    expect(out[0]).toEqual({ tag: 'study:2026-11-12', at: at(12, 18), title: 'LIFE RPG', body: 'Revisão de hoje: 12 cards, uns 4 min.' });
    expect(out[1]).toEqual({ tag: 'study:2026-11-13', at: at(13, 18), title: 'LIFE RPG', body: 'Revisão de hoje: há cards esperando.' });
  });
  it('um card só fica no singular', () => {
    expect(desiredStudyReminders({ ...base, remaining: { count: 1, minutes: 2 } })[0]!.body).toBe('Revisão de hoje: 1 card, uns 2 min.');
  });
  it('um minuto vira "cerca de 1 min", nunca "uns 1 min"', () => {
    expect(desiredStudyReminders({ ...base, remaining: { count: 2, minutes: 1 } })[0]!.body).toBe('Revisão de hoje: 2 cards, cerca de 1 min.');
  });
  it('um dia livre (fim de semana) não recebe lembrete futuro, mesmo sem restDays', () => {
    const out = desiredStudyReminders({
      ...base, study: { ...study, restDays: [0] }, today: '2026-11-13', now: at(13, 10),
      forecast: [{ day: '2026-11-14', min: 4 }, { day: '2026-11-16', min: 4 }],
    });
    expect(tags(out)).not.toContain('study:2026-11-14');
    expect(tags(out)).toContain('study:2026-11-16');
  });
  it('a free day today has no reminder (the other days stay)', () => {
    expect(tags(desiredStudyReminders({ ...base, mode: 'free' }))).not.toContain('study:2026-11-12');
    expect(tags(desiredStudyReminders({ ...base, mode: 'free' }))).toContain('study:2026-11-13');
  });
  it('today with nothing left or the goal met has none', () => {
    expect(tags(desiredStudyReminders({ ...base, remaining: { count: 0, minutes: 0 } }))).not.toContain('study:2026-11-12');
    expect(tags(desiredStudyReminders({ ...base, goalMet: true }))).not.toContain('study:2026-11-12');
  });
  it('today is skipped once the time has passed; a rest day today is skipped', () => {
    expect(tags(desiredStudyReminders({ ...base, now: at(12, 18, 1) }))).not.toContain('study:2026-11-12');
    const sat = desiredStudyReminders({ ...base, today: '2026-11-14', now: at(14, 10) });
    expect(tags(sat)).not.toContain('study:2026-11-14');
  });
  it('a time before the day start is the next calendar morning', () => {
    const out = desiredStudyReminders({ ...base, study: { ...study, reminderAt: '01:00' } });
    expect(out[0]!.at).toBe(at(13, 1));
  });
});
