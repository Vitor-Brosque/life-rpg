import type { DayKey, DayMode, ID } from '@life/shared';
import { RESUMPTION_XP } from '@life/shared';
import { refreshNow } from '../../db/hooks';
import { endBlock, setDayMode, skipBlock, startBlock, toggleObjective } from '../../domain/actions';
import { isFocusing, useTimer } from '../../timer/store';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { useCompanion } from '../companion/store';

// Block actions with their toast and companion line (shared by the banner and "Entre blocos").

const toast = (msg: string) => useToast.getState().show(msg);

/** "Bloco iniciado · +5 XP" (· "Retomada · +10 XP" after a pause); `label` names what started. */
function startedText(label: string, xp: number, resumption: boolean): string {
  const blockXp = xp - (resumption ? RESUMPTION_XP : 0);
  const parts = [blockXp > 0 ? `${label} · +${blockXp} XP` : label];
  if (resumption) parts.push(`Retomada · +${RESUMPTION_XP} XP`);
  return parts.join(' · ');
}

/** "Bloco iniciado · +5 XP" (· "Retomada · +10 XP" after a pause), then the companion. */
export async function startBlockWithFeedback(blockId: ID): Promise<void> {
  const { xp, resumption } = await startBlock(blockId);
  refreshNow();
  toast(startedText('Bloco iniciado', xp, resumption));
  void useCompanion.getState().say(resumption ? 'resumption' : 'blockStart');
}

/** "Pular hoje": no prompt and no XP; the companion acknowledges it, neutrally. */
export async function skipBlockWithFeedback(blockId: ID): Promise<void> {
  await skipBlock(blockId);
  refreshNow(); // the time the block held is free again
  toast('Bloco pulado hoje.');
  void useCompanion.getState().say('blockSkip');
}

/**
 * A routine block (morning, wind-down) ends with no "Onde parou?": there is nothing to resume.
 * `concluded` (every item ticked) records it as lived, starting it first when it was not.
 */
export async function endRoutineWithFeedback(blockId: ID, opts: { concluded: boolean; started: boolean }): Promise<void> {
  const { xp, resumption } = opts.concluded && !opts.started ? await startBlock(blockId) : { xp: 0, resumption: false };
  await endBlock(blockId);
  refreshNow(); // the next block may start at this very moment
  if (!opts.concluded) {
    toast('Bloco encerrado.');
    return;
  }
  toast(startedText('Rotina concluída', xp, resumption));
  void useCompanion.getState().say(resumption ? 'resumption' : 'complete');
}

/** "Encerrar" while the timer runs for the block's mission: the focus is recorded first (one prompt). */
export async function finishTimerFor(missionId: ID): Promise<void> {
  const t = useTimer.getState();
  if (t.status === 'idle' || t.missionId !== missionId) return;
  const focusing = isFocusing(t);
  const { xp } = await t.finish({ completeMission: false });
  if (focusing) toast(xp > 0 ? `Foco registrado · +${xp} XP` : 'Foco registrado');
  else toast('Cronômetro encerrado');
}

export async function toggleObjectiveWithFeedback(weekId: DayKey, objectiveId: ID): Promise<void> {
  const { xp } = await toggleObjective(weekId, objectiveId);
  if (xp > 0) toast(`Objetivo da semana · +${xp} XP`);
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
