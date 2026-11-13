import { useState } from 'react';
import type { PracticeSession } from '@life/shared';
import { PRACTICE_LIMITS, resumeSuggestion } from '@life/shared';
import { pausePractice } from '../../domain/practiceActions';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';

export interface PauseSheetProps { open: boolean; session: PracticeSession; onClose(): void; onPaused(): void }

/** "Pausar sessão" (spec §5.4): the first action of next time, prefilled with the current note or a suggestion. */
export function PauseSheet({ open, session, onClose, onPaused }: PauseSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Pausar sessão">
      {open && <PauseForm session={session} onClose={onClose} onPaused={onPaused} />}
    </Sheet>
  );
}

function PauseForm({ session, onClose, onPaused }: Omit<PauseSheetProps, 'open'>) {
  // Until the user types, follow the stored note: a draft still being saved may land after the sheet opens.
  const [edited, setEdited] = useState<string>();
  const text = edited ?? session.nextAction ?? resumeSuggestion(session);
  const [busy, setBusy] = useState(false);
  const leave = (): void => { onClose(); onPaused(); };
  const pause = (): void => {
    if (busy) return;
    setBusy(true);
    safeRun(pausePractice(session.id, text).then(leave).finally(() => setBusy(false)));
  };
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); pause(); }}>
      <label className="field">
        <span className="field__label">Onde parou? Qual a primeira ação da próxima vez?</span>
        <input type="text" value={text} maxLength={PRACTICE_LIMITS.nextAction} enterKeyHint="done"
          onChange={(e) => setEdited(e.target.value)} />
      </label>
      <div className="cluster">
        <Button type="submit" variant="primary" disabled={busy}>Pausar</Button>
        <Button onClick={leave}>Sair sem anotar</Button>
      </div>
    </form>
  );
}
