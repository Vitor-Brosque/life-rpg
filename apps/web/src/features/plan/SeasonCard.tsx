import { useId, useRef, useState } from 'react';
import type { DayKey } from '@life/shared';
import { seasonFocusTexts } from '@life/shared';
import { useGoals } from '../../db/goalData';
import { useSeasonNow } from '../../db/seasonData';
import { useStrategies } from '../../db/strategyData';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import { SeasonReviewSheet } from './SeasonReviewSheet';
import { SeasonSheet } from './SeasonSheet';
import './plan.css';

const heading = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-season-heading]');
const startButton = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-season-new]');

/**
 * Top of Planejar → Semana: "Nova temporada" without an active season; with one, its week ("semana N de M", atypical
 * weeks out), the focus lines and, from its last planned week on, "Rever temporada". Nothing here writes by being shown.
 */
export function SeasonCard({ today }: { today: DayKey }) {
  const now = useSeasonNow(today);
  const goals = useGoals();
  const strategies = useStrategies();
  const [sheet, setSheet] = useState<'new' | 'edit' | 'review'>();
  const newRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  if (now === undefined) return null;
  const season = now?.season;
  const focus = season ? seasonFocusTexts(season, { goals: goals ?? [], strategies: strategies ?? [] }) : [];
  const closeSheet = () => {
    // Started: "Nova temporada" goes away and focus moves to the new card's title (never <body>).
    focusWhenGone(newRef.current, heading);
    setSheet(undefined);
  };

  return (
    <>
      {now === null ? (
        <div key="none" className="season-none">
          <Button ref={newRef} size="sm" data-season-new onClick={() => setSheet('new')}>Nova temporada</Button>
          <span className="season-none__hint">6 a 8 semanas com um ou dois focos. Opcional.</span>
        </div>
      ) : (
        <div key="card" ref={cardRef}>
          <Panel variant="stone" role="region" aria-labelledby={headingId} className="season-card">
            <h2 id={headingId} className="season-card__title" tabIndex={-1} data-season-heading>{now.line}</h2>
            {now.skippedNote && <p className="season-card__note">{now.skippedNote}</p>}
            {focus.length > 0 && (
              <ul className="season-card__focus" aria-label="Focos da temporada">
                {focus.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            )}
            {now.week.reviewDue && <p className="season-card__note">As semanas planejadas chegaram ao fim. Rever é opcional, quando quiser.</p>}
            <div className="cluster">
              {now.week.reviewDue && <Button size="sm" variant="primary" onClick={() => setSheet('review')}>Rever temporada</Button>}
              <Button size="sm" variant="ghost" onClick={() => setSheet('edit')}>Editar temporada</Button>
            </div>
          </Panel>
        </div>
      )}
      <SeasonSheet target={sheet === 'new' ? { kind: 'new' } : sheet === 'edit' && season ? { kind: 'edit', season } : undefined}
        today={today} onClose={closeSheet} onEnd={() => setSheet('review')} />
      <SeasonReviewSheet season={sheet === 'review' ? season : undefined} today={today} onClose={() => setSheet(undefined)}
        onEnded={() => focusWhenGone(cardRef.current, startButton)} />
    </>
  );
}
