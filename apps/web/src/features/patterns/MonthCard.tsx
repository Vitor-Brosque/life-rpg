import { useId, useMemo, type MouseEvent } from 'react';
import { monthName, monthObserved } from '@life/shared';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import type { MonthCycle } from './monthCycle';
import { MonthReflectionForm } from './MonthReflectionForm';
import { usePatternData } from './patternData';
import './patterns.css';

/**
 * "Reflexão de outubro" in the morning queue (spec §5.7): one line, then the form after "Começar".
 * The heavy pattern data is read only once the form is open.
 */
export function MonthCard({ cycle }: { cycle: MonthCycle }) {
  const month = cycle.month!;
  const data = usePatternData(cycle.started);
  const observed = useMemo(() => (data ? monthObserved(data, month) : undefined), [data, month]);
  const headingId = useId();
  const later = (e: MouseEvent<HTMLButtonElement>) => {
    focusWhenGone(e.currentTarget);
    cycle.later();
  };
  return (
    <Panel variant="stone" role="region" aria-labelledby={headingId} className="month-card px-border--gold">
      <div className="month-card__head">
        <h2 id={headingId} className="month-card__title">{`Reflexão de ${monthName(month)}`}</h2>
        {!cycle.started && (
          <>
            <span className="month-card__time">· ~3 min</span>
            <Button size="sm" variant="primary" onClick={cycle.start}>Começar</Button>
            <Button size="sm" variant="ghost" onClick={later}>Agora não</Button>
          </>
        )}
      </div>
      {cycle.started && (
        <MonthReflectionForm month={month} observed={observed} variant="card" onDone={() => undefined} onLater={cycle.later} />
      )}
    </Panel>
  );
}
