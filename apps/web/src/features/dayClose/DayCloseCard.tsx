import { useId } from 'react';
import type { DayKey, DayMode } from '@life/shared';
import { observationDayText, observationOf, observationState } from '@life/shared';
import { useSettings } from '../../db/hooks';
import { dismissDayClose } from '../../domain/dayCloseActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import { safeRun } from '../../ui/safeRun';
import { useDayCloseDue, useDayCloseSheet } from './useDayClose';
import './dayClose.css';

/**
 * The evening card (after the day's last commitment, from 20:00): optional, never blocking, and it writes
 * nothing by being shown. Only "Agora não" does (hidden for the rest of the day, on every device).
 */
export function DayCloseCard({ today, mode, now }: { today: DayKey; mode: DayMode; now: number }) {
  const due = useDayCloseDue(today, mode, now);
  const headingId = useId();
  const settings = useSettings();
  if (!due) return null;
  const obs = observationState(observationOf(settings), today);
  return (
    <Panel variant="stone" role="region" aria-labelledby={headingId} className="day-close-card">
      <h2 id={headingId} className="day-close-card__title">Como foi hoje?</h2>
      <p className="day-close-card__text">Dois minutos para fechar o dia. Tudo é opcional.</p>
      {obs.kind === 'active' && <p className="day-close-card__observation">{observationDayText(obs.day)}</p>}
      <div className="day-close-card__actions">
        <Button variant="primary" onClick={() => useDayCloseSheet.getState().open()}>Abrir</Button>
        <Button variant="ghost" onClick={(e) => {
          focusWhenGone(e.currentTarget);
          safeRun(dismissDayClose(today));
        }}>
          Agora não
        </Button>
      </div>
    </Panel>
  );
}

/** "Como foi hoje" at any time of the day (after the list of missions). */
export function DayCloseLink() {
  return (
    <div className="day-close-link">
      <Button size="sm" variant="ghost" onClick={() => useDayCloseSheet.getState().open()}>Como foi hoje</Button>
    </div>
  );
}
