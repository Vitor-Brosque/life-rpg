import { beforeEach, describe, expect, it } from 'vitest';
import type { Area, BlockSession, Checkin, Sketch, XpEvent } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, patch, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { readWorldData, weekWindow } from '../src/features/world/worldData';

const TODAY = '2026-11-13';                          // Friday; the week starts on Monday 9
const WEEK_TS = new Date(2026, 10, 9, 4).getTime();  // Monday 04:00 (dayStartHour 4)

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureSeed();
});

describe('readWorldData', () => {
  it('weekWindow: Monday and the start of its logical day', () => {
    expect(weekWindow(TODAY, 4)).toEqual({ weekStart: '2026-11-09', weekStartTs: WEEK_TS });
  });

  it('keeps live, unarchived areas by order and live records only', async () => {
    await patch<Area>('areas', 'area-lacos', { archived: true });
    await patch<Area>('areas', 'area-ordem', { deleted: true });
    await put('xpEvents', newRecord<XpEvent>({ at: WEEK_TS + 1, amount: 5, reason: 'complete', dayKey: TODAY }));
    await put('xpEvents', newRecord<XpEvent>({ at: WEEK_TS + 2, amount: 5, reason: 'complete', dayKey: TODAY, deleted: true }));
    const d = await readWorldData(TODAY, 4);
    expect(d.areas.map((a) => a.id)).toEqual(['area-vigor', 'area-equilibrio', 'area-intelecto', 'area-oficio']);
    expect(d.xp).toHaveLength(1);
  });

  it('counts this week only: lousas, start check-ins and block sessions', async () => {
    await put('sketches', newRecord<Sketch>({ title: 'A', strokes: [] }));                       // updatedAt = now (this week)
    await db.sketches.put({ ...newRecord<Sketch>({ title: 'old', strokes: [] }), updatedAt: WEEK_TS - 1 });
    await put('checkins', newRecord<Checkin>({ at: WEEK_TS + 10, kind: 'start', feelings: [] }));
    await put('checkins', newRecord<Checkin>({ at: WEEK_TS + 11, kind: 'escape', feelings: [] }));
    await put('checkins', newRecord<Checkin>({ at: WEEK_TS - 10, kind: 'start', feelings: [] }));
    await put('blockSessions', newRecord<BlockSession>({ id: 'bs-b-2026-11-10', blockId: 'b', day: '2026-11-10', version: 'normal', startedAt: 1 }));
    await put('blockSessions', newRecord<BlockSession>({ id: 'bs-b-2026-11-06', blockId: 'b', day: '2026-11-06', version: 'normal', startedAt: 1 }));
    const d = await readWorldData(TODAY, 4);
    expect(d.sketchesThisWeek).toBe(1);
    expect(d.checkinsThisWeek).toBe(1);
    expect(d.sessions.map((s) => s.day)).toEqual(['2026-11-10']);
  });

  it('Marco 4 facts exist exactly when its tables exist in this build', async () => {
    const d = await readWorldData(TODAY, 4);
    const has = (name: string) => db.tables.some((t) => t.name === name);
    if (has('workouts')) expect(d.workouts).toEqual({ total: 0, cardio: 0 });
    else expect(d.workouts).toBeUndefined();
    if (has('freezerMoves')) expect(d.freezer).toEqual({ portions: 0, everPrepped: false });
    else expect(d.freezer).toBeUndefined();
    if (has('sleepLogs')) expect(d.sleepNights).toBe(0);
    else expect(d.sleepNights).toBeUndefined();
  });
});
