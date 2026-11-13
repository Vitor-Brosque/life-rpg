import { describe, expect, it } from 'vitest';
import type { SleepLog } from '../src/types';
import { DEFAULT_SLEEP, sleepSettingsOf } from '../src/types';
import {
  clockFromNoon, lastSleepNight, minutesFromNoon, sleepIssue, sleepLogId, sleepMinutes, sleepNightOf, sleepPrompt,
  sleepTimes, sleepWindow, sleepXpId,
} from '../src/sleep';

/** Day `d` of November 2026 at h:m, local time. 13 = Friday, 14 = Saturday. */
const at = (d: number, h: number, m = 0): number => new Date(2026, 10, d, h, m).getTime();

const log = (night: string, p: Partial<SleepLog> = {}): SleepLog => ({
  id: sleepLogId(night), createdAt: 1, updatedAt: 1, deleted: false, night, ...p,
});

describe('nights and ids', () => {
  it('a night runs from noon to noon', () => {
    expect(sleepNightOf(at(13, 23, 0))).toBe('2026-11-13');
    expect(sleepNightOf(at(14, 1, 30))).toBe('2026-11-13');
    expect(sleepNightOf(at(14, 11, 59))).toBe('2026-11-13');
    expect(sleepNightOf(at(14, 12, 0))).toBe('2026-11-14');
  });
  it('the window ends at the night that started yesterday evening', () => {
    expect(lastSleepNight(at(14, 8))).toBe('2026-11-13');
    expect(lastSleepNight(at(14, 22))).toBe('2026-11-13');
    expect(lastSleepNight(at(15, 1))).toBe('2026-11-14');
  });
  it('deterministic ids and settings defaults', () => {
    expect(sleepLogId('2026-11-13')).toBe('sleep-2026-11-13');
    expect(sleepXpId('2026-11-13')).toBe('xp-sleep-2026-11-13');
    expect(sleepSettingsOf()).toEqual(DEFAULT_SLEEP);
    expect(sleepSettingsOf({ sleep: { windDownReminder: true } as never })).toEqual({ ...DEFAULT_SLEEP, windDownReminder: true });
  });
});

describe('sleepMinutes', () => {
  it('needs both taps, wake after bed, at most 16 h', () => {
    expect(sleepMinutes({ bedAt: at(13, 23, 40), wakeAt: at(14, 7, 10) })).toBe(450);
    expect(sleepMinutes({ bedAt: at(13, 23, 40) })).toBeUndefined();
    expect(sleepMinutes({ bedAt: at(14, 7), wakeAt: at(14, 7) })).toBeUndefined();
    expect(sleepMinutes({ bedAt: at(13, 20), wakeAt: at(14, 12) })).toBe(960);
    expect(sleepMinutes({ bedAt: at(13, 20), wakeAt: at(14, 13) })).toBeUndefined();
  });
});

describe('sleepPrompt', () => {
  it('offers "Deitei" from 20:00 to 05:00, not during a commitment', () => {
    expect(sleepPrompt({ now: at(13, 22), logs: [] })).toEqual({ kind: 'bed', night: '2026-11-13' });
    expect(sleepPrompt({ now: at(14, 2), logs: [] })).toEqual({ kind: 'bed', night: '2026-11-13' });
    expect(sleepPrompt({ now: at(14, 4, 59), logs: [] })).toEqual({ kind: 'bed', night: '2026-11-13' });
    expect(sleepPrompt({ now: at(13, 22), logs: [], inCommitment: true })).toEqual({ kind: 'none' });
    expect(sleepPrompt({ now: at(13, 19, 59), logs: [] })).toEqual({ kind: 'none' });
  });
  it('after "Deitei" the night stays open (Acordei) for up to 16 h', () => {
    const open = [log('2026-11-13', { bedAt: at(13, 23, 40) })];
    expect(sleepPrompt({ now: at(13, 23, 41), logs: open })).toEqual({ kind: 'asleep', night: '2026-11-13', bedAt: at(13, 23, 40) });
    expect(sleepPrompt({ now: at(14, 7), logs: open, inCommitment: true }))
      .toEqual({ kind: 'asleep', night: '2026-11-13', bedAt: at(13, 23, 40) });
    expect(sleepPrompt({ now: at(14, 17), logs: open })).toEqual({ kind: 'none' });
  });
  it('offers "Acordei" from 05:00 to 12:00 while last night has no wake time', () => {
    expect(sleepPrompt({ now: at(14, 5), logs: [] })).toEqual({ kind: 'wake', night: '2026-11-13' });
    expect(sleepPrompt({ now: at(14, 11, 59), logs: [] })).toEqual({ kind: 'wake', night: '2026-11-13' });
    expect(sleepPrompt({ now: at(14, 7), logs: [log('2026-11-13', { wakeAt: at(14, 6, 50) })] })).toEqual({ kind: 'none' });
    expect(sleepPrompt({ now: at(14, 12), logs: [] })).toEqual({ kind: 'none' });
  });
  it('a night already logged hides "Deitei"; deleted logs do not count', () => {
    const done = log('2026-11-13', { bedAt: at(13, 21), wakeAt: at(13, 21, 30) });
    expect(sleepPrompt({ now: at(13, 22), logs: [done] })).toEqual({ kind: 'none' });
    const gone = log('2026-11-13', { bedAt: at(13, 21, 50), deleted: true });
    expect(sleepPrompt({ now: at(13, 22), logs: [gone] })).toEqual({ kind: 'bed', night: '2026-11-13' });
  });
});

describe('editing', () => {
  it('a bedtime before noon is the next morning; the wake time is always the next day', () => {
    expect(sleepTimes('2026-11-13', '23:40', '07:10')).toEqual({ bedAt: at(13, 23, 40), wakeAt: at(14, 7, 10) });
    expect(sleepTimes('2026-11-13', '01:30')).toEqual({ bedAt: at(14, 1, 30) });
    expect(sleepTimes('2026-11-13', undefined, '13:00')).toEqual({ wakeAt: at(14, 13) });
  });
  it('sleepIssue: wake before bed, longer than 16 h, fine', () => {
    expect(sleepIssue(sleepTimes('2026-11-13', '01:30', '01:00'))).toBe('order');
    expect(sleepIssue(sleepTimes('2026-11-13', '20:00', '13:00'))).toBe('long');
    expect(sleepIssue(sleepTimes('2026-11-13', '23:40', '07:10'))).toBeUndefined();
    expect(sleepIssue(sleepTimes('2026-11-13', '23:40'))).toBeUndefined();
  });
});

describe('minutes from noon', () => {
  it('linearises times across midnight', () => {
    expect(minutesFromNoon('2026-11-13', at(13, 23, 30))).toBe(690);
    expect(minutesFromNoon('2026-11-13', at(14, 1, 0))).toBe(780);
    expect(minutesFromNoon('2026-11-13', at(14, 7, 0))).toBe(1140);
    expect([690, 780, 1140, -30].map(clockFromNoon)).toEqual(['23:30', '01:00', '07:00', '11:30']);
  });
});

describe('sleepWindow', () => {
  const logs = [
    log('2026-11-09', { bedAt: at(9, 23), wakeAt: at(10, 7), deleted: true }),
    log('2026-11-10', { bedAt: at(10, 23), wakeAt: at(11, 7) }),
    log('2026-11-11', { bedAt: at(12, 0, 30), wakeAt: at(12, 8, 30) }),
    log('2026-11-12', { bedAt: at(13, 1, 30), wakeAt: at(13, 7, 30) }),
    log('2026-11-13', { bedAt: at(13, 23, 10) }),
  ];
  it('lists 14 nights oldest first and measures the complete ones', () => {
    const w = sleepWindow(logs, '2026-11-13');
    expect(w.nights).toHaveLength(14);
    expect(w.nights[0]!.night).toBe('2026-10-31');
    expect(w.nights[13]).toMatchObject({ night: '2026-11-13', bedMin: 670 });
    expect(w.nights[13]!.minutes).toBeUndefined();
    expect(w.nights[9]!.log).toBeUndefined();
    expect(w).toMatchObject({
      complete: 3, enough: true, avgMinutes: 440,
      bed: { meanMin: 740, spreadMin: 62, earliestMin: 660, latestMin: 810 },
      wake: { meanMin: 1180, spreadMin: 37, earliestMin: 1140, latestMin: 1230 },
    });
  });
  it('fewer than 3 complete nights: no averages yet', () => {
    const w = sleepWindow(logs.slice(0, 3), '2026-11-13');
    expect(w).toMatchObject({ complete: 2, enough: false });
    expect(w.avgMinutes).toBeUndefined();
    expect(w.bed).toBeUndefined();
  });
});
