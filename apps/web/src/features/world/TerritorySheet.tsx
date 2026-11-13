import { useState } from 'react';
import { Link } from 'wouter';
import { STAGES } from '@life/shared';
import { PixelSprite } from '../../art/PixelSprite';
import { npcSprite, territorySprite } from '../../art/worldSprites';
import { Button } from '../../ui/Button';
import { relativeTime } from '../../ui/format';
import { ProgressBar } from '../../ui/ProgressBar';
import { Sheet } from '../../ui/Sheet';
import { reasonLabel, type TerritoryView, type WorldView } from './useWorld';
import { nextStageText } from './worldText';
import '../character/character.css';   // .recent__* rows, shared with Personagem

function TerritoryBody({ view, world, onClose }: { view: TerritoryView; world: WorldView; onClose(): void }) {
  const { t, lines, start } = view;
  const [offset, setOffset] = useState(0);
  const line = lines[(start + offset) % lines.length]!;
  return (
    <div className="territory">
      <div className="territory__head">
        <span className="territory__art" aria-hidden="true"><PixelSprite sprite={territorySprite(t.stage, t.area.color)} scale={3} /></span>
        <div className="territory__info">
          <p className="territory__area">{`${t.area.name} · Nível ${t.level.level}`}</p>
          <ProgressBar value={t.level.into} max={t.level.needed} color={t.area.color} label={`${t.level.into} / ${t.level.needed} XP`} />
          <p className="territory__next">{nextStageText(t)}</p>
        </div>
      </div>

      <section className="npc" aria-label={`${t.npc.name}, ${t.npc.role}`}>
        <span className="npc__art" aria-hidden="true"><PixelSprite sprite={npcSprite(t.npc.kind, t.area.color)} scale={3} /></span>
        <div className="npc__speech">
          <p className="npc__name">{`${t.npc.name} · ${t.npc.role}`}</p>
          <p className="npc__line" aria-live="polite">{line.text}</p>
          {lines.length > 1 && (
            <Button size="sm" variant="ghost" aria-label={`Outra fala de ${t.npc.name}`} onClick={() => setOffset((o) => o + 1)}>
              Outra fala
            </Button>
          )}
        </div>
      </section>

      <section aria-labelledby="territory-recent">
        <h3 id="territory-recent" className="section-title">Últimas ações</h3>
        {t.recent.length === 0 ? (
          <p className="muted">Nada por aqui ainda. Qualquer ação desta área conta.</p>
        ) : (
          <ul className="territory__recent" aria-label="Últimas ações">
            {t.recent.map((x) => {
              const title = x.missionId ? world.missionTitles.get(x.missionId) : undefined;
              return (
                <li key={x.id} className="recent__item">
                  <span className="recent__label">{title ? `${reasonLabel(x.reason)} · ${title}` : reasonLabel(x.reason)}</span>
                  <span className="recent__xp">{`+${x.amount} XP`}</span>
                  <span className="recent__when">{relativeTime(x.at, world.now)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="territory-journeys">
        <h3 id="territory-journeys" className="section-title">Jornadas</h3>
        {t.journeys.length === 0 ? (
          <p className="muted">Nenhuma jornada ativa nesta área.</p>
        ) : (
          <ul className="territory__journeys">
            {t.journeys.map((j) => (
              <li key={j.id}>
                <Link href={`/jornadas/${j.id}`} className="territory__journey" onClick={onClose}>
                  <span className="territory__journey-title">{j.title}</span>
                  <ProgressBar value={j.done} max={j.total} color={t.area.color}
                    label={j.total > 0 ? `${j.done} de ${j.total} missões` : 'Sem missões ainda'} />
                  {j.nextTitle && <span className="territory__journey-next">{`Próxima: ${j.nextTitle}`}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Panel of one territory: level and XP, its NPC, the recent real actions and the active journeys. */
export function TerritorySheet({ view, world, onClose }: { view?: TerritoryView; world: WorldView; onClose(): void }) {
  const title = view ? `${view.t.area.attribute} · ${STAGES[view.t.stage]!.name}` : '';
  return (
    <Sheet open={view !== undefined} onClose={onClose} title={title}>
      {view && <TerritoryBody view={view} world={world} onClose={onClose} />}
    </Sheet>
  );
}
