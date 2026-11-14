import { useState, type ReactNode } from 'react';
import type { CloseBlockRow, FocusSession, ID } from '@life/shared';
import { useMissions } from '../../db/hooks';
import {
  CorrectionError, correctBlockTimes, correctFocusMinutes, deleteFocusSession, restoreFocusSession, retroBlock,
} from '../../domain/dayCloseActions';
import { Button } from '../../ui/Button';
import { formatClock } from '../../ui/format';
import { FAILURE_TOAST, safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';

/** Runs a correction; a CorrectionError becomes the inline message, anything else the failure toast. */
async function attempt(fn: () => Promise<void>, setError: (m: string | undefined) => void): Promise<boolean> {
  setError(undefined);
  try {
    await fn();
    return true;
  } catch (e) {
    if (e instanceof CorrectionError) setError(e.message);
    else { console.error('correction failed', e); useToast.getState().show(FAILURE_TOAST); }
    return false;
  }
}

function TimesForm({ initial, submit, note, onDone }: {
  initial: { start: string; end: string }; submit: string; note?: string;
  onDone(start: string, end: string): Promise<void>;
}) {
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <form className="day-close__fix-form" noValidate onSubmit={(e) => {
      e.preventDefault();
      setBusy(true);
      void attempt(() => onDone(start, end), setError).finally(() => setBusy(false));
    }}>
      <label><span>Início</span><input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <label><span>Fim</span><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      <Button type="submit" size="sm" variant="primary" disabled={busy}>{submit}</Button>
      {note && <p className="day-close__hint">{note}</p>}
      {error && <p role="alert" className="day-close__error">{error}</p>}
    </form>
  );
}

function BlockFix({ row }: { row: CloseBlockRow }) {
  const [open, setOpen] = useState(false);
  const started = row.startedAt !== undefined;
  const times = started
    ? { start: formatClock(row.startedAt!), end: formatClock(row.endedAt ?? row.startedAt!) }
    : { start: formatClock(row.plannedStart), end: formatClock(row.plannedEnd) };
  return (
    <li className="day-close__fix">
      <div className="day-close__fix-row">
        <span>{started ? `${row.name}: ${times.start}–${times.end}` : `${row.name}: sem registro`}</span>
        <Button size="sm" variant="ghost" aria-expanded={open}
          aria-label={started ? `Ajustar horário de ${row.name}` : `Fiz, mas não registrei: ${row.name}`}
          onClick={() => setOpen(!open)}>
          {started ? 'Ajustar horário' : 'Fiz, mas não registrei'}
        </Button>
      </div>
      {open && (started
        ? <TimesForm initial={times} submit="Salvar horário" onDone={async (s, e) => { await correctBlockTimes(row.blockId, s, e); setOpen(false); }} />
        : <TimesForm initial={times} submit="Registrar" note="Fica marcado como registrado depois e não dá XP."
            onDone={async (s, e) => { await retroBlock(row.blockId, s, e); setOpen(false); }} />)}
    </li>
  );
}

function FocusFix({ session, title }: { session: FocusSession; title: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(String(Math.round(session.activeMs / 60_000)));
  const [error, setError] = useState<string>();
  const clock = formatClock(session.startedAt);
  const remove = () => safeRun(async () => {
    const removed = await deleteFocusSession(session.id);
    if (!removed) return;
    useToast.getState().show('Sessão de foco apagada.', {
      label: 'Desfazer', run: () => safeRun(restoreFocusSession(removed)),
    });
  });
  return (
    <li className="day-close__fix">
      <div className="day-close__fix-row">
        <span>{`${clock} · ${Math.round(session.activeMs / 60_000)} min · `}{title}</span>
        <span className="day-close__row-actions">
          <Button size="sm" variant="ghost" aria-expanded={open} aria-label={`Corrigir minutos do foco das ${clock}`}
            onClick={() => setOpen(!open)}>Corrigir minutos</Button>
          <Button size="sm" variant="ghost" aria-label={`Apagar foco das ${clock}`} onClick={remove}>Apagar</Button>
        </span>
      </div>
      {open && (
        <form className="day-close__fix-form" noValidate onSubmit={(e) => {
          e.preventDefault();
          void attempt(() => correctFocusMinutes(session.id, Number(minutes)), setError).then((ok) => { if (ok) setOpen(false); });
        }}>
          <label><span>Minutos</span>
            <input type="number" inputMode="numeric" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </label>
          <Button type="submit" size="sm" variant="primary">Salvar minutos</Button>
          {error && <p role="alert" className="day-close__error">{error}</p>}
        </form>
      )}
    </li>
  );
}

/** "Correções": block times, "Fiz, mas não registrei" and focus minutes of today. */
export function DayCloseCorrections({ blocks, focus }: { blocks: CloseBlockRow[]; focus: FocusSession[] }) {
  const missions = useMissions();
  const titles = new Map<ID, string>(missions.map((m) => [m.id, m.title]));
  return (
    <details className="day-close__details">
      <summary>Correções</summary>
      {blocks.length > 0 && (
        <ul className="day-close__fixes" aria-label="Blocos de hoje">
          {blocks.map((b) => <BlockFix key={b.blockId} row={b} />)}
        </ul>
      )}
      {focus.length > 0 && (
        <ul className="day-close__fixes" aria-label="Sessões de foco de hoje">
          {focus.map((f) => <FocusFix key={f.id} session={f} title={(f.missionId && titles.get(f.missionId)) || 'Foco livre'} />)}
        </ul>
      )}
      {blocks.length === 0 && focus.length === 0 && <p className="day-close__hint">Nada para corrigir hoje.</p>}
    </details>
  );
}
