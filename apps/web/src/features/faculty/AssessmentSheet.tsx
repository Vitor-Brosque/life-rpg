import { useState, type FormEvent } from 'react';
import type { AssessmentKind, DayKey, ID, Journey } from '@life/shared';
import { ASSESSMENT_LABEL } from '@life/shared';
import { FacultyValidationError, createAssessment } from '../../domain/facultyActions';
import { Button } from '../../ui/Button';
import { formatDay } from '../../ui/format';
import { FAILURE_TOAST } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';

export interface AssessmentSheetProps {
  open: boolean;
  onClose(): void;
  subjects: readonly Journey[];
  today: DayKey;
  /** Pre-selected subject (opened from a subject's screen). */
  journeyId?: ID;
}

export function AssessmentSheet({ open, onClose, subjects, today, journeyId }: AssessmentSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Nova prova ou trabalho">
      {open && <AssessmentForm onClose={onClose} subjects={subjects} today={today} journeyId={journeyId} />}
    </Sheet>
  );
}

const KINDS: AssessmentKind[] = ['prova', 'trabalho'];

function AssessmentForm({ onClose, subjects, today, journeyId }: Omit<AssessmentSheetProps, 'open'>) {
  const [kind, setKind] = useState<AssessmentKind>('prova');
  const [subject, setSubject] = useState<ID>(journeyId ?? subjects[0]?.id ?? '');
  const [date, setDate] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const m = await createAssessment({ kind, journeyId: subject, date, content });
      // "Prova de Cálculo II em qui 03/12." · "… amanhã." (no gendered word: prova and trabalho alike)
      const when = formatDay(date, today);
      useToast.getState().show(when === 'hoje' || when === 'amanhã' ? `${m.title} ${when}.` : `${m.title} em ${when}.`);
      onClose();
    } catch (err) {
      if (err instanceof FacultyValidationError) setError(err.message);
      else { console.error('assessment save failed', err); useToast.getState().show(FAILURE_TOAST); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" noValidate onSubmit={(e) => { void submit(e); }}>
      <div role="radiogroup" aria-label="Tipo" className="faculty-form__kinds">
        {KINDS.map((k) => (
          <label key={k} className="faculty-form__kind">
            <input type="radio" name="assessment-kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
            <span>{ASSESSMENT_LABEL[k]}</span>
          </label>
        ))}
      </div>
      <label className="field">
        <span className="field__label">Disciplina</span>
        <select value={subject} onChange={(e) => setSubject(e.target.value)}>
          {subjects.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="field__label">Data</span>
        <input type="date" min={today} value={date} onChange={(e) => { setDate(e.target.value); setError(undefined); }} />
      </label>
      <label className="field">
        <span className="field__label">Conteúdo (opcional)</span>
        <textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} />
      </label>
      {error && <p role="alert" className="faculty-form__error">{error}</p>}
      <div className="faculty-form__actions">
        <Button type="submit" variant="primary" disabled={busy}>Salvar</Button>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}
