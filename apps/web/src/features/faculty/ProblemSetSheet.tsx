import { useState, type FormEvent } from 'react';
import { create } from 'zustand';
import type { ID, ProblemSet } from '@life/shared';
import { problemSetText } from '@life/shared';
import { useJourneys, useToday } from '../../db/hooks';
import { FacultyValidationError, saveProblemSet } from '../../domain/facultyActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { FAILURE_TOAST } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';

export interface ProblemSetRequest { journeyId: ID; set?: ProblemSet }

interface ProblemSetSheetStore { request?: ProblemSetRequest; open(request: ProblemSetRequest): void; close(): void }

let opener: HTMLElement | null = null;

/** "Registrar exercícios" / "Editar exercícios" for the whole app (Matérias, the subject screen, the Faculdade block). */
export const useProblemSetSheet = create<ProblemSetSheetStore>((set) => ({
  request: undefined,
  open: (request) => {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    set({ request });
  },
  close: () => {
    focusWhenGone(opener);
    set({ request: undefined });
  },
}));

/** Mount once (App). */
export function ProblemSetSheetHost() {
  const { request, close } = useProblemSetSheet();
  const journeys = useJourneys();
  const today = useToday();
  const subject = request ? journeys.find((j) => j.id === request.journeyId) : undefined;
  return (
    <Sheet open={request !== undefined} onClose={close} title={request?.set ? 'Editar exercícios' : 'Registrar exercícios'}>
      {request && today && <ProblemForm request={request} subjectTitle={subject?.title} today={today} onClose={close} />}
    </Sheet>
  );
}

const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));

function ProblemForm({ request, subjectTitle, today, onClose }: {
  request: ProblemSetRequest; subjectTitle?: string; today: string; onClose(): void;
}) {
  const set = request.set;
  const [title, setTitle] = useState(set?.title ?? '');
  const [done, setDone] = useState(set ? String(set.done) : '');
  const [total, setTotal] = useState(set?.total !== undefined ? String(set.total) : '');
  const [unaided, setUnaided] = useState(set?.unaided !== undefined ? String(set.unaided) : '');
  const [day, setDay] = useState(set?.day ?? today);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const edit = (setter: (v: string) => void) => (e: { target: { value: string } }) => { setter(e.target.value); setError(undefined); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await saveProblemSet({
        ...(set ? { id: set.id } : {}),
        journeyId: request.journeyId, day: day || today, title, done: num(done),
        ...(total.trim() !== '' ? { total: num(total) } : {}),
        ...(unaided.trim() !== '' ? { unaided: num(unaided) } : {}),
      });
      useToast.getState().show(set ? 'Exercícios atualizados.' : `Exercícios registrados: ${problemSetText(saved)}.`);
      onClose();
    } catch (err) {
      if (err instanceof FacultyValidationError) setError(err.message);
      else { console.error('problem set save failed', err); useToast.getState().show(FAILURE_TOAST); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" noValidate onSubmit={(e) => { void submit(e); }}>
      {subjectTitle && <p className="faculty-form__context">{subjectTitle}</p>}
      <label className="field">
        <span className="field__label">Lista ou assunto</span>
        <input type="text" value={title} placeholder="Lista 4" autoComplete="off" onChange={edit(setTitle)} />
      </label>
      <label className="field">
        <span className="field__label">Feitos</span>
        <input type="number" inputMode="numeric" min={0} max={999} value={done} onChange={edit(setDone)} />
      </label>
      <label className="field">
        <span className="field__label">Total (opcional)</span>
        <input type="number" inputMode="numeric" min={0} max={999} value={total} onChange={edit(setTotal)} />
      </label>
      <label className="field">
        <span className="field__label">Sem ajuda (opcional)</span>
        <input type="number" inputMode="numeric" min={0} max={999} value={unaided} onChange={edit(setUnaided)} />
      </label>
      <label className="field">
        <span className="field__label">Dia</span>
        <input type="date" max={today} value={day} onChange={edit(setDay)} />
      </label>
      {error && <p role="alert" className="faculty-form__error">{error}</p>}
      <div className="faculty-form__actions">
        <Button type="submit" variant="primary" disabled={busy}>Salvar</Button>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}
