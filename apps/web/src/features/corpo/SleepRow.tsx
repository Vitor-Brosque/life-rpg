import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import type { DayKey } from '@life/shared';
import type { SleepQuality } from '@life/shared';
import { SLEEP_QUALITIES, SLEEP_QUALITY_LABEL, sleepMinutes, sleepPrompt } from '@life/shared';
import { Icon } from '../../art/icons';
import { useSleepLogs, useSleepSettings } from '../../db/corpoData';
import { clearSleepTime, logBedtime, logWake, setSleepQuality } from '../../domain/sleepActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { formatClock, formatDuration } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { useToast, type ToastAction } from '../../ui/Toast';
import { useSleepSheet } from './SleepSheet';

const toast = (msg: string, action?: ToastAction) => useToast.getState().show(msg, action);

async function tapBed(night: DayKey): Promise<void> {
  const { log, created } = await logBedtime(night);
  if (!created) { toast(`Já registrado: deitou às ${formatClock(log.bedAt!)}.`); return; }
  toast(`Boa noite. Deitou às ${formatClock(log.bedAt!)}.`, {
    label: 'Desfazer', run: () => safeRun(clearSleepTime(night, 'bedAt')),
  });
}

/** Resolves true when this tap wrote the wake time (the quality question follows). */
async function tapWake(night: DayKey): Promise<boolean> {
  const { log, created } = await logWake(night);
  if (!created) { toast(`Já registrado: acordou às ${formatClock(log.wakeAt!)}.`); return false; }
  if (log.bedAt === undefined) {
    toast('Bom dia. Que horas deitou?', { label: 'Informar', run: () => useSleepSheet.getState().open(night) });
    return true;
  }
  const undo: ToastAction = { label: 'Desfazer', run: () => safeRun(clearSleepTime(night, 'wakeAt')) };
  const minutes = sleepMinutes(log);
  if (minutes === undefined) toast(`Bom dia. Acordou às ${formatClock(log.wakeAt!)}.`, undo);
  else toast(`Bom dia. Dormiu ${formatDuration(minutes)}.`, undo);
  return true;
}

/**
 * "Como foi o sono?" after "Acordei": optional, one tap, "Pular" leaves it blank. It takes the place of the row
 * whose button was tapped, so focus goes to the question (announced); after an answer, to the screen heading.
 */
function QualityPrompt({ night, onDone }: { night: DayKey; onDone(): void }) {
  const question = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => { question.current?.focus(); }, []);
  const done = (e: MouseEvent<HTMLButtonElement>) => { focusWhenGone(e.currentTarget); onDone(); };
  const pick = (q: SleepQuality) => (e: MouseEvent<HTMLButtonElement>) => {
    done(e);
    safeRun(async () => {
      await setSleepQuality(night, q);
      toast(`Sono anotado: ${SLEEP_QUALITY_LABEL[q].toLocaleLowerCase('pt-BR')}.`);
    });
  };
  return (
    <div className="care-row care-row--quality" role="group" aria-label="Qualidade do sono">
      <Icon name="moon" size={24} className="care-row__icon" />
      <span ref={question} className="care-row__text" tabIndex={-1}>Como foi o sono?</span>
      <span className="care-row__actions">
        {SLEEP_QUALITIES.map((q) => (
          <Button key={q} size="sm" aria-label={`${q} de 5: ${SLEEP_QUALITY_LABEL[q]}`} onClick={pick(q)}>{q}</Button>
        ))}
        <Button size="sm" variant="ghost" onClick={done}>Pular</Button>
      </span>
      <span className="care-row__hint muted">1 = muito ruim · 5 = muito bom</span>
    </div>
  );
}

/** "Deitei" / "Acordei" in the Agora (spec §6.1); nothing outside its windows or when turned off. */
export function SleepRow({ now, inCommitment }: { now: number; inCommitment: boolean }) {
  const logs = useSleepLogs();
  const settings = useSleepSettings();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<DayKey>();
  if (!logs || !settings?.agoraPrompt) return null;
  if (asking) return <QualityPrompt night={asking} onDone={() => setAsking(undefined)} />;
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
          <Button size="sm" variant="primary" disabled={busy} onClick={run(async () => {
            if (await tapWake(prompt.night)) setAsking(prompt.night);
          })}>Acordei</Button>
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
