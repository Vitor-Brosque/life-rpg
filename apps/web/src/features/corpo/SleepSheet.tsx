import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { create } from 'zustand';
import type { DayKey, SleepQuality } from '@life/shared';
import { SLEEP_QUALITIES, SLEEP_QUALITY_LABEL, isSleepQuality, isValidDayKey, lastSleepNight, sleepLogId } from '@life/shared';
import { db } from '../../db/db';
import { useNow } from '../../db/hooks';
import { SleepValidationError, deleteSleepLog, restoreSleepLog, saveSleepTimes, setSleepQuality } from '../../domain/sleepActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { formatClock } from '../../ui/format';
import { FAILURE_TOAST, safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { shortDay } from './corpoFormat';

interface SleepSheetStore { isOpen: boolean; night?: DayKey; open(night?: DayKey): void; close(): void }

/** One night's sheet for the whole app: `open(night)` edits it, `open()` registers a forgotten one. */
export const useSleepSheet = create<SleepSheetStore>((set) => ({
  isOpen: false,
  night: undefined,
  open: (night) => {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    set({ isOpen: true, night });
  },
  close: () => {
    // The opener may be gone by then (the row or toast that opened the sheet): focus must not fall on <body>.
    focusWhenGone(opener);
    set({ isOpen: false, night: undefined });
  },
}));

let opener: HTMLElement | null = null;

/** Mount once (App). */
export function SleepSheetHost() {
  const { isOpen, night, close } = useSleepSheet();
  return (
    <Sheet open={isOpen} onClose={close} title={night ? `Noite de ${shortDay(night)}` : 'Registrar uma noite'}>
      {isOpen && <SleepForm key={night ?? 'nova'} fixedNight={night} onClose={close} />}
    </Sheet>
  );
}

const toast = (msg: string, action?: { label: string; run(): void }) => useToast.getState().show(msg, action);

function SleepForm({ fixedNight, onClose }: { fixedNight?: DayKey; onClose(): void }) {
  const now = useNow();
  const maxNight = lastSleepNight(now);
  const [night, setNight] = useState<DayKey>(fixedNight ?? maxNight);
  // undefined while loading, null when the night has no record yet.
  const log = useLiveQuery(async () => (await db.sleepLogs.get(sleepLogId(night))) ?? null, [night]);
  const live = log && !log.deleted ? log : undefined;
  const [bed, setBed] = useState('');
  const [wake, setWake] = useState('');
  const [quality, setQuality] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const loadedFor = useRef<DayKey | undefined>(undefined);

  // The stored times fill the fields once per night shown (later edits elsewhere do not overwrite typing).
  useEffect(() => {
    if (log === undefined || loadedFor.current === night) return;
    loadedFor.current = night;
    setBed(live?.bedAt !== undefined ? formatClock(live.bedAt) : '');
    setWake(live?.wakeAt !== undefined ? formatClock(live.wakeAt) : '');
    setQuality(isSleepQuality(live?.quality) ? String(live!.quality) : '');
    setError(undefined);
  }, [log, live, night]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await saveSleepTimes(night, bed || null, wake || null);
      await setSleepQuality(night, quality ? (Number(quality) as SleepQuality) : null);
      toast('Noite salva.');
      onClose();
    } catch (err) {
      if (err instanceof SleepValidationError) setError(err.message);
      else { console.error('sleep save failed', err); toast(FAILURE_TOAST); }
    } finally {
      setBusy(false);
    }
  };
  const remove = () => safeRun(async () => {
    const removed = await deleteSleepLog(night);
    onClose();
    if (removed) toast('Noite apagada.', { label: 'Desfazer', run: () => safeRun(restoreSleepLog(removed)) });
  });

  return (
    <form className="sleep-form stack" onSubmit={(e) => { void save(e); }}>
      {!fixedNight && (
        <label className="field">
          <span className="field__label">Noite de</span>
          <input type="date" value={night} max={maxNight}
            onChange={(e) => { if (isValidDayKey(e.target.value) && e.target.value <= maxNight) setNight(e.target.value); }} />
        </label>
      )}
      <div className="settings-row">
        <label className="field">
          <span className="field__label">Deitei às</span>
          <input type="time" value={bed} onChange={(e) => { setBed(e.target.value); setError(undefined); }} />
        </label>
        <label className="field">
          <span className="field__label">Acordei às</span>
          <input type="time" value={wake} onChange={(e) => { setWake(e.target.value); setError(undefined); }} />
        </label>
      </div>
      <label className="field">
        <span className="field__label">Qualidade (opcional)</span>
        <select value={quality} onChange={(e) => setQuality(e.target.value)}>
          <option value="">—</option>
          {SLEEP_QUALITIES.map((q) => <option key={q} value={q}>{`${q} · ${SLEEP_QUALITY_LABEL[q]}`}</option>)}
        </select>
      </label>
      <p className="muted">A noite vai do meio-dia ao meio-dia: deitar à 01:30 conta na noite anterior.</p>
      {error && <p role="alert" className="sleep-form__error">{error}</p>}
      <div className="sleep-form__actions">
        <Button type="submit" variant="primary" disabled={busy || log === undefined}>Salvar</Button>
        {live && <Button variant="ghost" onClick={remove}>Apagar noite</Button>}
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}
