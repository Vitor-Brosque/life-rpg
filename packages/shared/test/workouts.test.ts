import { describe, expect, it } from 'vitest';
import type { Workout } from '../src/types';
import { workoutWeek, workoutXp, workoutXpId } from '../src/workouts';

const w = (id: string, day: string, kind: Workout['kind'], minutes: number, p: Partial<Workout> = {}): Workout =>
  ({ id, createdAt: 1, updatedAt: 1, deleted: false, at: 1, day, kind, minutes, ...p });

describe('workouts', () => {
  it('one award per kind per day; cardio gets a little more', () => {
    expect(workoutXpId('cardio', '2026-11-13')).toBe('xp-workout-cardio-2026-11-13');
    expect([workoutXp('musculacao'), workoutXp('cardio'), workoutXp('outro')]).toEqual([5, 8, 5]);
  });
  it('workoutWeek counts the live workouts of Monday to Sunday', () => {
    const list = [
      w('a', '2026-11-09', 'musculacao', 60),
      w('b', '2026-11-09', 'cardio', 10, { minimum: true }),
      w('c', '2026-11-10', 'musculacao', 50, { deleted: true }),
      w('d', '2026-11-11', 'musculacao', 75),
      w('e', '2026-11-15', 'outro', 30),
      w('f', '2026-11-16', 'cardio', 30),
    ];
    expect(workoutWeek(list, '2026-11-09')).toEqual({
      total: 4, minutes: 175, days: 3, minimum: 1, byKind: { musculacao: 2, cardio: 1, outro: 1 },
    });
    expect(workoutWeek([], '2026-11-09')).toEqual({
      total: 0, minutes: 0, days: 0, minimum: 0, byKind: { musculacao: 0, cardio: 0, outro: 0 },
    });
  });
});
