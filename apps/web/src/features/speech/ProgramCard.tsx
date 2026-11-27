import { useEffect, useRef, useState } from 'react';
import type { SpeechProgram } from '@life/shared';
import { SPEECH_PHASE_NOTE_MAX, SPEECH_PROGRAM_WEEKS, clampWeek, isPhaseEnd, phaseOfWeek, programLine, speechWeek } from '@life/shared';
import {
  endSpeechProgram, reopenSpeechProgram, savePhaseNote, setProgramWeek, startSpeechProgram,
} from '../../domain/speechActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { usePageHide } from '../../ui/usePageHide';
import './speech.css';

export const PROGRAM_COPY = {
  none: 'Doze semanas em quatro fases, como referência: pular, repetir ou parar não é atraso.',
  hint: 'Avance quando quiser. Repetir uma semana é normal.',
  started: 'Programa começou: semana 1 de 12.',
  ended: 'Programa encerrado. Pode começar de novo quando quiser.',
  noteSaved: 'Resposta da fase guardada.',
  phaseQuestion: (phase: number) => `Fim da fase ${phase}: o que mudou nas situações reais? (opcional)`,
} as const;

const titleEl = (): HTMLElement | null => document.getElementById('speech-program-title');
const toast = (msg: string, action?: { label: string; run(): void }): void => useToast.getState().show(msg, action);

/** The phase answer: starts from the stored one; his typed words are saved before the week changes. */
function PhaseAnswer({ program, week, draft, setDraft, onSaved }: {
  program: SpeechProgram; week: number; draft: string; setDraft(t: string): void; onSaved(text: string): void;
}) {
  const phase = phaseOfWeek(week);
  const stored = program.phaseNotes?.[phase]?.text ?? '';
  const changed = draft.trim() !== stored;
  const field = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="stack">
      <label className="field">
        <span className="field__label">{PROGRAM_COPY.phaseQuestion(phase)}</span>
        <textarea ref={field} rows={3} maxLength={SPEECH_PHASE_NOTE_MAX} value={draft} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <div className="cluster">
        <Button size="sm" disabled={!changed} onClick={() => safeRun(savePhaseNote(program.id, phase, draft).then(() => {
          // Leaving right after the tap must not write it again before the stored answer comes back in the props.
          onSaved(draft.trim());
          toast(PROGRAM_COPY.noteSaved);
          // The button is disabled once saved: focus moves to the field.
          field.current?.focus();
        }))}>
          Salvar resposta
        </Button>
      </div>
    </div>
  );
}

export function ProgramCard({ program }: { program: SpeechProgram | null }) {
  const startRef = useRef<HTMLButtonElement>(null);
  const week = program ? clampWeek(program.week) : 1;
  const phase = phaseOfWeek(week);
  const [draftFor, setDraftFor] = useState<{ key: string; text: string }>();
  const key = program ? `${program.id}:${week}` : '';
  const stored = program?.phaseNotes?.[phase]?.text ?? '';
  const draft = draftFor?.key === key ? draftFor.text : stored;

  // His words are never lost: a changed answer is saved quietly when the screen goes away or the page is hidden.
  const latest = useRef({ programId: program?.id, week, phase, key, draft, stored });
  latest.current = { programId: program?.id, week, phase, key, draft, stored };
  /** The last text a quiet save wrote (the props do not follow it after the screen went away). */
  const written = useRef<{ key: string; text: string }>(undefined);
  const quietRun = useRef<Promise<void> | undefined>(undefined);
  const quietAgain = useRef(false);
  const saveQuietly = (): void => {
    // `visibilitychange` and `pagehide` come together on the iPhone, and the unmount can follow: one write at a time.
    if (quietRun.current) { quietAgain.current = true; return; }
    const l = latest.current;
    if (!l.programId || !isPhaseEnd(l.week)) return;
    const text = l.draft.trim();
    if (text === l.stored || (written.current?.key === l.key && written.current.text === text)) return;
    const run = savePhaseNote(l.programId, l.phase, l.draft).then(() => { written.current = { key: l.key, text }; }).finally(() => {
      quietRun.current = undefined;
      if (quietAgain.current) { quietAgain.current = false; quiet.current(); }
    });
    quietRun.current = run;
    safeRun(run);
  };
  usePageHide(saveQuietly);
  const quiet = useRef(saveQuietly);
  quiet.current = saveQuietly;
  useEffect(() => () => quiet.current(), []);

  const go = (to: number): void => {
    if (!program) return;
    safeRun((async () => {
      // His words are never lost: a changed answer is saved before the week changes.
      if (isPhaseEnd(week) && draft.trim() !== stored) await savePhaseNote(program.id, phase, draft);
      await setProgramWeek(program.id, to);
      // The tapped button is disabled at week 1 or 12: focus goes to the section title, never to <body>.
      if (to <= 1 || to >= SPEECH_PROGRAM_WEEKS) titleEl()?.focus();
    })());
  };

  return (
    <section className="stack" aria-labelledby="speech-program-title">
      <h2 id="speech-program-title" className="section-title" tabIndex={-1}>Programa de 12 semanas</h2>
      {program === null ? (
        <>
          <p className="muted">{PROGRAM_COPY.none}</p>
          <div className="cluster">
            <Button ref={startRef} onClick={(e) => {
              focusWhenGone(e.currentTarget, titleEl);
              safeRun(startSpeechProgram().then(() => toast(PROGRAM_COPY.started)));
            }}>Começar programa</Button>
          </div>
        </>
      ) : (
        <>
          <p>{programLine(program)}</p>
          <p>{`Foco: ${speechWeek(week).focus}`}</p>
          <div className="cluster">
            <Button size="sm" disabled={week <= 1} onClick={() => go(week - 1)}>Semana anterior</Button>
            <Button size="sm" disabled={week >= SPEECH_PROGRAM_WEEKS} onClick={() => go(week + 1)}>Próxima semana</Button>
          </div>
          <p className="muted">{PROGRAM_COPY.hint}</p>
          {isPhaseEnd(week) && (
            <PhaseAnswer key={key} program={program} week={week} draft={draft} setDraft={(text) => setDraftFor({ key, text })} onSaved={(text) => { written.current = { key, text }; }} />
          )}
          <div className="cluster">
            <Button variant="ghost" size="sm" onClick={(e) => {
              focusWhenGone(e.currentTarget, () => startRef.current ?? titleEl());
              const id = program.id;
              safeRun((async () => {
                // His words are never lost: a changed answer is saved before the program ends.
                if (isPhaseEnd(week) && draft.trim() !== stored) await savePhaseNote(id, phase, draft);
                await endSpeechProgram(id);
              })().then(() => toast(PROGRAM_COPY.ended, { label: 'Desfazer', run: () => safeRun(reopenSpeechProgram(id)) })));
            }}>Encerrar programa</Button>
          </div>
        </>
      )}
    </section>
  );
}
