import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import type { Mission, Sketch } from '@life/shared';
import { useMissions, useNow } from '../../db/hooks';
import { createSketch } from '../../domain/sketchActions';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import { safeRun } from '../../ui/safeRun';
import { matchesSketch, nameOf, sketchMeta, useAllSketches } from './sketchData';
import '../study/study.css';
import './sketch.css';

/** Creates a standalone lousa and opens it; "Voltar" comes back to `from`. */
export function openNewSketch(navigate: (to: string) => void, from: string): void {
  safeRun(createSketch().then((s) => navigate(`/lousa/${s.id}?voltar=${encodeURIComponent(from)}`)));
}

/** One row: name and "Missão · 12 traços · há 3 h". */
export function SketchRow({ sketch, missions, now, from }: { sketch: Sketch; missions: readonly Mission[]; now: number; from: string }) {
  return (
    <li>
      <Link className="study-list__item sketch-row" href={`/lousa/${sketch.id}?voltar=${encodeURIComponent(from)}`}>
        <span className="sketch-row__name">{nameOf(sketch, missions)}</span>
        <span className="sketch-row__meta">{sketchMeta(sketch, now)}</span>
      </Link>
    </li>
  );
}

/** "/estudo/lousas": every lousa, with search (spec §6.1). */
export function SketchListScreen() {
  const [, navigate] = useLocation();
  const sketches = useAllSketches();
  const missions = useMissions();
  const now = useNow();
  const [q, setQ] = useState('');
  if (sketches === undefined) return <section className="screen" aria-busy="true" aria-label="Lousas" />;
  const shown = sketches.filter((s) => matchesSketch(nameOf(s, missions), q));
  return (
    <section className="screen stack" aria-labelledby="sketches-title">
      <Link className="deck__back" href="/estudo">← Estudo</Link>
      <h1 id="sketches-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Lousas</h1>
      <div className="study__actions">
        <Button variant="primary" icon="plus" onClick={() => openNewSketch(navigate, '/estudo/lousas')}>Nova lousa</Button>
      </div>
      <Panel variant="stone" className="study-section">
        {sketches.length === 0 ? (
          <p className="muted">Nenhuma lousa ainda. Use uma para resolver contas, deduzir fórmulas ou desenhar diagramas.</p>
        ) : (
          <>
            <div className="field">
              <label className="field__label" htmlFor="sketch-search">Buscar</label>
              <input id="sketch-search" type="search" value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
            </div>
            {shown.length === 0 ? <p className="muted">Nada encontrado.</p> : (
              <ul className="study-list">
                {shown.map((s) => <SketchRow key={s.id} sketch={s} missions={missions} now={now} from="/estudo/lousas" />)}
              </ul>
            )}
          </>
        )}
      </Panel>
    </section>
  );
}
