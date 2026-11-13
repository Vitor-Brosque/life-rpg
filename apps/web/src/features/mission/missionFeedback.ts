import { navigate } from 'wouter/use-browser-location';
import type { DayKey, MissionStatus } from '@life/shared';
import { db } from '../../db/db';
import {
  completeMission, dropMission, shrinkMission, snoozeMission, splitMission, startMission, undoComplete,
  updateMission, type CompletionResult,
} from '../../domain/actions';
import { planMission } from '../../domain/missionActions';
import { formatDay } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import type { PhraseCategory } from '../companion/phrases';
import { useCompanion } from '../companion/store';

// Mission actions plus their feedback (toast, companion), shared by Agora, the mission sheet
// and the Painel (Task 11), so every entry point reacts the same way.

export const UNDO_MS = 6000;

const toast = (msg: string, action?: { label: string; run(): void }, ms?: number) =>
  useToast.getState().show(msg, action, ms);
const say = (cat: PhraseCategory) => void useCompanion.getState().say(cat);

/** Completes; toast "Missão concluída · +N XP" with "Desfazer" for 6 s. A level-up rides in the same toast. */
export async function completeWithFeedback(id: string): Promise<CompletionResult> {
  const r = await completeMission(id);
  if (r.xp > 0) {
    const msg = r.leveledUp
      ? `Missão concluída · +${r.xp} XP · Subiu para o nível ${r.newLevel}!`
      : `Missão concluída · +${r.xp} XP`;
    toast(msg, { label: 'Desfazer', run: () => safeRun(undoComplete(id)) }, UNDO_MS);
    say(r.leveledUp ? 'levelUp' : 'complete');
  }
  return r;
}

/**
 * Back to open (the mission sheet's "Reabrir", the board's move out of "Feito"). A done mission
 * undoes its completion, XP included, so completing it again cannot award twice; when no
 * completion is on record (e.g. synced already done) the status is reset directly.
 */
export async function reopenMission(id: string): Promise<void> {
  const m = await db.missions.get(id);
  if (!m) return;
  if (m.status === 'done') {
    await undoComplete(id);
    if ((await db.missions.get(id))?.status === 'done') {
      await updateMission(id, { status: 'open', completedAt: undefined });
    }
  } else if (m.status === 'dropped') {
    await updateMission(id, { status: 'open', dropReason: undefined });
  }
}

/** `lead` rides in front of the start toast (e.g. "Check-in · +2 XP"), so neither replaces the other. */
export async function startWithFeedback(id: string, lead?: string): Promise<void> {
  const { xp } = await startMission(id);
  const msg = [lead, xp > 0 ? `Começou · +${xp} XP` : undefined].filter(Boolean).join(' · ');
  if (msg) toast(msg);
  say('start');
}

/**
 * "Soltar" is a legitimate exit: no penalty, and it can be undone for a few seconds.
 * `onUndo` runs once "Desfazer" has restored the mission (the review lists it again).
 */
export async function dropWithFeedback(id: string, reason?: string, onUndo?: () => void): Promise<void> {
  const prev: MissionStatus = (await db.missions.get(id))?.status ?? 'open';
  await dropMission(id, reason);
  toast('Missão solta. Tudo bem.', {
    label: 'Desfazer',
    run: () => safeRun(async () => {
      await updateMission(id, { status: prev === 'dropped' ? 'open' : prev, dropReason: undefined });
      onUndo?.();
    }),
  }, UNDO_MS);
  say('drop');
}

/** Saves the 5-minute version as the first step (§6: firstStep, shrunk, durationMin 5). */
export async function shrinkWithFeedback(id: string, firstStep: string): Promise<void> {
  const { xp } = await shrinkMission(id, firstStep);
  await updateMission(id, { durationMin: 5 });
  toast(xp > 0 ? `Versão de 5 minutos salva · +${xp} XP` : 'Versão de 5 minutos salva');
  say('shrink');
}

export async function snoozeWithFeedback(
  id: string, option: 'later' | 'tomorrow' | { date: DayKey }, today: DayKey,
): Promise<void> {
  await snoozeMission(id, option);
  toast(option === 'later' ? 'Ela volta em 3 horas.'
    : option === 'tomorrow' ? 'Guardada para amanhã.'
      : `Guardada para ${formatDay(option.date, today)}.`);
  say('snooze');
}

/** "Guardar para o próximo {bloco}": the if-then plan of a repeated postponement. */
export async function planWithFeedback(
  id: string, plan: { cueBlockId?: string; firstStep?: string; date: DayKey }, today: DayKey,
): Promise<void> {
  await planMission(id, plan);
  toast(`Plano guardado para ${formatDay(plan.date, today)}.`);
  say('snooze');
}

/** Mission → journey (checklist items become its missions). */
export async function splitWithFeedback(id: string): Promise<void> {
  const j = await splitMission(id);
  toast(`Virou a jornada “${j.title}”`, { label: 'Ver', run: () => navigate(`/jornadas/${j.id}`) });
}
