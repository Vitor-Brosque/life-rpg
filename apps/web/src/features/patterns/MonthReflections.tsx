import { useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { MonthAnswers, MonthKey, MonthObserved, MonthReview, PatternData } from '@life/shared';
import { addMonths, monthKeyOf, monthName, monthObserved, monthReviewId } from '@life/shared';
import { db } from '../../db/db';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import { Sheet } from '../../ui/Sheet';
import { MONTH_QUESTIONS } from './monthCycle';
import { MonthReflectionForm } from './MonthReflectionForm';
import { monthObservedRows, monthTitle } from './patternText';
import './patterns.css';

const MAX_SHOWN = 12;
const EMPTY = 'No começo de cada mês, o Agora oferece uma reflexão curta e opcional. Ela fica guardada aqui.';

interface SheetState { month: MonthKey; observed: MonthObserved; initial?: MonthAnswers }

function ReviewArticle({ review, onOpen }: { review: MonthReview; onOpen(s: SheetState, e: MouseEvent<HTMLButtonElement>): void }) {
  const titleId = useId();
  const month = review.month;
  const name = monthName(month);
  return (
    <article className="month-entry" aria-labelledby={titleId}>
      <h3 id={titleId} className="month-entry__title">{monthTitle(month)}</h3>
      {review.answers ? (
        <>
          <dl className="month-entry__answers">
            {MONTH_QUESTIONS.map((q) => (
              <div key={q.key}>
                <dt>{q.short}</dt>
                <dd>{review.answers![q.key] || '—'}</dd>
              </div>
            ))}
          </dl>
          <details className="patterns__details">
            <summary>Números do mês</summary>
            <dl className="week-stats">
              {monthObservedRows(review.observed).map((r) => (
                <div key={r.label} className="week-stat">
                  <dt className="week-stat__label">{r.label}</dt>
                  <dd className="week-stat__value">{r.value}</dd>
                </div>
              ))}
            </dl>
          </details>
          <Button size="sm" variant="secondary" aria-label={`Editar a reflexão de ${name}`}
            onClick={(e) => onOpen({ month, observed: review.observed, initial: review.answers }, e)}>Editar</Button>
        </>
      ) : (
        <>
          <p className="muted">Pulada.</p>
          <Button size="sm" variant="secondary" aria-label={`Responder a reflexão de ${name}`}
            onClick={(e) => onOpen({ month, observed: review.observed }, e)}>Responder</Button>
        </>
      )}
    </article>
  );
}

/** "Reflexões do mês" in Padrões: the saved ones, newest first, and last month if it is still open. */
export function MonthReflections({ data }: { data: PatternData }) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [sheet, setSheet] = useState<SheetState>();
  const opener = useRef<HTMLElement | null>(null);
  const reviews = useLiveQuery(async () => {
    const all = await db.monthReviews.toArray();
    return all.filter((r) => !r.deleted).sort((a, b) => b.month.localeCompare(a.month)).slice(0, MAX_SHOWN);
  }, []);
  const prev = addMonths(monthKeyOf(data.today), -1);
  const prevActive = useMemo(() => data.xpEvents.some((x) => !x.deleted && monthKeyOf(x.dayKey) === prev), [data, prev]);
  const prevSaved = useLiveQuery(async () => {
    const r = await db.monthReviews.get(monthReviewId(prev));
    return !!r && !r.deleted;
  }, [prev]);
  if (!reviews || prevSaved === undefined) return null;

  const pending = prevActive && !prevSaved;
  const open = (s: SheetState, e: MouseEvent<HTMLButtonElement>) => {
    opener.current = e.currentTarget;
    setSheet(s);
  };
  /** The opener may be gone once the reflection exists ("Responder agora"): focus then goes to the section heading. */
  const close = () => {
    if (opener.current) focusWhenGone(opener.current, () => headingRef.current);
    setSheet(undefined);
  };

  return (
    <section className="month-reflections stack" role="region" aria-labelledby={headingId}>
      <h2 id={headingId} ref={headingRef} tabIndex={-1}>Reflexões do mês</h2>
      {pending && (
        <Panel variant="stone" className="month-entry">
          <p>{`A reflexão de ${monthName(prev)} ainda está aberta.`}</p>
          <Button size="sm" variant="primary" onClick={(e) => open({ month: prev, observed: monthObserved(data, prev) }, e)}>
            Responder agora
          </Button>
        </Panel>
      )}
      {reviews.map((r) => <ReviewArticle key={r.id} review={r} onOpen={open} />)}
      {reviews.length === 0 && !pending && <p className="muted">{EMPTY}</p>}
      <Sheet open={!!sheet} onClose={close} title={sheet ? `Reflexão de ${monthName(sheet.month)}` : ''}>
        {sheet && (
          <MonthReflectionForm key={sheet.month} month={sheet.month} observed={sheet.observed} initial={sheet.initial}
            variant="sheet" onDone={close} />
        )}
      </Sheet>
    </section>
  );
}
