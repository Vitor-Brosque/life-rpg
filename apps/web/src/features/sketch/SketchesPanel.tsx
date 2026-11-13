import { Link, useLocation } from 'wouter';
import { useMissions, useNow } from '../../db/hooks';
import { Button } from '../../ui/Button';
import { Panel } from '../../ui/Panel';
import { SketchRow, openNewSketch } from './SketchListScreen';
import { useRecentSketches } from './sketchData';

const SHOWN = 3;

/** "Lousas" on the Estudo tab: the 3 most recent, Nova lousa and Ver todas (spec §6.1). */
export function SketchesPanel() {
  const [, navigate] = useLocation();
  const recent = useRecentSketches(SHOWN + 1);
  const missions = useMissions();
  const now = useNow();
  if (recent === undefined) return null;
  return (
    <Panel variant="stone" className="study-section">
      <div className="study__head">
        <h2 className="study__subtitle">Lousas</h2>
        <div className="study__actions">
          <Button size="sm" icon="plus" onClick={() => openNewSketch(navigate, '/estudo')}>Nova lousa</Button>
        </div>
      </div>
      {recent.length === 0 ? <p className="muted">Um espaço livre para contas, fórmulas e diagramas.</p> : (
        <ul className="study-list">
          {recent.slice(0, SHOWN).map((s) => <SketchRow key={s.id} sketch={s} missions={missions} now={now} from="/estudo" />)}
        </ul>
      )}
      {recent.length > SHOWN && <Link className="sketch-panel__all" href="/estudo/lousas">Ver todas</Link>}
    </Panel>
  );
}
