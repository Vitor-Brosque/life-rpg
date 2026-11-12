import type { DayKey, DayMode, ID } from '@life/shared';
import { RESUMPTION_XP } from '@life/shared';
import { refreshNow } from '../../db/hooks';
import { setDayMode, startBlock, toggleObjective } from '../../domain/actions';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { useCompanion } from '../companion/store';

// Block actions with their toast and companion line (shared by the banner and "Entre blocos").

/** "Bloco iniciado · +5 XP" (· "Retomada · +10 XP" after a pause), then the companion. */
export async function startBlockWithFeedback(blockId: ID): Promise<void> {
  const { xp, resumption } = await startBlock(blockId);
  refreshNow();
  const blockXp = xp - (resumption ? RESUMPTION_XP : 0);
  const parts = [blockXp > 0 ? `Bloco iniciado · +${blockXp} XP` : 'Bloco iniciado'];
  if (resumption) parts.push(`Retomada · +${RESUMPTION_XP} XP`);
  useToast.getState().show(parts.join(' · '));
  void useCompanion.getState().say(resumption ? 'resumption' : 'blockStart');
}

export async function toggleObjectiveWithFeedback(weekId: DayKey, objectiveId: ID): Promise<void> {
  const { xp } = await toggleObjective(weekId, objectiveId);
  if (xp > 0) useToast.getState().show(`Objetivo da semana · +${xp} XP`);
}

/** Day type from the card, the chip or the free day; the companion acknowledges a lighter day. */
export async function setDayModeWithFeedback(mode: DayMode): Promise<void> {
  await setDayMode(mode);
  refreshNow(); // the day's start (the plan's cursor) is this very moment
  if (mode === 'low' || mode === 'recovery') void useCompanion.getState().say('hardDay');
  else if (mode === 'free') void useCompanion.getState().say('dayFree');
}

/** Fire-and-forget `setDayModeWithFeedback` (failures toast). */
export const pickDayMode = (mode: DayMode): void => safeRun(setDayModeWithFeedback(mode));
