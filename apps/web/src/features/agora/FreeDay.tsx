import { useState } from 'react';
import type { Area, DayKey, DayMode, Mission } from '@life/shared';
import { Companion, SpeechBubble } from '../../art/Companion';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { formatDuration } from '../../ui/format';
import { Panel } from '../../ui/Panel';
import { useCompanion } from '../companion/store';
import { DAY_MODE_LABEL } from './DayTypeCard';
import './blocks.css';

/** Open missions that are light or short (≤ 15 min) and available today — never suggested, only listed. */
export function lightMissions(missions: Mission[], today: DayKey, now: number): Mission[] {
  return missions.filter((m) => !m.deleted && (m.status === 'open' || m.status === 'doing')
    && (m.date === undefined || m.date <= today)
    && (m.notBefore === undefined || m.notBefore <= today)
    && (m.snoozedUntil === undefined || m.snoozedUntil <= now)
    && (m.energy === 'light' || (m.durationMin ?? Infinity) <= 15));
}

export interface FreeDayProps {
  /** `lightMissions(...)`. */
  light: Mission[];
  areas: Area[];
  onOpen(m: Mission): void;
  /** "Quero fazer algo mesmo assim": Normal or Baixa energia. */
  onPickMode(mode: DayMode): void;
}

/** Free day (§6): the companion and rest. No automatic work suggestion. */
export function FreeDay({ light, areas, onOpen, onPickMode }: FreeDayProps) {
  const message = useCompanion((s) => s.message);
  const [wantsSomething, setWantsSomething] = useState(false);
  return (
    <section className="free-day" aria-label="Dia livre">
      <Panel className="main-card main-card--empty free-day__card">
        <Companion scale={4} speaking={!!message} />
        <SpeechBubble message={message} className="main-card__speech--empty" />
        <p className="free-day__title">Dia livre. Descanso também conta.</p>
        <p className="free-day__text">Nenhuma missão precisa de você hoje.</p>
        {wantsSomething ? (
          <div className="free-day__modes" role="group" aria-label="Como você quer o dia?">
            {/* Plain actions (not toggles): picking one turns the day into a workday. */}
            {(['normal', 'low'] as const).map((m) => (
              <Button key={m} size="sm" onClick={(e) => { focusWhenGone(e.currentTarget); onPickMode(m); }}>
                {DAY_MODE_LABEL[m]}
              </Button>
            ))}
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setWantsSomething(true)}>Quero fazer algo mesmo assim</Button>
        )}
      </Panel>

      {light.length > 0 && (
        <details className="today__fold free-day__light">
          <summary>{`Ver missões leves (${light.length})`}</summary>
          <ul className="today__list">
            {light.map((m) => {
              const area = m.areaId ? areas.find((a) => a.id === m.areaId) : undefined;
              return (
                <li key={m.id}>
                  <button type="button" className="row-card alt-row" onClick={() => onOpen(m)}>
                    <span className="row-card__stripe" style={area ? { background: area.color } : undefined} aria-hidden="true" />
                    <span className="row-card__body"><span className="row-card__title">{m.title}</span></span>
                    {m.durationMin !== undefined && <span className="tag tag--stone">{formatDuration(m.durationMin)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
