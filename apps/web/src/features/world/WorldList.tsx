import { STAGES } from '@life/shared';
import { PixelSprite } from '../../art/PixelSprite';
import { territorySprite } from '../../art/worldSprites';
import { Button } from '../../ui/Button';
import type { WorldView } from './useWorld';
import { hubLabel, nextStageText } from './worldText';

/** "Lista": everything the map shows, as text (screen readers, or simply preferring text). */
export function WorldList({ world, onOpen }: { world: WorldView; onOpen(areaId: string): void }) {
  const { model } = world;
  return (
    <ol className="world-list" aria-label="Territórios">
      <li className="world-list__item world-list__item--hub">
        <div className="world-list__text">
          <h2 className="world-list__title">Encruzilhada</h2>
          <p>{hubLabel(world.companionName, model.avatar.areaId === undefined)}</p>
        </div>
      </li>
      {world.territories.map(({ t, lines, start, talk, grew }) => {
        const j = t.journeys[0];
        const here = model.avatar.areaId === t.area.id;
        return (
          <li key={t.area.id} className="world-list__item" style={{ ['--area-color' as string]: t.area.color }}>
            <span className="world-list__art" aria-hidden="true"><PixelSprite sprite={territorySprite(t.stage, t.area.color)} scale={2} /></span>
            <div className="world-list__text">
              <h2 className="world-list__title">{`${t.area.attribute} · ${STAGES[t.stage]!.name}`}</h2>
              <p>{`${t.area.name} · Nível ${t.level.level}${here ? ' · Você está aqui' : ''}`}</p>
              <p className="muted">{nextStageText(t)}</p>
              {j && <p>{`Jornada “${j.title}”: ${j.done} de ${j.total} missões`}</p>}
              <p className="world-list__npc">{`${t.npc.name} (${t.npc.role}): “${lines[start]!.text}”`}</p>
              {/* the same cues the map draws (balloon, sparkle), as text */}
              {talk && <p>Tem um recado para hoje.</p>}
              {grew && <p>Cresceu nos últimos dias.</p>}
            </div>
            <Button size="sm" aria-label={`Abrir ${t.area.attribute}`} onClick={() => onOpen(t.area.id)}>Abrir</Button>
          </li>
        );
      })}
    </ol>
  );
}
