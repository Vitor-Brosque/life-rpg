import { useState } from 'react';
import type { Commitment, DayKey } from '@life/shared';
import { formatHHmm, parseHHmm, weekdayOf } from '@life/shared';
import { useSettings } from '../../db/hooks';
import { patch, softDelete } from '../../db/repo';
import { createCommitment } from '../../domain/actions';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import './plan.css';

const WEEKDAYS = [
  { short: 'D', name: 'domingo' }, { short: 'S', name: 'segunda' }, { short: 'T', name: 'terça' },
  { short: 'Q', name: 'quarta' }, { short: 'Q', name: 'quinta' }, { short: 'S', name: 'sexta' },
  { short: 'S', name: 'sábado' },
];

export interface CommitmentSheetProps {
  open: boolean;
  /** Existing commitment to edit; without it the sheet creates a new one on `defaultDate`. */
  commitment?: Commitment;
  defaultDate: DayKey;
  onClose(): void;
}

export function CommitmentSheet({ open, commitment, defaultDate, onClose }: CommitmentSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={commitment ? 'Compromisso' : 'Novo compromisso'}>
      <CommitmentForm key={commitment?.id ?? 'new'} commitment={commitment} defaultDate={defaultDate} onClose={onClose} />
    </Sheet>
  );
}

function CommitmentForm({ commitment, defaultDate, onClose }: Omit<CommitmentSheetProps, 'open'>) {
  const settings = useSettings();
  const reminderMin = settings?.commitmentReminderMin ?? 0;
  const [title, setTitle] = useState(commitment?.title ?? '');
  const [date, setDate] = useState<DayKey>(commitment?.date ?? defaultDate);
  const [start, setStart] = useState(commitment?.start ?? '09:00');
  const [end, setEnd] = useState(commitment?.end ?? '10:00');
  const [weekdays, setWeekdays] = useState<number[]>(commitment?.weekdays ?? []);
  const [until, setUntil] = useState<DayKey | ''>(commitment?.untilDate ?? '');
  const [remind, setRemind] = useState(commitment?.remind ?? true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  const recurring = weekdays.length > 0;

  const changeStart = (v: string) => {
    // Keep the duration when the start moves.
    if (v && start && end) {
      const len = Math.max(parseHHmm(end) - parseHHmm(start), 15);
      setEnd(formatHHmm(Math.min(parseHHmm(v) + len, 23 * 60 + 59)));
    }
    setStart(v);
  };

  const toggleDay = (i: number) =>
    setWeekdays((w) => (w.includes(i) ? w.filter((d) => d !== i) : [...w, i].sort((a, b) => a - b)));

  const save = async () => {
    const t = title.trim();
    if (!t) { setError('Dê um nome ao compromisso.'); return; }
    if (!date || !start || !end) { setError('Preencha dia, início e fim.'); return; }
    if (parseHHmm(end) <= parseHHmm(start)) { setError('O fim precisa ser depois do início.'); return; }
    const series = {
      weekdays: recurring ? weekdays : undefined,
      untilDate: recurring && until ? until : undefined,
    };
    if (commitment) {
      await patch<Commitment>('commitments', commitment.id, { title: t, date, start, end, remind, ...series });
    } else {
      await createCommitment({
        title: t, date, start, end, remind,
        ...(series.weekdays ? { weekdays: series.weekdays } : {}),
        ...(series.untilDate ? { untilDate: series.untilDate } : {}),
      });
    }
    onClose();
  };

  const remove = async () => {
    if (commitment) await softDelete('commitments', commitment.id);
    onClose();
  };

  // A failed write keeps the sheet open (with what was typed) and says so.
  return (
    <form className="commit-form" onSubmit={(e) => { e.preventDefault(); safeRun(save); }}>
      <label className="field">
        <span className="field__label">Título</span>
        <input type="text" value={title} autoFocus={!commitment} enterKeyHint="done"
          onChange={(e) => { setTitle(e.target.value); setError(''); }} />
      </label>
      <label className="field">
        <span className="field__label">{recurring ? 'Primeiro dia' : 'Dia'}</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="commit-form__times">
        <label className="field">
          <span className="field__label">Início</span>
          <input type="time" value={start} onChange={(e) => changeStart(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Fim</span>
          <input type="time" value={end} onChange={(e) => { setEnd(e.target.value); setError(''); }} />
        </label>
      </div>

      <fieldset className="recurrence">
        <legend className="field__label">Repetir toda semana em</legend>
        <div className="recurrence__weekdays" role="group" aria-label="Dias da semana">
          {WEEKDAYS.map((w, i) => (
            <button key={w.name} type="button" className="weekday-toggle" aria-pressed={weekdays.includes(i)}
              aria-label={w.name} onClick={() => toggleDay(i)}>
              {w.short}
            </button>
          ))}
        </div>
        {!recurring && (
          <p className="muted commit-form__hint">
            Sem dias marcados, acontece só em {date ? WEEKDAYS[weekdayOf(date)]?.name : 'um dia'}.
          </p>
        )}
        {recurring && (
          <label className="field">
            <span className="field__label">Repetir até (opcional)</span>
            <input type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} />
          </label>
        )}
        {commitment && recurring && <p className="muted commit-form__hint">Editar muda a série inteira.</p>}
      </fieldset>

      <button type="button" role="switch" aria-checked={remind} className="switch-row"
        onClick={() => setRemind((v) => !v)}>
        <span className="switch-row__track" aria-hidden="true"><span className="switch-row__thumb" /></span>
        <span>{reminderMin > 0 ? `Lembrar ${reminderMin} min antes` : 'Lembrar antes'}</span>
      </button>
      {remind && reminderMin === 0 && (
        <p className="muted commit-form__hint">Os lembretes estão desligados nos Ajustes.</p>
      )}

      {error && <p className="commit-form__error" role="alert">{error}</p>}

      <div className="commit-form__actions">
        <Button type="submit" variant="primary" icon="check">Salvar</Button>
        <Button onClick={onClose}>Cancelar</Button>
      </div>

      {commitment && (
        <div className="commit-form__danger">
          {confirmDelete ? (
            <div className="mission-sheet__confirm">
              <p>{recurring ? 'Excluir este compromisso e todas as repetições?' : 'Excluir este compromisso?'}</p>
              <div className="cluster">
                <Button variant="danger" onClick={() => safeRun(remove)}>Sim, excluir</Button>
                <Button onClick={() => setConfirmDelete(false)}>Cancelar exclusão</Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Excluir compromisso</Button>
          )}
        </div>
      )}
    </form>
  );
}
