import { useId, useState, type FormEvent } from 'react';
import { create } from 'zustand';
import type { ChecklistItem, ID } from '@life/shared';
import { isOfBlock } from '@life/shared';
import { readCurrentBlock } from '../../db/dayPlan';
import { db } from '../../db/db';
import { refreshNow } from '../../db/hooks';
import { endBlock, saveNextAction } from '../../domain/actions';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import './blocks.css';

// "Onde parou?" (§6 Retomada): the first action of next time, written while it is still fresh.

export interface ResumeRequest {
  /** Block whose session (today) keeps the note. */
  blockId?: ID;
  /** Mission whose first step becomes the note. */
  missionId?: ID;
  /** Editable prefill: the next unchecked step of the mission. */
  suggestion?: string;
  /** "Encerrar bloco": Salvar and Pular also end the block; closing the sheet keeps it going. */
  endsBlock?: boolean;
  /** Timer: the note also goes to the block current when saving, if the mission belongs to it. */
  linkCurrentBlock?: boolean;
}

interface ResumePromptStore {
  request?: ResumeRequest;
  /** Bumped on every open, so a reopened prompt starts from its own prefill. */
  seq: number;
  open(request: ResumeRequest): void;
  close(): void;
}

/** Global opener (Encerrar bloco, timer finish/interrupt). Mount `ResumePromptHost` once. */
export const useResumePrompt = create<ResumePromptStore>((set) => ({
  request: undefined,
  seq: 0,
  open: (request) => set((s) => ({ request, seq: s.seq + 1 })),
  close: () => set({ request: undefined }),
}));

/** First unchecked checklist item ('' when there is none). */
export function firstOpenStep(m?: { checklist: ChecklistItem[] }): string {
  return m?.checklist.find((c) => !c.done)?.text ?? '';
}

/** The current block, when the mission belongs to it. */
async function currentBlockOf(missionId: ID | undefined): Promise<ID | undefined> {
  const [current, mission] = await Promise.all([readCurrentBlock(), missionId ? db.missions.get(missionId) : undefined]);
  return current && mission && isOfBlock(mission, current.block) ? current.block.id : undefined;
}

/** Saves the note (session + mission first step) and ends the block when asked. */
async function resolve(request: ResumeRequest, text: string): Promise<void> {
  const note = text.trim();
  if (request.endsBlock && request.blockId) {
    await endBlock(request.blockId, note || undefined);
    refreshNow(); // the next block may start at this very moment
    if (note && request.missionId) await saveNextAction({ missionId: request.missionId, text: note });
  } else if (note) {
    const blockId = request.blockId ?? (request.linkCurrentBlock ? await currentBlockOf(request.missionId) : undefined);
    await saveNextAction({ blockId, missionId: request.missionId, text: note });
  }
  const msg = request.endsBlock
    ? note ? 'Bloco encerrado · próxima ação anotada.' : 'Bloco encerrado.'
    : note ? 'Próxima ação anotada.' : undefined;
  if (msg) useToast.getState().show(msg);
}

function ResumeForm({ request, onDone }: { request: ResumeRequest; onDone(): void }) {
  const [text, setText] = useState(request.suggestion ?? '');
  const inputId = useId();
  const finish = (save: boolean) => {
    onDone();
    safeRun(resolve(request, save ? text : ''));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    finish(true);
  };
  return (
    <form className="resume-form" onSubmit={submit}>
      <label className="field" htmlFor={inputId}>
        <span className="field__label resume-form__question">Qual a primeira ação da próxima vez?</span>
        <input
          id={inputId}
          type="text"
          value={text}
          enterKeyHint="done"
          placeholder="ex.: abrir o arquivo e rodar o teste"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="resume-form__hint">Algo pequeno e concreto: da próxima vez você já começa por aqui.</p>
      <div className="resume-form__actions">
        <Button type="submit" variant="primary" icon="check">Salvar</Button>
        <Button variant="ghost" onClick={() => finish(false)}>Pular</Button>
      </div>
    </form>
  );
}

export interface ResumePromptProps { request?: ResumeRequest; onClose(): void; formKey?: number }

export function ResumePrompt({ request, onClose, formKey }: ResumePromptProps) {
  return (
    <Sheet open={request !== undefined} onClose={onClose} title="Onde parou?">
      {request && <ResumeForm key={formKey} request={request} onDone={onClose} />}
    </Sheet>
  );
}

/** Mount once (App). */
export function ResumePromptHost() {
  const request = useResumePrompt((s) => s.request);
  const seq = useResumePrompt((s) => s.seq);
  const close = useResumePrompt((s) => s.close);
  return <ResumePrompt request={request} formKey={seq} onClose={close} />;
}
