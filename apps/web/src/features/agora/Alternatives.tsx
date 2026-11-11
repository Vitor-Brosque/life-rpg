import { useId } from 'react';
import type { Area, Mission, Suggestion } from '@life/shared';
import { formatDuration } from '../../ui/format';

export interface AlternativesProps {
  items: Suggestion[];
  areas: Area[];
  onPick(m: Mission): void;
  title?: string;
}

/** Up to 3 compact rows; tapping one brings it to the main card. Renders nothing when empty. */
export function Alternatives({ items, areas, onPick, title = 'Também cabe agora' }: AlternativesProps) {
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
                  <span className="visually-hidden">Trocar para: </span>
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
