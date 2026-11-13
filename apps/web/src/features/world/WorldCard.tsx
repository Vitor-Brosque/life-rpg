import { Link } from 'wouter';
import type { ID, StageIndex } from '@life/shared';
import { outfitUnlockLevel, stageSummary } from '@life/shared';
import { Icon } from '../../art/icons';
import { useAreas } from '../../db/hooks';
import { useWorldNews } from './WorldWatcher';
import { newsLine } from './worldText';
import './world.css';

/** Personagem → "Mapa do mundo": the stage summary and the newest news of the last 3 days. */
export function WorldCard({ territories, totalLevel }: {
  territories: ReadonlyArray<{ areaId: ID; stage: StageIndex }>;
  totalLevel: number;
}) {
  const news = useWorldNews();
  const areas = useAreas();
  const stageOf = new Map(territories.map((t) => [t.areaId, t.stage]));
  // News older than an undo (the stage or colour is no longer reached) is not shown.
  const line = news
    .filter((n) => (n.kind === 'stage'
      ? (stageOf.get(n.areaId) ?? -1) >= n.stage
      : totalLevel >= (outfitUnlockLevel(n.outfit) ?? 0)))
    .map((n) => newsLine(n, areas)).find((l) => l !== undefined);
  return (
    <Link href="/mapa" className="world-card px-border">
      <span className="world-card__icon" aria-hidden="true"><Icon name="map" size={36} /></span>
      <span className="world-card__text">
        <span className="world-card__title">Mapa do mundo</span>
        <span className="world-card__summary">{stageSummary(territories.map((t) => t.stage))}</span>
        {line && <span className="world-card__news">{`Novidade: ${line}`}</span>}
      </span>
    </Link>
  );
}
