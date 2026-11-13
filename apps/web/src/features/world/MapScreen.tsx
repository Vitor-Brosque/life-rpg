import { useState } from 'react';
import { Link } from 'wouter';
import { Button } from '../../ui/Button';
import { Panel } from '../../ui/Panel';
import { TerritorySheet } from './TerritorySheet';
import { useWorld } from './useWorld';
import { WorldList } from './WorldList';
import { WorldMap } from './WorldMap';
import { worldSummary } from './worldText';
import './world.css';

type View = 'mapa' | 'lista';
export const WORLD_VIEW_KEY = 'life.world.view';

function readView(): View {
  try {
    return localStorage.getItem(WORLD_VIEW_KEY) === 'lista' ? 'lista' : 'mapa';
  } catch {
    return 'mapa';
  }
}

/** "Mapa do mundo" (/mapa, from Personagem): one territory per area, its NPC, roads of the journeys. */
export function MapScreen() {
  const world = useWorld();
  const [view, setView] = useState<View>(readView);
  const [openId, setOpenId] = useState<string>();
  const choose = (v: View) => {
    setView(v);
    try { localStorage.setItem(WORLD_VIEW_KEY, v); } catch { /* private mode: not remembered */ }
  };
  const open = world?.territories.find((v) => v.t.area.id === openId);

  return (
    <section className="screen world stack" aria-labelledby="world-title">
      <div className="world__top">
        <Link href="/personagem" className="btn btn--ghost btn--sm" aria-label="Voltar para Personagem">Voltar</Link>
        <h1 id="world-title">Mapa do mundo</h1>
      </div>
      {world && (
        <>
          <p className="world__summary">{worldSummary(world.model)}</p>
          <div className="world__views" role="group" aria-label="Exibir como">
            <Button size="sm" variant={view === 'mapa' ? 'primary' : 'secondary'} aria-pressed={view === 'mapa'} onClick={() => choose('mapa')}>Mapa</Button>
            <Button size="sm" variant={view === 'lista' ? 'primary' : 'secondary'} aria-pressed={view === 'lista'} onClick={() => choose('lista')}>Lista</Button>
          </div>
          {world.territories.length === 0 ? (
            <Panel variant="stone">
              <p>Nenhuma área ativa. As áreas ficam em <Link href="/ajustes">Ajustes</Link>.</p>
            </Panel>
          ) : view === 'mapa' ? (
            <WorldMap model={world.model} territories={world.territories} look={world.look}
              companionName={world.companionName} onOpen={setOpenId} />
          ) : (
            <WorldList world={world} onOpen={setOpenId} />
          )}
          <p className="world__note muted">Cada território cresce com o XP da sua área. Dias parados não tiram nada daqui.</p>
          <TerritorySheet key={openId ?? 'none'} view={open} world={world} onClose={() => setOpenId(undefined)} />
        </>
      )}
    </section>
  );
}
