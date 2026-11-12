import { describe, it, expect } from 'vitest';
import {
  completionXp, startXp, strategyXp, focusXp, levelFromXp, titleForLevel, activeDays,
  REVIEW_XP, JOURNEY_XP, RESILIENCE_XP, FOCUS_DAILY_CAP,
  BLOCK_XP, RESUMPTION_XP, CHECKIN_XP, OBJECTIVE_XP, isResumption, activeWorkdays,
} from '../src/xp';

const ctx = { completionsTodayBefore: 0, hardDay: false };

describe('completionXp', () => {
  it('base and modifiers', () => {
    expect(completionXp({ important: false }, ctx).amount).toBe(8);
    expect(completionXp({ durationMin: 30, energy: 'heavy', important: true }, ctx).amount).toBe(21);
    expect(completionXp({ durationMin: 5, energy: 'light', important: false }, ctx).amount).toBe(4);
    expect(completionXp({ durationMin: 90, important: false }, ctx).amount).toBe(25);
  });
  it('halves after 10 completions today', () => {
    expect(completionXp({ durationMin: 60, important: false }, { completionsTodayBefore: 10, hardDay: false }).amount).toBe(9);
  });
  it('resilience only on first completion of a hard day', () => {
    expect(completionXp({ important: false }, { completionsTodayBefore: 0, hardDay: true }).resilience).toBe(5);
    expect(completionXp({ important: false }, { completionsTodayBefore: 1, hardDay: true }).resilience).toBe(0);
    expect(completionXp({ important: false }, ctx).resilience).toBe(0);
  });
});

describe('start/strategy/focus', () => {
  it('startXp', () => {
    expect(startXp({ energy: 'heavy', postponeCount: 0 })).toBe(5);
    expect(startXp({ energy: 'light', postponeCount: 2 })).toBe(5);
    expect(startXp({ postponeCount: 1 })).toBe(0);
  });
  it('strategyXp', () => {
    expect(strategyXp({ postponeCount: 0 })).toBe(0);
    expect(strategyXp({ postponeCount: 1 })).toBe(2);
  });
  it('focusXp', () => {
    expect(focusXp(25 * 60000, 0)).toBe(4);
    expect(focusXp(9 * 60000, 0)).toBe(0);
    expect(focusXp(200 * 60000, 30)).toBe(10);
    expect(focusXp(60 * 60000, 40)).toBe(0);
  });
  it('constants', () => {
    expect([REVIEW_XP, JOURNEY_XP, RESILIENCE_XP, FOCUS_DAILY_CAP]).toEqual([5, 30, 5, 40]);
  });
});

describe('levels', () => {
  it('levelFromXp', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, into: 0, needed: 40, total: 0 });
    expect(levelFromXp(40).level).toBe(2);
    expect(levelFromXp(100)).toEqual({ level: 3, into: 0, needed: 80, total: 100 });
    expect(levelFromXp(99).level).toBe(2);
    expect(levelFromXp(20, true).level).toBe(2);
  });
  it('titleForLevel', () => {
    expect(titleForLevel(1)).toBe('Aprendiz');
    expect(titleForLevel(4)).toBe('Escudeiro');
    expect(titleForLevel(20)).toBe('Lenda');
    expect(titleForLevel(25)).toBe('Lenda');
  });
});

describe('activeDays', () => {
  it('oldest to newest', () => {
    expect(activeDays(new Set(['2026-11-11', '2026-11-09']), '2026-11-11', 3)).toEqual([true, false, true]);
  });
});

describe('block xp rules', () => {
  const isFree = (d: string): boolean => {
    const wd = new Date(`${d}T12:00:00`).getDay();
    return wd === 0 || wd === 6;
  };
  it('constants', () => {
    expect([BLOCK_XP, RESUMPTION_XP, CHECKIN_XP, OBJECTIVE_XP]).toEqual([5, 10, 2, 10]);
  });
  it('isResumption', () => {
    expect(isResumption('2026-11-11', new Set(['2026-11-09']), isFree)).toBe(false);
    expect(isResumption('2026-11-11', new Set(['2026-11-06']), isFree)).toBe(true);
    expect(isResumption('2026-11-11', new Set(['2026-11-05']), isFree)).toBe(true);
    expect(isResumption('2026-11-11', new Set(), isFree)).toBe(false);
  });
  it('activeWorkdays', () => {
    const r = activeWorkdays(new Set(['2026-11-09', '2026-11-11']), '2026-11-11', 7, isFree);
    expect(r.active).toBe(2);
    expect(r.total).toBe(5);
    expect(r.days).toHaveLength(7);
    expect(r.days[0]).toEqual({ day: '2026-11-05', active: false, free: false });
    expect(r.days[2]).toEqual({ day: '2026-11-07', active: false, free: true });
  });
});
