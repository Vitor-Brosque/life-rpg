import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SLEEP } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import {
  clearSleepTime, deleteSleepLog, logBedtime, logWake, restoreSleepLog, saveSleepSettings, saveSleepTimes, setSleepQuality,
} from '../src/domain/sleepActions';
import { logWorkout, removeWorkout } from '../src/domain/workoutActions';

const at = (d: number, h: number, m = 0): Date => new Date(2026, 10, d, h, m);
const NIGHT = '2026-11-13';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(13, 23, 40));
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

describe('sleep actions', () => {
  const legacyXp = (night: string) => db.xpEvents.put({
    id: `xp-sleep-${night}`, createdAt: 1, updatedAt: 1, deleted: false, at: 1, amount: 2, reason: 'sleep',
    dayKey: night, areaId: 'area-equilibrio',
  });

  it('"Deitei" then "Acordei": one record per night and no XP', async () => {
    const bed = await logBedtime(NIGHT);
    expect(bed.xp).toBe(0);
    expect(bed.log).toMatchObject({ id: 'sleep-2026-11-13', night: NIGHT, bedAt: at(13, 23, 40).getTime() });
    expect(await db.outbox.get('sleepLogs:sleep-2026-11-13')).toBeDefined();
    vi.setSystemTime(at(14, 7, 10));
    const wake = await logWake(NIGHT);
    expect(wake.xp).toBe(0);
    expect(wake.log.wakeAt).toBe(at(14, 7, 10).getTime());
    expect(await db.xpEvents.get('xp-sleep-2026-11-13')).toBeUndefined();
    vi.setSystemTime(at(14, 7, 30));
    const again = await logWake(NIGHT); // a second tap (stale tab, other device) keeps the first time
    expect(again).toMatchObject({ xp: 0, created: false });
    expect(again.log.wakeAt).toBe(at(14, 7, 10).getTime());
    expect((await logBedtime(NIGHT)).log.bedAt).toBe(at(13, 23, 40).getTime());
    expect((await db.sleepLogs.get('sleep-2026-11-13'))!.wakeAt).toBe(at(14, 7, 10).getTime());
    expect(await db.sleepLogs.count()).toBe(1);
  });

  it('Desfazer removes the time and, with it, an old XP of the night', async () => {
    await logBedtime(NIGHT);
    vi.setSystemTime(at(14, 7, 10));
    await logWake(NIGHT);
    await legacyXp(NIGHT);
    const undone = await clearSleepTime(NIGHT, 'wakeAt');
    expect(undone.log).not.toHaveProperty('wakeAt');
    expect((await db.xpEvents.get('xp-sleep-2026-11-13'))!.deleted).toBe(true);
  });

  it('saveSleepTimes validates, writes both times and drops an old XP when the night is incomplete', async () => {
    const saved = await saveSleepTimes('2026-11-12', '23:30', '07:00');
    expect(saved.xp).toBe(0);
    expect(await db.xpEvents.get('xp-sleep-2026-11-12')).toBeUndefined();
    await legacyXp('2026-11-12');
    expect(saved.log).toMatchObject({ bedAt: at(12, 23, 30).getTime(), wakeAt: at(13, 7, 0).getTime() });
    await expect(saveSleepTimes('2026-11-12', '01:30', '01:00'))
      .rejects.toThrow('O horário de acordar precisa ser depois do de deitar.');
    await expect(saveSleepTimes('2026-11-12', '20:00', '13:00')).rejects.toThrow('Confira os horários: deu mais de 16 h.');
    const partial = await saveSleepTimes('2026-11-12', null, '07:00');
    expect(partial.log).not.toHaveProperty('bedAt');
    expect((await db.xpEvents.get('xp-sleep-2026-11-12'))!.deleted).toBe(true);
  });

  it('delete and restore a night: an old XP is removed and not revived', async () => {
    await saveSleepTimes(NIGHT, '23:40', '07:10');
    await legacyXp(NIGHT);
    const removed = await deleteSleepLog(NIGHT);
    expect((await db.sleepLogs.get('sleep-2026-11-13'))!.deleted).toBe(true);
    expect((await db.xpEvents.get('xp-sleep-2026-11-13'))!.deleted).toBe(true);
    expect(await deleteSleepLog(NIGHT)).toBeUndefined();
    const restored = await restoreSleepLog(removed!);
    expect(restored.xp).toBe(0);
    expect(await db.sleepLogs.get('sleep-2026-11-13')).toMatchObject({ deleted: false, bedAt: removed!.bedAt, wakeAt: removed!.wakeAt });
    expect((await db.xpEvents.get('xp-sleep-2026-11-13'))!.deleted).toBe(true);
  });

  it('Desfazer of "Apagar noite" brings the quality back too', async () => {
    await saveSleepTimes(NIGHT, '23:40', '07:10');
    await setSleepQuality(NIGHT, 4);
    const removed = await deleteSleepLog(NIGHT);
    await restoreSleepLog(removed!);
    expect(await db.sleepLogs.get('sleep-2026-11-13')).toMatchObject({ deleted: false, quality: 4, bedAt: removed!.bedAt });
  });

  it('saveSleepSettings merges with the defaults and refuses an invalid time', async () => {
    await saveSleepSettings({ windDownReminder: true, windDownAt: '25:00' });
    expect((await db.settings.get('settings'))!.sleep).toEqual({ ...DEFAULT_SLEEP, windDownReminder: true });
    await saveSleepSettings({ windDownAt: '23:45' });
    expect((await db.settings.get('settings'))!.sleep).toEqual({ ...DEFAULT_SLEEP, windDownReminder: true, windDownAt: '23:45' });
  });
});

describe('workout actions', () => {
  beforeEach(() => { vi.setSystemTime(at(13, 13, 30)); });

  it('XP once per kind per day, cardio a little more, to Vigor', async () => {
    const a = await logWorkout({ kind: 'musculacao', minutes: 60 });
    expect(a.xp).toBe(5);
    expect(a.workout).toMatchObject({ day: NIGHT, kind: 'musculacao', minutes: 60 });
    expect(a.workout).not.toHaveProperty('minimum');
    expect(await db.xpEvents.get('xp-workout-musculacao-2026-11-13')).toMatchObject({ amount: 5, reason: 'workout', areaId: 'area-vigor' });
    expect((await logWorkout({ kind: 'musculacao', minutes: 20 })).xp).toBe(0);
    const c = await logWorkout({ kind: 'cardio', minutes: 10, minimum: true, blockId: 'b2' });
    expect(c.xp).toBe(8);
    expect(c.workout).toMatchObject({ minimum: true, blockId: 'b2' });
  });

  it('rejects minutes out of range', async () => {
    await expect(logWorkout({ kind: 'outro', minutes: 0 })).rejects.toThrow('Informe quantos minutos durou.');
    await expect(logWorkout({ kind: 'outro', minutes: 301 })).rejects.toThrow('Até 300 minutos por registro.');
    expect(await db.workouts.count()).toBe(0);
  });

  it('removing keeps the XP while another log of the kind stands that day; re-logging revives it', async () => {
    const a = await logWorkout({ kind: 'musculacao', minutes: 60 });
    const b = await logWorkout({ kind: 'musculacao', minutes: 20 });
    await removeWorkout(a.workout.id);
    expect((await db.workouts.get(a.workout.id))!.deleted).toBe(true);
    expect((await db.xpEvents.get('xp-workout-musculacao-2026-11-13'))!.deleted).toBe(false);
    const gone = await removeWorkout(b.workout.id);
    expect((await db.xpEvents.get('xp-workout-musculacao-2026-11-13'))!.deleted).toBe(true);
    vi.setSystemTime(at(14, 9));
    const back = await logWorkout({ kind: gone!.kind, minutes: gone!.minutes, at: gone!.at });
    expect(back.workout.day).toBe(NIGHT);
    expect(back.xp).toBe(5);
    expect((await db.xpEvents.get('xp-workout-musculacao-2026-11-13'))!.deleted).toBe(false);
  });
});
