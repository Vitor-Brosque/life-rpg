import { Link } from 'wouter';
import { plural } from '../../ui/format';
import { useStudyPlan } from './useStudyPlan';
import './study.css';

/** The Painel's one-line review status (spec §6): "Revisão: N cards · ~M min" or "Revisão de hoje feita". */
export function StudyStatusLine() {
  const study = useStudyPlan();
  const p = study.plan;
  if (!p || !study.input || study.input.cards.length === 0) return null;
  if ((p.goalMet || p.nothingLeft) && p.reviewsToday > 0) return <p className="study-status">Revisão de hoje feita</p>;
  const count = p.dueCount + p.newAllowed;
  if (count === 0 || study.restDay || study.input.mode === 'free' || study.input.mode === 'recovery') return null;
  return (
    <p className="study-status">
      <Link href="/estudo/revisar">Revisão: {plural(count, 'card', 'cards')} · ~{Math.max(1, p.todayMin)} min</Link>
    </p>
  );
}
