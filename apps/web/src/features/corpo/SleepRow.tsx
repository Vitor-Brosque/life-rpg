import { useState, type MouseEvent } from 'react';
import type { DayKey } from '@life/shared';
import { sleepMinutes, sleepPrompt } from '@life/shared';
import { Icon } from '../../art/icons';
import { useSleepLogs, useSleepSettings } from '../../db/corpoData';
import { clearSleepTime, logBedtime, logWake } from '../../domain/sleepActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { formatClock, formatDuration } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { useToast, type ToastAction } from '../../ui/Toast';
import { useSleepSheet } from './SleepSheet';

const toast = (msg: string, action?: ToastAction) => useToast.getState().show(msg, action);

async function tapBed(night: DayKey): Promise<void> {
  const { log } = await logBedtime(night);
  toast(`Boa noite. Deitou às ${formatClock(log.bedAt!)}.`, {
    label: 'Desfazer', run: () => safeRun(clearSleepTime(night, 'bedAt')),
  });
}

async function tapWake(night: DayKey): Promise<void> {
  const { log, xp } = await logWake(night);
  if (log.bedAt === undefined) {
    toast('Bom dia. Que horas deitou?', { label: 'Informar', run: () => useSleepSheet.getState().open(night) });
    return;
  }
  const undo: ToastAction = { label: 'Desfazer', run: () => safeRun(clearSleepTime(night, 'wakeAt')) };
  const minutes = sleepMinutes(log);
  if (minutes === undefined) toast(`Bom dia. Acordou às ${formatClock(log.wakeAt!)}.`, undo);
  else toast(`Bom dia. Dormiu ${formatDuration(minutes)}${xp > 0 ? ` · +${xp} XP` : '.'}`, undo);
}

/** "Deitei" / "Acordei" in the Agora (spec §6.1); nothing outside its windows or when turned off. */
export function SleepRow({ now, inCommitment }: { now: number; inCommitment: boolean }) {
  const logs = useSleepLogs();
  const settings = useSleepSettings();
  const [busy, setBusy] = useState(false);
  if (!logs || !settings?.agoraPrompt) return null;
  const prompt = sleepPrompt({ now, logs, inCommitment });
  if (prompt.kind === 'none') return null;

  // When the tapped button leaves the page (the row hides after "Acordei"), focus moves to the heading.
  const run = (work: () => Promise<void>) => (e: MouseEvent<HTMLButtonElement>) => {
    focusWhenGone(e.currentTarget);
    setBusy(true);
    safeRun(work().finally(() => setBusy(false)));
  };
  const text = prompt.kind === 'bed' ? 'Indo dormir?'
    : prompt.kind === 'asleep' ? `Deitou às ${formatClock(prompt.bedAt)}` : 'Bom dia!';

  return (
    <div className="care-row" role="group" aria-label="Sono">
      <Icon name="moon" size={24} className="care-row__icon" />
      <span className="care-row__text">{text}</span>
      <span className="care-row__actions">
        {prompt.kind === 'bed' ? (
          <Button size="sm" variant="primary" disabled={busy} onClick={run(() => tapBed(prompt.night))}>Deitei</Button>
        ) : (
          <Button size="sm" variant="primary" disabled={busy} onClick={run(() => tapWake(prompt.night))}>Acordei</Button>
        )}
        {prompt.kind === 'asleep' && (
          <Button size="sm" variant="ghost" aria-label="Editar a noite" onClick={() => useSleepSheet.getState().open(prompt.night)}>
            Editar
          </Button>
        )}
      </span>
    </div>
  );
}
