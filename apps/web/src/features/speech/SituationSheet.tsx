import { useRef, useState, type MouseEvent } from 'react';
import { create } from 'zustand';
import type { SituationContext, SituationRepeats, SpeechScore, SpeechSituation } from '@life/shared';
import {
  SITUATION_CONTEXTS, SITUATION_CONTEXT_LABEL, SITUATION_NOTE_MAX, SITUATION_REPEATS, SITUATION_REPEATS_LABEL,
  SITUATION_REPEATS_TEXT, SPEECH_REPEATS_NOTE, SPEECH_SCORES,
} from '@life/shared';
import { logSituation, removeSituation } from '../../domain/speechActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { focusWhenGone } from '../../ui/focusAfter';
import { ddmm } from '../../ui/format';
import { Sheet } from '../../ui/Sheet';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import './speech.css';

export interface SituationDraft {
  context?: SituationContext;
  repeats?: SituationRepeats;
  clarity?: SpeechScore;
  comfort?: SpeechScore;
  note: string;
}

interface SituationSheetStore {
  isOpen: boolean;
  draft: SituationDraft;
  open(): void;
  close(): void;
  setDraft(d: SituationDraft): void;
  reset(): void;
}

let opener: HTMLElement | null = null;

/** The "Situação real" sheet for the whole app. The draft lives here: closing without registering keeps his words. */
export const useSituationSheet = create<SituationSheetStore>((set) => ({
  isOpen: false,
  draft: { note: '' },
  open: () => {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    set({ isOpen: true });
  },
  close: () => {
    // The opener may be gone by then (the "Como foi hoje?" sheet closes first): focus must not fall on <body>.
    focusWhenGone(opener);
    set({ isOpen: false });
  },
  setDraft: (draft) => set({ draft }),
  reset: () => set({ draft: { note: '' } }),
}));

/** "23/11 · Aula · pediram para repetir nenhuma vez · clareza 4". */
export const situationLine = (x: SpeechSituation): string => [
  ddmm(x.day),
  SITUATION_CONTEXT_LABEL[x.context],
  x.repeats !== undefined ? `pediram para repetir ${SITUATION_REPEATS_TEXT[x.repeats]}` : '',
  x.clarity !== undefined ? `clareza ${x.clarity}` : '',
  x.comfort !== undefined ? `conforto ${x.comfort}` : '',
].filter(Boolean).join(' · ');

function Scores({ legend, name, value, onPick }: {
  legend: string; name: string; value: SpeechScore | undefined; onPick(n: SpeechScore | undefined): void;
}) {
  return (
    <fieldset className="speech-chips">
      <legend className="field__label">{legend}</legend>
      {SPEECH_SCORES.map((n) => (
        <Chip key={n} selected={value === n} aria-label={`${name}: ${n} de 5`} onClick={() => onPick(value === n ? undefined : n)}>{n}</Chip>
      ))}
    </fieldset>
  );
}

function SituationBody() {
  const { draft, setDraft, reset, close } = useSituationSheet();
  const set = (p: Partial<SituationDraft>): void => setDraft({ ...draft, ...p });
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const register = (e: MouseEvent<HTMLButtonElement>): void => {
    const context = draft.context;
    if (!context || saving.current) return;
    saving.current = true;
    // The button is about to be disabled, which would drop its focus to <body>: the dialog keeps it meanwhile.
    e.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus();
    setBusy(true);
    safeRun((async () => {
      try {
        const s = await logSituation({ ...draft, context });
        reset();
        useToast.getState().show('Situação registrada.', { label: 'Desfazer', run: () => safeRun(removeSituation(s.id)) });
        close();
      } finally {
        saving.current = false;
        setBusy(false);
      }
    })());
  };
  return (
    <div className="stack speech-sheet">
      <fieldset className="speech-chips">
        <legend className="field__label">Contexto</legend>
        {SITUATION_CONTEXTS.map((c) => (
          <Chip key={c} selected={draft.context === c} onClick={() => set({ context: draft.context === c ? undefined : c })}>
            {SITUATION_CONTEXT_LABEL[c]}
          </Chip>
        ))}
      </fieldset>
      <fieldset className="speech-chips">
        <legend className="field__label">Pediram para repetir? (opcional)</legend>
        {SITUATION_REPEATS.map((r) => (
          <Chip key={r} selected={draft.repeats === r} onClick={() => set({ repeats: draft.repeats === r ? undefined : r })}>
            {SITUATION_REPEATS_LABEL[r]}
          </Chip>
        ))}
      </fieldset>
      <Scores legend="Clareza percebida (opcional)" name="Clareza percebida" value={draft.clarity} onPick={(n) => set({ clarity: n })} />
      <Scores legend="Conforto (opcional)" name="Conforto" value={draft.comfort} onPick={(n) => set({ comfort: n })} />
      <label className="field">
        <span className="field__label">Uma frase (opcional)</span>
        <input type="text" maxLength={SITUATION_NOTE_MAX} value={draft.note} onChange={(e) => set({ note: e.target.value })} />
      </label>
      <p className="muted">{SPEECH_REPEATS_NOTE}</p>
      <Button variant="primary" disabled={!draft.context || busy} onClick={register}>Registrar</Button>
    </div>
  );
}

export function SituationSheetHost() {
  const { isOpen, close } = useSituationSheet();
  return (
    <Sheet open={isOpen} onClose={close} title="Situação real">
      {isOpen && <SituationBody />}
    </Sheet>
  );
}
