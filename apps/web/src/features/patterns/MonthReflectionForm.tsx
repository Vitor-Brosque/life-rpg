import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import type { MonthAnswers, MonthKey, MonthObserved } from '@life/shared';
import { monthName } from '@life/shared';
import { saveMonthReview, skipMonthReview } from '../../domain/patternActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import '../week/week.css';
import { EMPTY_ANSWERS, MONTH_QUESTIONS, readMonthDraft, writeMonthDraft } from './monthCycle';
import { monthObservedRows } from './patternText';
import './patterns.css';

export interface MonthReflectionFormProps {
  month: MonthKey;
  /** The numbers to show and copy; undefined while loading. */
  observed?: MonthObserved;
  /** Editing a saved reflection. */
  initial?: MonthAnswers;
  variant: 'card' | 'sheet';
  /** After saving or skipping (the sheet closes; the card goes away by itself). */
  onDone(): void;
  /** Card: "Fazer depois". */
  onLater?(): void;
}

/** The three optional questions of the month, next to the numbers they refer to (spec §5.7). */
export function MonthReflectionForm({ month, observed, initial, variant, onDone, onLater }: MonthReflectionFormProps) {
  const [answers, setAnswers] = useState<MonthAnswers>(() => initial ?? readMonthDraft(month) ?? EMPTY_ANSWERS);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fieldId = useId();
  const name = monthName(month);
  useEffect(() => { if (variant === 'card') headingRef.current?.focus(); }, [variant]);

  const change = (key: keyof MonthAnswers, value: string) => setAnswers((a) => {
    const next = { ...a, [key]: value };
    writeMonthDraft(month, next);
    return next;
  });
  /** The card disappears once the record exists: focus goes to the screen heading, never to <body>. */
  const finish = (e: MouseEvent<HTMLButtonElement>, task: Promise<void>, toast: string) => {
    if (variant === 'card') focusWhenGone(e.currentTarget);
    setBusy(true);
    safeRun(task.then(() => {
      writeMonthDraft(month, undefined);
      useToast.getState().show(toast);
      onDone();
    }).finally(() => setBusy(false)));
  };
  const save = (e: MouseEvent<HTMLButtonElement>) => {
    if (observed) finish(e, saveMonthReview(month, answers, observed), `Reflexão de ${name} salva.`);
  };
  const skip = (e: MouseEvent<HTMLButtonElement>) => {
    if (observed) finish(e, skipMonthReview(month, observed), 'Tudo bem. Dá para responder depois em Personagem → Padrões.');
  };
  const later = (e: MouseEvent<HTMLButtonElement>) => {
    focusWhenGone(e.currentTarget);
    onLater?.();
  };

  return (
    <div className="month-form">
      <section className="week-card__section" aria-labelledby={`${fieldId}-obs`}>
        <h3 id={`${fieldId}-obs`} className="week-card__subtitle" ref={headingRef} tabIndex={-1}>{`Observado em ${name}`}</h3>
        <p className="week-card__note">Números do mês, sem julgamento.</p>
        {observed && (
          <dl className="week-stats">
            {monthObservedRows(observed).map((r) => (
              <div key={r.label} className="week-stat">
                <dt className="week-stat__label">{r.label}</dt>
                <dd className="week-stat__value">{r.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section className="week-card__section" aria-labelledby={`${fieldId}-read`}>
        <h3 id={`${fieldId}-read`} className="week-card__subtitle">Sua leitura</h3>
        <p className="week-card__note">Tudo opcional, com suas palavras.</p>
        {MONTH_QUESTIONS.map((q) => (
          <label key={q.key} className="field" htmlFor={`${fieldId}-${q.key}`}>
            <span className="field__label week-card__question">{q.label}</span>
            <textarea id={`${fieldId}-${q.key}`} rows={2} value={answers[q.key]} onChange={(e) => change(q.key, e.target.value)} />
          </label>
        ))}
      </section>
      <div className="month-form__actions">
        <Button variant="primary" disabled={busy || !observed} onClick={save}>Salvar reflexão</Button>
        {variant === 'card' ? (
          <>
            <Button variant="ghost" onClick={later}>Fazer depois</Button>
            <Button variant="ghost" disabled={busy || !observed} onClick={skip}>Pular este mês</Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onDone}>Cancelar</Button>
        )}
      </div>
    </div>
  );
}
