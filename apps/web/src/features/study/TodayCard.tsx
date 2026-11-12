import type { ReactNode } from 'react';
import type { DayMode, StudyPlan } from '@life/shared';
import { weekdayOf } from '@life/shared';
import { Button } from '../../ui/Button';
import { WEEKDAY_ABBR, plural } from '../../ui/format';
import { Panel } from '../../ui/Panel';

export interface TodayCardProps {
  plan: StudyPlan;
  mode: DayMode;
  restDay: boolean;
  hasDecks: boolean;
  hasCards: boolean;
  onReview(): void;
  onCreateDeck(): void;
  onNewCard(): void;
}

const minutes = (m: number): string => `~${Math.max(1, Math.round(m))} min`;

/** "Hoje" of the Estudo tab (spec §6): the plan, its reason, or a calm done / free-day state. */
export function TodayCard({ plan, mode, restDay, hasDecks, hasCards, onReview, onCreateDeck, onNewCard }: TodayCardProps) {
  const next = plan.forecast[0];
  const nextLine = next ? `Próximo dia de estudo (${WEEKDAY_ABBR[weekdayOf(next.day)]}): ${minutes(next.min)}` : undefined;
  const work = plan.dueCount + plan.newAllowed;
  const parts = [
    ...(plan.dueCount > 0 ? [plural(plan.dueCount, 'revisão', 'revisões')] : []),
    ...(plan.newAllowed > 0 ? [plural(plan.newAllowed, 'novo', 'novos')] : []),
  ];
  let body: ReactNode;
  if (!hasDecks) {
    body = (
      <>
        <p>Comece com um baralho, como SQL ou Faculdade. Os cards entram na revisão aos poucos, dentro do tempo que você escolher por dia.</p>
        <div className="study-today__actions"><Button variant="primary" icon="plus" onClick={onCreateDeck}>Criar baralho</Button></div>
      </>
    );
  } else if (!hasCards) {
    body = (
      <>
        <p>Nenhum card ainda. Crie o primeiro.</p>
        <div className="study-today__actions"><Button variant="primary" icon="plus" onClick={onNewCard}>Novo card</Button></div>
      </>
    );
  } else if ((plan.goalMet || plan.nothingLeft) && plan.reviewsToday > 0) {
    body = (
      <>
        <p className="study-today__headline">Revisão de hoje feita</p>
        {nextLine && <p className="muted">{nextLine}</p>}
        {work > 0 && <div className="study-today__actions"><Button variant="ghost" onClick={onReview}>Continuar revisando</Button></div>}
      </>
    );
  } else if (plan.nothingLeft) {
    body = (
      <>
        <p className="study-today__headline">Nada para revisar hoje</p>
        {nextLine && <p className="muted">{nextLine}</p>}
      </>
    );
  } else if (restDay || mode === 'free') {
    body = (
      <>
        <p className="study-today__headline">Dia livre</p>
        <p className="muted">Nada vence hoje.</p>
        <div className="study-today__actions"><Button variant="ghost" onClick={onReview}>Revisar mesmo assim</Button></div>
      </>
    );
  } else {
    body = (
      <>
        <p className="study-today__headline">{parts.join(' + ')} · {minutes(plan.todayMin)}</p>
        <p className="muted">Novos: {plan.newReason}.</p>
        <div className="study-today__actions"><Button variant="primary" icon="book" onClick={onReview}>Revisar</Button></div>
      </>
    );
  }
  return <Panel variant="stone" className="study-today" aria-label="Hoje">{body}</Panel>;
}
