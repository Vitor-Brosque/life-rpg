import { describe, it, expect } from 'vitest';
import type { Recurrence } from '../src/types';
import { nextOccurrence, describeRecurrence } from '../src/recurrence';

describe('nextOccurrence', () => {
  it('daily', () => {
    expect(nextOccurrence({ kind: 'daily' }, '2026-11-11', '2026-11-11')).toBe('2026-11-12');
    expect(nextOccurrence({ kind: 'daily' }, '2026-11-09', '2026-11-11')).toBe('2026-11-12');
    expect(nextOccurrence({ kind: 'daily' }, '2026-11-12', '2026-11-11')).toBe('2026-11-13');
  });
  it('weekly', () => {
    const rec: Recurrence = { kind: 'weekly', weekdays: [1, 3] };
    expect(nextOccurrence(rec, '2026-11-11', '2026-11-11')).toBe('2026-11-16');
    expect(nextOccurrence(rec, '2026-11-16', '2026-11-16')).toBe('2026-11-18');
  });
  it('weekly with empty weekdays falls back to +7 days', () => {
    expect(nextOccurrence({ kind: 'weekly', weekdays: [] }, undefined, '2026-11-11')).toBe('2026-11-18');
  });
  it('monthly clamps to month length', () => {
    expect(nextOccurrence({ kind: 'monthly', day: 31 }, '2026-11-11', '2026-11-11')).toBe('2026-11-30');
    expect(nextOccurrence({ kind: 'monthly', day: 31 }, '2026-11-30', '2026-11-30')).toBe('2026-12-31');
    expect(nextOccurrence({ kind: 'monthly', day: 10 }, '2026-11-10', '2026-11-10')).toBe('2026-12-10');
  });
  it('afterDays counts from completion', () => {
    expect(nextOccurrence({ kind: 'afterDays', days: 3 }, '2026-11-01', '2026-11-11')).toBe('2026-11-14');
  });
});

describe('describeRecurrence', () => {
  it('describes in PT-BR', () => {
    expect(describeRecurrence({ kind: 'daily' })).toBe('todo dia');
    expect(describeRecurrence({ kind: 'weekly', weekdays: [3, 1] })).toBe('toda seg, qua');
    expect(describeRecurrence({ kind: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] })).toBe('todo dia');
    expect(describeRecurrence({ kind: 'monthly', day: 10 })).toBe('todo dia 10');
    expect(describeRecurrence({ kind: 'afterDays', days: 3 })).toBe('a cada 3 dias após concluir');
    expect(describeRecurrence({ kind: 'afterDays', days: 1 })).toBe('a cada 1 dia após concluir');
  });
});
