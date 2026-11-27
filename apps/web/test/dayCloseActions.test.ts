import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockSession, FocusSession, XpEvent } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import {
  CorrectionError, closeDay, correctBlockTimes, correctFocusMinutes, deleteFocusSession, dismissDayClose,
  restoreFocusSession, retroBlock, saveDayChoices,
} from '../src/domain/dayCloseActions';
import { saveSleepTimes, setSleepQuality } from '../src/domain/sleepActions';
import { at, seedBlocks } from './blockFixture';

const DAY = '2026-11-11';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 23, 30));
  await db.delete();
  await db.open();
  await ensureSeed();
  await seedBlocks();
});
afterEach(() => { vi.useRealTimers(); });

const session = (blockId: string, extra: Partial<BlockSession>) =>
  put('blockSessions', newRecord<BlockSession>({ id: `bs-${blockId}-${DAY}`, blockId, day: DAY, version: 'normal', ...extra }));
const xpCount = async () => (await db.xpEvents.toArray()).filter((x) => !x.deleted).length;

describe('closeDay and dismissDayClose', () => {
  it('writes only the choices present: a key with undefined clears it, a missing key keeps it', async () => {
    await closeDay(DAY, { tiredness: 'muito', mood: 'ok', load: 'pesada' });
    await closeDay(DAY, { mood: 'bem', load: undefined, concentration: 'dificil' });
    const ds = (await db.dayState.get(DAY))!;
    expect(ds).toMatchObject({ tiredness: 'muito', mood: 'bem', concentration: 'dificil', closedAt: at(11, 23, 30) });
    expect(ds.load).toBeUndefined();
  });

  it('saveDayChoices writes the given choices without closing the day, and nothing without keys', async () => {
    await saveDayChoices(DAY, {});
    expect(await db.dayState.get(DAY)).toBeUndefined();
    await saveDayChoices(DAY, { concentration: 'boa' });
    expect(await db.dayState.get(DAY)).toMatchObject({ concentration: 'boa' });
    expect((await db.dayState.get(DAY))!.closedAt).toBeUndefined();
  });

  it('keeps the first close time; only the choices given are written; the observation is the fechamento entry, with no length limit', async () => {
    const first = await closeDay(DAY, { tiredness: 'medio', note: ' Dia corrido ' });
    expect(first).toMatchObject({ closedAt: at(11, 23, 30), tiredness: 'medio' });
    expect(first.closeNote).toBeUndefined();
    expect(await db.diaryEntries.get('diary-close-2026-11-11')).toMatchObject({
      day: DAY, at: at(11, 23, 30), kind: 'fechamento', text: 'Dia corrido', themes: [], links: [], private: false, deleted: false,
    });
    vi.setSystemTime(at(11, 23, 50));
    const second = await closeDay(DAY, { note: 'x'.repeat(300) });
    expect(second.closedAt).toBe(at(11, 23, 30));
    expect(second.tiredness).toBe('medio');
    expect((await db.dayState.get(DAY))!.tiredness).toBe('medio');
    const entry = (await db.diaryEntries.get('diary-close-2026-11-11'))!;
    expect(entry.text).toHaveLength(300);
    expect(entry).toMatchObject({ at: at(11, 23, 30), editedAt: at(11, 23, 50) });
    expect(await db.outbox.get('diaryEntries:diary-close-2026-11-11')).toBeDefined();
  });

  it('a blank observation moves the fechamento entry to "Apagadas recentemente"; no observation leaves it alone', async () => {
    await closeDay(DAY, { note: 'Dia corrido' });
    await closeDay(DAY, { tiredness: 'pouco' });
    expect((await db.diaryEntries.get('diary-close-2026-11-11'))!.trashedAt).toBeUndefined();
    vi.setSystemTime(at(11, 23, 40));
    await closeDay(DAY, { note: '   ' });
    expect(await db.diaryEntries.get('diary-close-2026-11-11')).toMatchObject({ text: 'Dia corrido', trashedAt: at(11, 23, 40), deleted: false });
    await closeDay(DAY, { note: 'Outra frase' });
    expect(await db.diaryEntries.get('diary-close-2026-11-11')).toMatchObject({ text: 'Outra frase', trashedAt: undefined });
  });

  it('"Agora não" marks closeDismissed', async () => {
    await dismissDayClose(DAY);
    expect((await db.dayState.get(DAY))!.closeDismissed).toBe(true);
  });
});

describe('block corrections', () => {
  it('correctBlockTimes moves start and end, marks correctedAt and leaves XP alone', async () => {
    await session('b1', { startedAt: at(11, 9), endedAt: at(11, 12) });
    const before = await xpCount();
    await correctBlockTimes('b1', '09:10', '11:40');
    expect(await db.blockSessions.get(`bs-b1-${DAY}`)).toMatchObject({
      startedAt: at(11, 9, 10), endedAt: at(11, 11, 40), correctedAt: at(11, 23, 30),
    });
    expect(await xpCount()).toBe(before);
  });

  it('refuses a block not started today and a reversed window', async () => {
    await expect(correctBlockTimes('b1', '09:10', '11:40')).rejects.toThrow(new CorrectionError('Esse bloco não foi iniciado hoje.'));
    await session('b1', { startedAt: at(11, 9), endedAt: at(11, 12) });
    await expect(correctBlockTimes('b1', '11:40', '09:10')).rejects.toThrow('O fim precisa ser depois do início.');
  });

  it('retroBlock creates a retro session without XP; a skipped block loses `skipped`; a started one is refused', async () => {
    const before = await xpCount();
    await retroBlock('b4', '17:00', '17:45');
    expect(await db.blockSessions.get(`bs-b4-${DAY}`)).toMatchObject({
      retro: true, startedAt: at(11, 17), endedAt: at(11, 17, 45), version: 'normal',
    });
    await session('b5', { skipped: true, endedAt: at(11, 18) });
    await retroBlock('b5', '18:00', '18:30');
    const b5 = (await db.blockSessions.get(`bs-b5-${DAY}`))!;
    expect(b5.retro).toBe(true);
    expect(b5.skipped).toBeUndefined();
    expect(await xpCount()).toBe(before);
    await session('b1', { startedAt: at(11, 9) });
    await expect(retroBlock('b1', '09:00', '10:00')).rejects.toThrow('Esse bloco já foi iniciado hoje: ajuste o horário.');
  });
});

describe('focus corrections', () => {
  const focus = async (): Promise<FocusSession> => {
    const f = await put('focusSessions', newRecord<FocusSession>({
      id: 'f1', startedAt: at(11, 10), endedAt: at(11, 12), activeMs: 100 * 60_000, mode: 'free', outcome: 'finished',
    }));
    await put('xpEvents', newRecord<XpEvent>({ id: 'xp-focus-f1', at: at(11, 12), amount: 5, reason: 'focus', dayKey: DAY }));
    return f;
  };

  it('correctFocusMinutes sets the minutes and the end, keeps the XP, refuses 0', async () => {
    await focus();
    await correctFocusMinutes('f1', 45);
    expect(await db.focusSessions.get('f1')).toMatchObject({ activeMs: 45 * 60_000, endedAt: at(11, 11, 5), correctedAt: at(11, 23, 30) });
    expect((await db.xpEvents.get('xp-focus-f1'))!.deleted).toBe(false);
    await expect(correctFocusMinutes('f1', 0)).rejects.toThrow('Minutos: um número inteiro de 1 a 600.');
  });

  it('deleteFocusSession removes the session and its XP; restoreFocusSession brings both back', async () => {
    await focus();
    const removed = await deleteFocusSession('f1');
    expect(removed?.xp?.id).toBe('xp-focus-f1');
    expect((await db.focusSessions.get('f1'))!.deleted).toBe(true);
    expect((await db.xpEvents.get('xp-focus-f1'))!.deleted).toBe(true);
    await restoreFocusSession(removed!);
    expect((await db.focusSessions.get('f1'))!.deleted).toBe(false);
    expect((await db.xpEvents.get('xp-focus-f1'))!.deleted).toBe(false);
  });
});

describe('setSleepQuality', () => {
  it('writes on an existing night, removes with null, creates nothing without a night', async () => {
    expect(await setSleepQuality('2026-11-10', 4)).toBeUndefined();
    expect(await db.sleepLogs.get('sleep-2026-11-10')).toBeUndefined();
    await saveSleepTimes('2026-11-10', '23:30', '07:00');
    expect((await setSleepQuality('2026-11-10', 4))!.quality).toBe(4);
    expect((await db.sleepLogs.get('sleep-2026-11-10'))!.quality).toBe(4);
    await setSleepQuality('2026-11-10', null);
    expect((await db.sleepLogs.get('sleep-2026-11-10'))!.quality).toBeUndefined();
  });
});
