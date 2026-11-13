import { Link, useLocation } from 'wouter';
import type { BlockOccurrence, DayMode } from '@life/shared';
import { reviewPrompt } from '@life/shared';
import { Button } from '../../ui/Button';
import { plural } from '../../ui/format';
import { Panel } from '../../ui/Panel';
import { useStudyPlan } from './useStudyPlan';
import './study.css';

/** The Agora's review prompt (spec §6): a card inside a block with reviews, a discreet line outside blocks. */
export function ReviewPrompt({ mode, current }: { mode: DayMode; current?: Pick<BlockOccurrence, 'block'> }) {
  const [, navigate] = useLocation();
  const study = useStudyPlan();
  const kind = reviewPrompt({ plan: study.plan, mode, restDay: study.restDay, current });
  if (!kind || !study.plan) return null;
  const count = study.plan.dueCount + study.plan.newAllowed;
  const minutes = `~${Math.max(1, study.plan.todayMin)} min`;
  if (kind === 'line') {
    return (
      <p className="review-line">
        <Link href="/estudo/revisar">{plural(count, 'card para revisar', 'cards para revisar')} · {minutes}</Link>
      </p>
    );
  }
  return (
    <Panel variant="stone" className="review-prompt">
      <div className="review-prompt__text">
        <h2 className="review-prompt__title">Revisão espaçada</h2>
        <p className="review-prompt__meta">{plural(count, 'card', 'cards')} · {minutes}</p>
      </div>
      <Button variant="primary" icon="book" onClick={() => navigate('/estudo/revisar')}>Revisar</Button>
    </Panel>
  );
}
