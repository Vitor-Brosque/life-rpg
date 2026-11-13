import { memo, useId, useMemo } from 'react';
import type { Cell, CharacterLook, WorldModel } from '@life/shared';
import { TILE, artTop, labelOnTop } from '@life/shared';
import { SpriteRects } from '../../art/PixelSprite';
import { SPRITES, avatarSprite } from '../../art/sprites';
import {
  GRASS, GRASS_DARK, GRASS_LIGHT, HUB_SPRITE, MARKER_DONE, MARKER_OPEN, ROAD_DIRT, ROAD_STONE, SPARKLE_SPRITE,
  TALK_SPRITE, decoSprite, npcSprite, territorySprite,
} from '../../art/worldSprites';
import type { TerritoryView } from './useWorld';
import { hubLabel, territoryLabel } from './worldText';

export interface WorldMapProps {
  model: WorldModel;
  territories: TerritoryView[];
  look: CharacterLook;
  companionName: string;
  onOpen(areaId: string): void;
}

/** Top-left of a tile's art (world px): top-row tiles are pushed down by their label. */
const origin = (cell: Cell): { x: number; y: number } => ({ x: cell.c * TILE, y: cell.r * TILE + artTop(cell) });

interface ArtProps { model: WorldModel; territories: TerritoryView[]; look: CharacterLook; patternId: string }

/** The decorative map: one SVG, every sprite through SpriteRects (merged runs, crisp pixels). */
const MapArt = memo(function MapArt({ model, territories, look, patternId }: ArtProps) {
  const w = model.cols * TILE;
  const h = model.rows * TILE;
  const { skin, hair, hairColor, outfit } = look;
  const avatar = useMemo(() => avatarSprite({ skin, hair, hairColor, outfit }), [skin, hair, hairColor, outfit]);
  const hub = origin(model.hub.cell);
  const me = origin(model.avatar.cell);
  return (
    <svg className="world-map__art" viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse">
          <rect x="1" y="2" width="1" height="1" fill={GRASS_LIGHT} />
          <rect x="5" y="6" width="1" height="1" fill={GRASS_DARK} />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={GRASS} />
      <rect width={w} height={h} fill={`url(#${patternId})`} />
      {model.roads.map((r) => (
        <g key={r.areaId} fill={r.journeyId ? ROAD_STONE : ROAD_DIRT}>
          {r.dots.map(([x, y]) => <rect key={`${x},${y}`} x={x - 1} y={y - 1} width={3} height={3} />)}
        </g>
      ))}
      {model.roads.flatMap((r) => r.markers.map((m, i) => (
        <rect key={`${r.areaId}-${i}`} x={m.x} y={m.y} width={3} height={3} fill={m.done ? MARKER_DONE : MARKER_OPEN} />
      )))}
      {model.empty.map((e) => {
        const o = origin(e.cell);
        return <SpriteRects key={`${e.cell.c},${e.cell.r}`} sprite={decoSprite(e.deco)} x={o.x + 12} y={o.y + 6} />;
      })}
      <SpriteRects sprite={HUB_SPRITE} x={hub.x + 12} y={hub.y + 6} />
      <SpriteRects sprite={SPRITES.companion[0]} x={hub.x + 32} y={hub.y + 22} />
      {territories.map(({ t, talk, grew }) => {
        const o = origin(t.cell);
        return (
          <g key={t.area.id}>
            <SpriteRects sprite={territorySprite(t.stage, t.area.color)} x={o.x + 12} y={o.y + 6} />
            <SpriteRects sprite={npcSprite(t.npc.kind, t.area.color)} x={o.x + 34} y={o.y + 22} />
            {talk && <SpriteRects sprite={TALK_SPRITE} x={o.x + 36} y={o.y + 15} />}
            {grew && <SpriteRects sprite={SPARKLE_SPRITE} x={o.x + 35} y={o.y + 2} />}
          </g>
        );
      })}
      <SpriteRects sprite={avatar} x={me.x} y={me.y + 22} />
    </svg>
  );
});

/**
 * "Mapa": the art plus one transparent button per territory on top (touch target, accessible
 * name, visible label). The hub is an image with a text alternative, not a control.
 */
export function WorldMap({ model, territories, look, companionName, onOpen }: WorldMapProps) {
  const patternId = `world-grass-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const pos = (cell: Cell) => ({
    left: `${(cell.c / model.cols) * 100}%`,
    top: `${(cell.r / model.rows) * 100}%`,
    width: `${100 / model.cols}%`,
    height: `${100 / model.rows}%`,
  });
  return (
    <div className="world-map px-border" style={{ aspectRatio: `${model.cols * TILE} / ${model.rows * TILE}` }}>
      <MapArt model={model} territories={territories} look={look} patternId={patternId} />
      <div className="world-map__hub" style={pos(model.hub.cell)} role="img"
        aria-label={hubLabel(companionName, model.avatar.areaId === undefined)}>
        <span className="world-map__label" aria-hidden="true"><span className="world-map__name">Encruzilhada</span></span>
      </div>
      {territories.map((v) => (
        <button
          key={v.t.area.id}
          type="button"
          className={labelOnTop(v.t.cell) ? 'world-map__tile world-map__tile--top' : 'world-map__tile'}
          style={pos(v.t.cell)}
          aria-label={territoryLabel(v.t, { avatarHere: model.avatar.areaId === v.t.area.id, talk: v.talk, grew: v.grew })}
          onClick={() => onOpen(v.t.area.id)}
        >
          <span className="world-map__label" aria-hidden="true">
            <span className="world-map__name">{v.t.area.attribute}</span>
            <span className="world-map__lvl">{v.t.level.level}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
