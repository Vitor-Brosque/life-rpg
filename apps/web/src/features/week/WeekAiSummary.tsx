import { useEffect, useId, useRef, useState } from 'react';
import type { DayKey, WeekFact, WeekReading, WeekRequest } from '@life/shared';
import { AI_LIMITS, hasReading, weekPrompt } from '@life/shared';
import { AI_ERROR_COPY, askWeek } from '../../ai/aiClient';
import { AiSent, AiTag } from '../../ai/AiSent';
import { useAiFeature } from '../../ai/aiStatus';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { readWeekSummary, writeWeekSummary, type StoredWeekSummary } from './weekCycle';

export interface WeekAiSummaryProps {
  /** Monday of the current week: where the summary is kept. */
  weekId: DayKey;
  /** Monday of the week the numbers describe (last week). */
  statsWeek: DayKey;
  /** The observed rows the card shows. */
  facts: WeekFact[];
  /** The user's answers, sent only when the box is ticked. */
  reading: WeekReading;
}

/** "Resumo da semana" (spec §6.5): after the user's own reading, never instead of it. */
export function WeekAiSummary({ weekId, statsWeek, facts, reading }: WeekAiSummaryProps) {
  const enabled = useAiFeature('weekly');
  const [stored, setStored] = useState<StoredWeekSummary | undefined>(() => readWeekSummary(weekId));
  const [include, setInclude] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const titleId = useId();
  const mainBtn = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  // The button the user tapped is replaced or disabled: focus goes to the main action, never <body>.
  useEffect(() => {
    if (refocus.current && !busy) { refocus.current = false; mainBtn.current?.focus(); }
  });
  if (!enabled) return null;

  const canInclude = hasReading(reading);
  const request: WeekRequest = {
    weekStart: statsWeek,
    facts: facts.slice(0, AI_LIMITS.weekFacts),
    ...(include && canInclude ? { reading } : {}),
  };

  const ask = async (): Promise<void> => {
    refocus.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const r = await askWeek(request);
      if (!r.ok) { setError(AI_ERROR_COPY[r.error]); return; }
      const value = { summary: r.data, at: Date.now() };
      writeWeekSummary(weekId, value);
      setStored(value);
    } finally {
      setBusy(false);
    }
  };
  const erase = (): void => {
    refocus.current = true;
    writeWeekSummary(weekId, undefined);
    setStored(undefined);
  };
  const s = stored?.summary;

  return (
    <section className="week-card__section week-ai" aria-labelledby={titleId}>
      <h3 id={titleId} className="week-card__subtitle">Resumo da semana<AiTag /></h3>
      <p className="week-card__note">
        A IA relê os números acima em poucas frases. A sua leitura vem primeiro: o resumo não a substitui.
      </p>
      <label className="week-ai__include">
        <input type="checkbox" className="px-checkbox" checked={include && canInclude} disabled={!canInclude}
          onChange={(e) => setInclude(e.target.checked)} />
        <span>Incluir minhas respostas acima</span>
      </label>
      <AiSent text={weekPrompt(request)} />
      {s ? (
        <>
          <dl className="week-ai__summary">
            <div><dt>Observado</dt><dd>{s.observed}</dd></div>
            {s.hypothesis && <div><dt>Hipótese</dt><dd>{s.hypothesis}</dd></div>}
            {s.suggestion && <div><dt>Sugestão</dt><dd>{s.suggestion}</dd></div>}
          </dl>
          <p className="ai-note">Gerado por IA a partir dos números. Pode errar; discorde à vontade.</p>
          <div className="week-card__actions">
            <Button ref={mainBtn} size="sm" variant="ghost" disabled={busy} onClick={() => safeRun(ask)}>
              {busy ? 'Resumindo…' : 'Resumir de novo'}
            </Button>
            <Button size="sm" variant="ghost" onClick={erase}>Apagar resumo</Button>
          </div>
        </>
      ) : (
        <div>
          <Button ref={mainBtn} size="sm" disabled={busy} onClick={() => safeRun(ask)}>{busy ? 'Resumindo…' : 'Resumir a semana'}</Button>
        </div>
      )}
      {error && <p role="alert" className="ai-error">{error}</p>}
    </section>
  );
}
