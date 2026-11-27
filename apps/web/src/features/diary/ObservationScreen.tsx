import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import type { DayKey } from '@life/shared';
import { OBSERVATION_COUNT_NOTE, OBSERVATION_NOTE, observationOf, observationState, observationSummary } from '@life/shared';
import { useSettings, useToday } from '../../db/hooks';
import { useReportData } from '../../db/reportData';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { plural } from '../../ui/format';
import './diary.css';

const ddmm = (day: DayKey): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** `/diario/observacao`: the summary of the last observation, as counts of days. Reading only. */
export function ObservationScreen() {
  const settings = useSettings();
  const today = useToday();
  const [attempt, setAttempt] = useState(0);
  const state = settings && today ? observationState(observationOf(settings), today) : undefined;
  const start = state?.kind === 'ended' ? state.start : undefined;
  const end = state?.kind === 'ended' ? state.end : undefined;
  const range = useMemo(() => (start && end ? { start, end } : undefined), [start, end]);
  const { data, failed } = useReportData(range, today, attempt);
  const summary = useMemo(() => (data && range ? observationSummary(data, range) : undefined), [data, range]);

  let body;
  if (!state) body = <div aria-busy="true" />;
  else if (state.kind === 'none') body = <p className="muted">Nenhuma observação ainda. Comece pelo Diário.</p>;
  else if (state.kind === 'active') {
    body = <p className="muted">{`A observação ainda está em andamento: dia ${state.day} de 14. O resumo aparece no fim.`}</p>;
  } else if (failed) {
    body = (
      <>
        <p>Não foi possível ler os registros.</p>
        <div className="cluster"><Button size="sm" onClick={() => {
          document.getElementById('observation-title')?.focus();
          setAttempt((n) => n + 1);
        }}>Tentar de novo</Button></div>
      </>
    );
  } else if (!summary) body = <div aria-busy="true" />;
  else {
    body = (
      <>
        <p>{`De ${ddmm(summary.start)} a ${ddmm(summary.end)}/${summary.end.slice(0, 4)} (${plural(summary.days, 'dia', 'dias')}).`}</p>
        <p className="muted">{OBSERVATION_COUNT_NOTE}</p>
        <dl className="observation__lines">
          {summary.lines.map((l) => (
            <div key={l.label} className="observation__line">
              <dt>{l.label}</dt>
              <dd>{l.text}</dd>
            </div>
          ))}
        </dl>
        <p className="muted">{OBSERVATION_NOTE}</p>
      </>
    );
  }
  return (
    <section className="screen diary stack" aria-labelledby="observation-title">
      <Link href="/diario" className="settings__back">‹ Diário</Link>
      <h1 id="observation-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Resumo da observação</h1>
      {body}
    </section>
  );
}
