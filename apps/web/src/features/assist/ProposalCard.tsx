import { Link, useLocation } from 'wouter';
import type { DayKey } from '@life/shared';
import { proposalItems } from '@life/shared';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import { plural } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { snoozeProposal, useProposalForAgora } from './proposalData';
import './assist.css';

/** "Proposta do assistente · N itens" on the Agora, while a proposal waits (spec 2026-11-25 §7.1). */
export function ProposalCard({ today }: { today: DayKey }) {
  const p = useProposalForAgora(today);
  // The review's back link returns here (the Agora or the Painel).
  const [location] = useLocation();
  if (!p) return null;
  const n = proposalItems(p.payload).length;
  return (
    <Panel variant="stone" className="proposal-card" role="region" aria-labelledby="proposal-card-title">
      <h2 id="proposal-card-title" className="proposal-card__title">{`Proposta do assistente · ${plural(n, 'item', 'itens')}`}</h2>
      <p className="proposal-card__meta">{`${p.source}: ${p.payload.title}`}</p>
      <div className="proposal-card__actions">
        <Link href={`/propostas/${p.id}?from=${encodeURIComponent(location)}`} className="btn btn--primary btn--sm">Revisar</Link>
        <Button size="sm" variant="ghost" onClick={(e) => { focusWhenGone(e.currentTarget); safeRun(snoozeProposal(p.id, today)); }}>Agora não</Button>
      </div>
    </Panel>
  );
}
