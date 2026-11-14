import type { BaseRecord, BlockSession, DayKey, DayState, FocusSession, HHmm, ID, SyncTable, Tiredness, XpEvent } from '@life/shared';
import { CLOSE_NOTE_MAX, FOCUS_ISSUE_TEXT, TIME_ISSUE_TEXT, correctedFocus, defaultDayMode, typedWindow } from '@life/shared';
import { db } from '../db/db';
import { patch, putAll, upsert } from '../db/repo';
import { getToday, upsertDayState, withLock } from './common';

// Encerramento do dia (Acompanhamento C): close, dismiss and the corrections of today. Nothing here gives XP;
// deleting a focus session removes its own award (undoing the record) and Desfazer brings both back.

export class CorrectionError extends Error {}

const sessionId = (blockId: ID, day: DayKey): string => `bs-${blockId}-${day}`;
const startHour = async (): Promise<number> => (await db.settings.get('settings'))?.dayStartHour ?? 4;

/** "Fechar o dia": the first close time stays; tiredness and note are replaced (absent = removed). */
export async function closeDay(day: DayKey, input: { tiredness?: Tiredness; note?: string }): Promise<DayState> {
  const prev = await db.dayState.get(day);
  const note = input.note?.trim().slice(0, CLOSE_NOTE_MAX).trim();
  return upsertDayState(day, {
    closedAt: (prev && !prev.deleted ? prev.closedAt : undefined) ?? Date.now(),
    tiredness: input.tiredness,
    closeNote: note || undefined,
  });
}

/** "Agora não" on the evening card: hidden for the rest of that day, on every device. */
export async function dismissDayClose(day: DayKey): Promise<void> {
  await upsertDayState(day, { closeDismissed: true });
}

async function typed(day: DayKey, start: HHmm, end: HHmm): Promise<{ startedAt: number; endedAt: number }> {
  const w = typedWindow(day, start, end, await startHour(), Date.now());
  if (typeof w === 'string') throw new CorrectionError(TIME_ISSUE_TEXT[w]);
  return w;
}

/** Start and end of a block lived today, as typed (logical times). XP is untouched. */
export const correctBlockTimes = (blockId: ID, start: HHmm, end: HHmm): Promise<void> => withLock('block-start', async () => {
  const day = await getToday();
  const w = await typed(day, start, end);
  const s = await db.blockSessions.get(sessionId(blockId, day));
  if (!s || s.deleted || s.startedAt === undefined) throw new CorrectionError('Esse bloco não foi iniciado hoje.');
  await patch<BlockSession>('blockSessions', s.id, { ...w, correctedAt: Date.now() });
});

/**
 * "Fiz, mas não registrei": today's session of the block with the typed times, marked `retro`. Never XP (no block
 * award, no resumption) and never the day's `startedAt`. A skipped block may be registered too.
 */
export const retroBlock = (blockId: ID, start: HHmm, end: HHmm): Promise<void> => withLock('block-start', async () => {
  const day = await getToday();
  const w = await typed(day, start, end);
  const s = await db.blockSessions.get(sessionId(blockId, day));
  if (s && !s.deleted && s.startedAt !== undefined) throw new CorrectionError('Esse bloco já foi iniciado hoje: ajuste o horário.');
  const ds = await db.dayState.get(day);
  const mode = defaultDayMode(day, ds && !ds.deleted ? ds : undefined);
  await upsert<BlockSession>('blockSessions', sessionId(blockId, day), {
    ...w, retro: true, skipped: undefined, version: mode === 'low' || mode === 'recovery' ? 'minimum' : 'normal',
  }, { blockId, day, version: 'normal' });
});

/** Minutes of a focus session corrected (pauses kept). The XP awarded stays as it was. */
export async function correctFocusMinutes(id: ID, minutes: number): Promise<void> {
  const s = await db.focusSessions.get(id);
  if (!s || s.deleted) throw new CorrectionError('Sessão de foco não encontrada.');
  const c = correctedFocus(s, minutes, Date.now());
  if (typeof c === 'string') throw new CorrectionError(FOCUS_ISSUE_TEXT[c]);
  await patch<FocusSession>('focusSessions', id, { ...c, correctedAt: Date.now() });
}

export interface RemovedFocus { session: FocusSession; xp?: XpEvent }

/** "Apagar" a focus session: it and its own XP go, in one transaction. Resolves with both, for Desfazer. */
export const deleteFocusSession = (id: ID): Promise<RemovedFocus | undefined> => withLock('focus', async () => {
  const s = await db.focusSessions.get(id);
  if (!s || s.deleted) return undefined;
  const x = await db.xpEvents.get(`xp-focus-${id}`);
  const xp = x && !x.deleted ? x : undefined;
  const entries: Array<{ table: SyncTable; record: BaseRecord }> = [{ table: 'focusSessions', record: { ...s, deleted: true } }];
  if (xp) entries.push({ table: 'xpEvents', record: { ...xp, deleted: true } });
  await putAll(entries);
  return { session: s, ...(xp ? { xp } : {}) };
});

/** Desfazer of "Apagar": the session and (when it had one) its XP come back. */
export const restoreFocusSession = (r: RemovedFocus): Promise<void> => withLock('focus', async () => {
  const entries: Array<{ table: SyncTable; record: BaseRecord }> = [{ table: 'focusSessions', record: { ...r.session, deleted: false } }];
  if (r.xp) entries.push({ table: 'xpEvents', record: { ...r.xp, deleted: false } });
  await putAll(entries);
});
