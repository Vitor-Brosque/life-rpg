import { useId } from 'react';
import type { Area, Mission, Suggestion } from '@life/shared';
import { formatDuration } from '../../ui/format';

export interface AlternativesProps {
  items: Suggestion[];
  areas: Area[];
  onPick(m: Mission): void;
  title?: string;
  /** Screen-reader prefix of each row (what tapping does). */
  pickLabel?: string;
}

/** Up to 3 compact rows; tapping one brings it to the main card. Renders nothing when empty. */
export function Alternatives({
  items, areas, onPick, title = 'Também cabe agora', pickLabel = 'Trocar para: ',
}: AlternativesProps) {
  const headingId = useId();
  if (items.length === 0) return null;
  return (
    <section className="alternatives" aria-labelledby={headingId}>
      <h2 id={headingId} className="section-title">{title}</h2>
      <ul className="alternatives__list">
        {items.slice(0, 3).map((s) => {
          const m = s.mission;
          const area = m.areaId ? areas.find((a) => a.id === m.areaId) : undefined;
          return (
            <li key={m.id}>
              <button type="button" className="row-card alt-row" onClick={() => onPick(m)}>
                <span className="row-card__stripe" style={area ? { background: area.color } : undefined} aria-hidden="true" />
                <span className="row-card__body">
                  <span className="visually-hidden">{pickLabel}</span>
                  <span className="row-card__title">{m.title}</span>
                  {s.reasons[0] && <span className="row-card__sub">{s.reasons[0].text}</span>}
                </span>
                {m.durationMin !== undefined && <span className="tag tag--stone">{formatDuration(m.durationMin)}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
