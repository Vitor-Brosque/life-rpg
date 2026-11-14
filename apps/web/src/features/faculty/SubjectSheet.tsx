import { useState, type FormEvent } from 'react';
import type { HHmm } from '@life/shared';
import { CLASS_END, CLASS_START } from '@life/shared';
import { FacultyValidationError, createSubject } from '../../domain/facultyActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { WEEKDAY_ABBR } from '../../ui/format';
import { FAILURE_TOAST } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';

/** Monday first, Sunday last. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function SubjectSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Nova disciplina">
      {open && <SubjectForm onClose={onClose} />}
    </Sheet>
  );
}

function SubjectForm({ onClose }: { onClose(): void }) {
  const [title, setTitle] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState<string>(CLASS_START);
  const [end, setEnd] = useState<string>(CLASS_END);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const toggle = (d: number) => setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d]));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const j = await createSubject({ title, weekdays: days, start: start as HHmm, end: end as HHmm });
      useToast.getState().show(`Disciplina “${j.title}” criada.`);
      onClose();
    } catch (err) {
      if (err instanceof FacultyValidationError) setError(err.message);
      else { console.error('subject save failed', err); useToast.getState().show(FAILURE_TOAST); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" noValidate onSubmit={(e) => { void submit(e); }}>
      <label className="field">
        <span className="field__label">Nome</span>
        <input type="text" value={title} autoComplete="off" enterKeyHint="done"
          onChange={(e) => { setTitle(e.target.value); setError(undefined); }} />
      </label>
      <fieldset>
        <legend className="field__label">Dias da aula</legend>
        <div className="faculty-form__days">
          {WEEKDAY_ORDER.map((d) => (
            <Chip key={d} selected={days.includes(d)} onClick={() => { toggle(d); setError(undefined); }}>{WEEKDAY_ABBR[d]}</Chip>
          ))}
        </div>
      </fieldset>
      <div className="faculty-form__times">
        <label className="field">
          <span className="field__label">Início</span>
          <input type="time" value={start} onChange={(e) => { setStart(e.target.value); setError(undefined); }} />
        </label>
        <label className="field">
          <span className="field__label">Fim</span>
          <input type="time" value={end} onChange={(e) => { setEnd(e.target.value); setError(undefined); }} />
        </label>
      </div>
      <p className="faculty-form__hint">Sem dia marcado, a aula fica para depois.</p>
      {error && <p role="alert" className="faculty-form__error">{error}</p>}
      <div className="faculty-form__actions">
        <Button type="submit" variant="primary" disabled={busy}>Salvar</Button>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}
