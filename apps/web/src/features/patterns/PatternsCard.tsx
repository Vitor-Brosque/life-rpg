import { useId } from 'react';
import { Link } from 'wouter';
import { Panel } from '../../ui/Panel';
import './patterns.css';

/** Personagem → "Padrões": the way to /padroes (spec §5.1). Reads nothing, so the Personagem stays light. */
export function PatternsCard() {
  const id = useId();
  return (
    <Panel variant="stone" className="patterns-card" role="region" aria-labelledby={id}>
      <h2 id={id} className="section-title">Padrões</h2>
      <p>Tendências, adiamentos e associações, separando o que foi observado das hipóteses.</p>
      <Link href="/padroes" className="patterns-card__link">Ver padrões</Link>
    </Panel>
  );
}
