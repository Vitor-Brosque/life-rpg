import { useId, useState, type KeyboardEvent } from 'react';
import type { ID, PracticeError } from '@life/shared';
import { PRACTICE_LIMITS } from '@life/shared';
import { addPracticeError, updatePracticeError } from '../../domain/practiceActions';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';

export interface ErrorSheetProps { open: boolean; sessionId: ID; entry?: PracticeError; onClose(): void }

/** "Registrar erro" / "Editar erro" (spec §5.3): what went wrong (required), why, the right idea. */
export function ErrorSheet({ open, sessionId, entry, onClose }: ErrorSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={entry ? 'Editar erro' : 'Registrar erro'} placement="top">
      {open && <ErrorForm key={entry?.id ?? 'novo'} sessionId={sessionId} entry={entry} onClose={onClose} />}
    </Sheet>
  );
}

function ErrorForm({ sessionId, entry, onClose }: Omit<ErrorSheetProps, 'open'>) {
  const alertId = useId();
  const [what, setWhat] = useState(entry?.what ?? '');
  const [why, setWhy] = useState(entry?.why ?? '');
  const [fix, setFix] = useState(entry?.fix ?? '');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = (): void => {
    if (busy) return;
    if (!what.trim()) { setMissing(true); return; }
    setBusy(true);
    const fields = { what, why, fix };
    // On failure the sheet stays open with the text (safeRun shows the toast); on success it closes
    // and the Sheet hands focus back to the control that opened it.
    safeRun((entry ? updatePracticeError(sessionId, entry.id, fields) : addPracticeError(sessionId, fields))
      .then(onClose)
      .finally(() => setBusy(false)));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>): void => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation(); // the session screen would move to the next step
    save();
  };
  const max = PRACTICE_LIMITS.errorField;
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }} onKeyDown={onKeyDown}>
      <label className="field practice-field">
        <span className="field__label">O que deu errado?</span>
        <textarea rows={2} value={what} maxLength={max} placeholder="ex.: o loop parou na primeira notícia repetida"
          aria-invalid={missing || undefined} aria-describedby={missing ? alertId : undefined}
          onChange={(e) => { setWhat(e.target.value); setMissing(false); }} />
      </label>
      {missing && <p id={alertId} role="alert" className="practice__alert">Descreva o que deu errado.</p>}
      <label className="field practice-field">
        <span className="field__label">Por quê?</span>
        <textarea rows={2} value={why} maxLength={max} placeholder="ex.: usei return dentro do for" onChange={(e) => setWhy(e.target.value)} />
      </label>
      <label className="field practice-field">
        <span className="field__label">Qual é a ideia correta?</span>
        <textarea rows={2} value={fix} maxLength={max} placeholder="ex.: guardar numa lista e retornar depois do loop"
          onChange={(e) => setFix(e.target.value)} />
      </label>
      <Button type="submit" variant="primary" disabled={busy}>Salvar erro</Button>
    </form>
  );
}
