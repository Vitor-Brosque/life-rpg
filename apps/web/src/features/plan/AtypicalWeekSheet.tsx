import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { DayKey, WeekAtypical } from '@life/shared';
import { addDays } from '@life/shared';
import { setWeekAtypical } from '../../domain/patternActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import './atypical.css';

export const ATYPICAL_REASONS = ['Provas', 'Viagem', 'Saúde', 'Outro'] as const;
type Reason = (typeof ATYPICAL_REASONS)[number];

const OTHER: Reason = 'Outro';
const isPreset = (r: string): r is Reason => (ATYPICAL_REASONS as readonly string[]).includes(r);

export interface AtypicalWeekSheetProps {
  open: boolean;
  onClose(): void;
  /** Monday of the week being marked. */
  weekId: DayKey;
  /** The mark it already has, when there is one. */
  current?: WeekAtypical;
}

function AtypicalForm({ weekId, current, onClose }: Omit<AtypicalWeekSheetProps, 'open'>) {
  const [reason, setReason] = useState<Reason | undefined>(() => (current ? (isPreset(current.reason) ? current.reason : OTHER) : undefined));
  const [other, setOther] = useState(() => (current && !isPreset(current.reason) ? current.reason : ''));
  // The usual rhythm comes back on the next Monday, unless told otherwise.
  const [returnDay, setReturnDay] = useState<string>(current?.returnDay ?? addDays(weekId, 7));
  const [saving, setSaving] = useState(false);
  const [askedOther, setAskedOther] = useState(false);
  const otherRef = useRef<HTMLInputElement>(null);
  const otherId = useId();
  const dateId = useId();

  // Not autoFocus: the sheet remembers the focused element when it opens, to give focus back on close.
  useEffect(() => {
    if (askedOther) otherRef.current?.focus();
  }, [askedOther]);

  const finish = (task: () => Promise<void>) => {
    setSaving(true);
    safeRun(async () => {
      try {
        await task();
        onClose();
      } finally {
        setSaving(false);
      }
    });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!reason) return;
    finish(() => setWeekAtypical(weekId, {
      reason: reason === OTHER ? other.trim() || OTHER : reason,
      ...(returnDay ? { returnDay } : {}),
    }));
  };

  return (
    <form className="atypical" onSubmit={submit}>
      <p className="muted">Numa semana atípica, versões mínimas contam tanto quanto. Os Padrões não comparam esta semana com as outras.</p>
      <div role="group" aria-label="Motivo" className="atypical__chips">
        {ATYPICAL_REASONS.map((r) => (
          <Chip key={r} selected={reason === r} onClick={() => { setReason(r); if (r === OTHER) setAskedOther(true); }}>{r}</Chip>
        ))}
      </div>
      {reason === OTHER && (
        <label className="field" htmlFor={otherId}>
          <span className="field__label">Qual o motivo?</span>
          <input id={otherId} ref={otherRef} type="text" maxLength={60} value={other} enterKeyHint="done"
            onChange={(e) => setOther(e.target.value)} />
        </label>
      )}
      <label className="field" htmlFor={dateId}>
        <span className="field__label">O ritmo volta em</span>
        <input id={dateId} type="date" value={returnDay} min={weekId} onChange={(e) => setReturnDay(e.target.value)} />
      </label>
      <div className="atypical__actions">
        <Button type="submit" variant="primary" disabled={!reason || saving}>Marcar semana</Button>
        {current && (
          <Button disabled={saving} onClick={() => finish(() => setWeekAtypical(weekId, undefined))}>Desmarcar</Button>
        )}
      </div>
    </form>
  );
}

/** "Semana atípica": why, and when the rhythm comes back. Focus returns to whatever opened it. */
export function AtypicalWeekSheet({ open, onClose, weekId, current }: AtypicalWeekSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Semana atípica">
      <AtypicalForm weekId={weekId} current={current} onClose={onClose} />
    </Sheet>
  );
}
