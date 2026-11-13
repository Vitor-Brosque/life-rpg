import { Link } from 'wouter';
import type { StageIndex } from '@life/shared';
import { stageSummary } from '@life/shared';
import { Icon } from '../../art/icons';
import { useAreas } from '../../db/hooks';
import { useWorldNews } from './WorldWatcher';
import { newsLine } from './worldText';
import './world.css';

/** Personagem → "Mapa do mundo": the stage summary and the newest news of the last 3 days. */
export function WorldCard({ stages }: { stages: StageIndex[] }) {
  const news = useWorldNews();
  const areas = useAreas();
  const line = news.map((n) => newsLine(n, areas)).find((l) => l !== undefined);
  return (
    <Link href="/mapa" className="world-card px-border">
      <span className="world-card__icon" aria-hidden="true"><Icon name="map" size={36} /></span>
      <span className="world-card__text">
        <span className="world-card__title">Mapa do mundo</span>
        <span className="world-card__summary">{stageSummary(stages)}</span>
        {line && <span className="world-card__news">{`Novidade: ${line}`}</span>}
      </span>
    </Link>
  );
}
