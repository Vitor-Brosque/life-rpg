import type { ID } from '@life/shared';
import { purposeChain } from '@life/shared';
import { useGoals } from '../../db/goalData';
import { useJourneys } from '../../db/hooks';
import '../plan/plan.css';

/** "Carreira em Dados › Tech News" (spoken "Objetivo: …, jornada: …") when the mission's journey serves an objective. */
export function PurposeChainLine({ journeyId, className }: { journeyId?: ID; className?: string }) {
  const journeys = useJourneys();
  const goals = useGoals();
  const chain = goals ? purposeChain(journeyId, journeys, goals) : undefined;
  if (!chain) return null;
  return (
    <p className={['purpose-chain', className].filter(Boolean).join(' ')}>
      <span aria-hidden="true">{chain.visible}</span>
      <span className="visually-hidden">{chain.spoken}</span>
    </p>
  );
}
