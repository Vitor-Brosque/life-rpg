import { useState, type FormEvent } from 'react';
import { create } from 'zustand';
import type { ID } from '@life/shared';
import { recallFront } from '@life/shared';
import { StudyFileError, createRecallCard } from '../../domain/studyFileActions';
import { Button } from '../../ui/Button';
import { FAILURE_TOAST } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';

// "Lembrar antes de sair" (spec 2026-11-26 §1.6): after leaving the reader having read at least 3 new pages or for
// 5 minutes, she writes what she remembers without looking; one point per line becomes a topic card in the subject's
// deck. "Pular" closes without creating anything. The host lives in App, so the sheet shows over whatever screen she
// went to.

export interface RecallRequest { fileId: ID; title: string; from: number; to: number }

export const useRecallSheet = create<{ request?: RecallRequest; open(r: RecallRequest): void; close(): void }>((set) => ({
  request: undefined,
  open: (request) => set({ request }),
  close: () => set({ request: undefined }),
}));

/** "Sem olhar, o que você lembra das páginas 12 a 18?" (one page: "da página 12?"). */
export const recallQuestion = (from: number, to: number): string =>
  from === to ? `Sem olhar, o que você lembra da página ${from}?` : `Sem olhar, o que você lembra das páginas ${from} a ${to}?`;

export function RecallSheetHost() {
  const request = useRecallSheet((s) => s.request);
  const close = useRecallSheet((s) => s.close);
  return (
    <Sheet open={request !== undefined} onClose={close} title="Lembrar antes de sair" placement="top">
      {request && <RecallForm key={`${request.fileId}:${request.from}:${request.to}`} request={request} onDone={close} />}
    </Sheet>
  );
}

function RecallForm({ request, onDone }: { request: RecallRequest; onDone: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await createRecallCard({ fileId: request.fileId, from: request.from, to: request.to, text });
      useToast.getState().show('Card de tópico criado.');
      onDone();
    } catch (err) {
      setSaving(false);
      if (err instanceof StudyFileError) setError(err.message);
      else { console.error('recall card failed', err); useToast.getState().show(FAILURE_TOAST); }
    }
  };
  return (
    <form className="stack" noValidate onSubmit={(e) => { void submit(e); }}>
      <label className="field">
        <span className="field__label">{recallQuestion(request.from, request.to)}</span>
        <textarea rows={6} value={text} autoFocus placeholder="Um ponto por linha."
          onChange={(e) => { setText(e.target.value); setError(undefined); }} />
      </label>
      <p className="muted">{`Vira um card de tópico no baralho da disciplina, com a frente "${recallFront(request.title, request.from, request.to)}".`}</p>
      {error && <p role="alert" className="faculty-form__error">{error}</p>}
      <div className="faculty-actions">
        <Button type="submit" variant="primary" disabled={saving}>Salvar</Button>
        <Button variant="ghost" onClick={onDone}>Pular</Button>
      </div>
    </form>
  );
}
