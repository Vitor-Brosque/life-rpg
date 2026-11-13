import { useRef, useState } from 'react';
import type { FeedbackSource } from '@life/shared';
import { PRACTICE_LIMITS } from '@life/shared';
import { useNow } from '../../db/hooks';
import { addPracticeFeedback, removePracticeFeedback } from '../../domain/practiceActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { relativeTime } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import type { StepProps } from './PracticeSteps';
import { SOURCE_LABEL } from './practiceData';

const SOURCES: FeedbackSource[] = ['person', 'ai', 'tool'];

/** "Feedback" (spec §5.2, step 7): what a person, an AI or a tool said. Marco 7 may add 'ai' entries here. */
export function FeedbackStep({ session }: StepProps) {
  const now = useNow();
  const [source, setSource] = useState<FeedbackSource>('person');
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const add = (): void => {
    const t = text.trim();
    if (!t) return;
    setText('');
    // The button turns disabled (not removed) once the text is cleared: focus goes back to the field.
    safeRun(addPracticeFeedback(session.id, { source, text: t })
      .then(() => { field.current?.focus(); })
      .catch((e: unknown) => { setText(t); throw e; }));
  };
  return (
    <>
      <p className="practice__hint">Peça feedback a uma pessoa, a uma IA ou a uma ferramenta (testes, linter) e anote o essencial.</p>
      <fieldset className="attr">
        <legend className="field__label">De quem?</legend>
        <div className="cluster">
          {SOURCES.map((s) => <Chip key={s} selected={source === s} onClick={() => setSource(s)}>{SOURCE_LABEL[s]}</Chip>)}
        </div>
      </fieldset>
      <label className="field practice-field">
        <span className="field__label">O que disseram?</span>
        <textarea ref={field} rows={3} value={text} maxLength={PRACTICE_LIMITS.feedbackText} onChange={(e) => setText(e.target.value)} />
      </label>
      <Button variant="primary" disabled={!text.trim()} onClick={add}>Adicionar feedback</Button>
      {session.feedback.length > 0 && (
        <ul className="practice-entries">
          {session.feedback.map((f) => (
            <li key={f.id} className="practice-entry">
              <p className="practice-entry__meta">{SOURCE_LABEL[f.source]} · {relativeTime(f.at, now)}</p>
              <p className="practice-entry__text">{f.text}</p>
              <Button size="sm" variant="ghost" aria-label={`Remover feedback: ${f.text.slice(0, 40)}`}
                onClick={() => safeRun(removePracticeFeedback(session.id, f.id))}>
                Remover feedback
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
