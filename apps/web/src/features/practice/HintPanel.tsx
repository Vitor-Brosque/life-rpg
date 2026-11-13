import { useEffect, useId, useRef, useState } from 'react';
import type { HintLevel, PracticeSession, PracticeStep } from '@life/shared';
import { HINT_LEVEL_LABEL, hintPreview, hintRequestOf, hintStepState, isHintStep } from '@life/shared';
import { AI_ERROR_COPY, askHint } from '../../ai/aiClient';
import { AiSent, AiTag } from '../../ai/AiSent';
import { useAiFeature } from '../../ai/aiStatus';
import { addAiHint } from '../../domain/aiActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { Rich } from '../study/Rich';

const label = (level: HintLevel): string => `Pista ${level} · ${HINT_LEVEL_LABEL[level]}`;

/** "Pistas graduais" at the bottom of a step (spec §6.3). Draws nothing unless the AI aid is on. */
export function HintPanel({ session, step }: { session: PracticeSession; step: PracticeStep }) {
  const enabled = useAiFeature('hints');
  const [busy, setBusy] = useState<HintLevel>();
  const [error, setError] = useState<string>();
  const [unsaved, setUnsaved] = useState<{ level: HintLevel; text: string }>();
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Bumped on a new step or session: an answer that comes back after that is not shown here.
  const epoch = useRef(0);

  useEffect(() => {
    epoch.current += 1;
    setBusy(undefined); setError(undefined); setUnsaved(undefined);
  }, [step, session.id]);

  if (!enabled || !isHintStep(step)) return null;
  const state = hintStepState(session, step);
  if (state.kind === 'hidden') return null;

  const ask = (level: HintLevel): void => {
    const mine = epoch.current;
    const here = (): boolean => epoch.current === mine;
    // After the third hint the button goes away: focus moves to the panel title, never to <body>.
    focusWhenGone(buttonRef.current, () => titleRef.current);
    setBusy(level);
    setError(undefined);
    setUnsaved(undefined);
    safeRun(async () => {
      try {
        const r = await askHint(hintRequestOf(session, step, level));
        if (!r.ok) { if (here()) setError(AI_ERROR_COPY[r.error]); return; }
        const saved = await addAiHint(session.id, { step, level, text: r.data.text });
        if (saved === 'full' && here()) setUnsaved({ level, text: r.data.text });
      } catch (e) {
        if (here()) setError(AI_ERROR_COPY.upstream);
        throw e; // safeRun logs it and tells the person
      } finally {
        if (here()) setBusy(undefined);
      }
    });
  };

  return (
    <section className="hint-panel" aria-labelledby={titleId}>
      <h3 id={titleId} ref={titleRef} tabIndex={-1} className="hint-panel__title">Pistas graduais <AiTag /></h3>
      {state.kind === 'paused' ? (
        <p className="ai-note">As pistas deste passo ficam pausadas enquanto você reconstrói sem consultar.</p>
      ) : (
        <>
          <p className="ai-note">
            Uma de cada vez: a 1 é uma pergunta, a 2 aponta a direção e a 3 sugere o próximo passo. Nenhuma entrega a solução.
          </p>
          {state.hints.length > 0 && (
            <ol className="hint-panel__list">
              {state.hints.map((h) => (
                <li key={h.id}>
                  <span className="hint-panel__label">{label(h.hint!.level)}</span>
                  <Rich text={h.text} />
                </li>
              ))}
            </ol>
          )}
          {unsaved && (
            <div className="hint-panel__unsaved">
              <span className="hint-panel__label">{label(unsaved.level)}</span>
              <Rich text={unsaved.text} />
              <p className="ai-note">O Feedback desta sessão está cheio (20 entradas); esta pista não foi guardada.</p>
            </div>
          )}
          <p role="status" className="ai-note">{busy ? `Pedindo a pista ${busy}…` : ''}</p>
          {state.next ? (
            <>
              <div>
                <Button ref={buttonRef} onClick={() => ask(state.next!)} disabled={busy !== undefined}>
                  {busy ? 'Pensando…' : `Pedir ${label(state.next).toLowerCase()}`}
                </Button>
              </div>
              <AiSent text={hintPreview(hintRequestOf(session, step, state.next))} note="Erros e feedback não vão." />
            </>
          ) : (
            <p className="ai-note">
              As três pistas deste passo já vieram. Tente com elas, registre um erro ou peça feedback a alguém.
            </p>
          )}
          {error && <p role="alert" className="ai-error">{error}</p>}
        </>
      )}
    </section>
  );
}
