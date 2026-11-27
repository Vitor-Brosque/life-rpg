import { Link } from 'wouter';
import { Panel } from '../../ui/Panel';

/** "Fala" on the Estudo tab: a fixed text and the link (reads nothing). */
export function SpeechPanel() {
  return (
    <Panel variant="stone" className="study-section">
      <div className="study__head">
        <h2 className="study__subtitle">Fala</h2>
      </div>
      <p className="muted">Prática de fala com gravação, sem nota. Escolha 5, 15 ou 25–30 minutos.</p>
      <Link href="/estudo/fala">Abrir Fala</Link>
    </Panel>
  );
}
