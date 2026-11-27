import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useSearch } from 'wouter';
import type { ItemResult, Proposal, ProposalGroup, ProposalItem, ProposalStatus } from '@life/shared';
import { PROPOSAL_GROUP_TITLE, bibKey, findSubjectByName, nameKey, notebookSectionOfKey, proposalItems, weekdaysText } from '@life/shared';
import { db } from '../../db/db';
import { ProposalError, applyProposal, applyResultText, rejectProposal } from '../../domain/proposalActions';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { FAILURE_TOAST } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { useProposal } from './proposalData';
import './assist.css';

const STATUS_TEXT: Record<ProposalStatus, string> = {
  pending: 'Esperando a sua revisão', applied: 'Aplicada', partial: 'Aplicada em parte', rejected: 'Recusada', replaced: 'Substituída por uma proposta mais nova',
};
const RESULT_TEXT: Record<ItemResult, string> = { applied: 'aplicado', existed: 'já existia', skipped: 'pulado', unchecked: 'desmarcado' };
const dateText = (ts: number): string => new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const EXISTS_NOTE = 'Já existe, será reaproveitado.';
const DOC_REPLACED_NOTE = 'Já existe uma apostila com este título: o texto será substituído.';
const docKey = (journeyId: string, title: string): string => `${journeyId}|${bibKey(title)}`;

/** Names that already exist, to mark items that will be reused instead of created. */
function useExisting(p: Proposal) {
  return useLiveQuery(async () => {
    const live = <T extends { deleted: boolean }>(xs: T[]) => xs.filter((x) => !x.deleted);
    const [areas, goals, journeys, missions, commitments, blocks, plan, notebooks, profile] = await Promise.all([
      db.areas.toArray(), db.goals.toArray(), db.journeys.toArray(), db.missions.toArray(), db.commitments.toArray(), db.blocks.toArray(),
      db.trainingPlans.get('plan'), db.subjectNotebooks.toArray(), db.profile.get('me'),
    ]);
    // Apostilas only of the subjects this proposal sends apostilas to: one with the same title gets its text replaced.
    const docSubjects = (p.payload.study ?? []).filter((s) => s.docs?.length)
      .flatMap((s) => findSubjectByName(live(journeys), s.subject)?.id ?? []);
    const docs = docSubjects.length > 0 ? live(await db.studyDocs.where('journeyId').anyOf(docSubjects).toArray()) : [];
    return {
      areas: new Set(live(areas).filter((a) => !a.archived).map((a) => nameKey(a.name))),
      goals: new Set(live(goals).filter((g) => g.status === 'ativo' || g.status === 'pausado').map((g) => nameKey(g.title))),
      journeys: new Set(live(journeys).filter((j) => j.status === 'active').map((j) => nameKey(j.title))),
      missions: new Set(live(missions).filter((m) => (m.status === 'open' || m.status === 'doing') && !m.journeyId).map((m) => nameKey(m.title))),
      commitments: new Set(live(commitments).filter((c) => c.weekdays?.length).map((c) => `${nameKey(c.title)}|${c.start}`)),
      blocks: live(blocks).filter((b) => !b.archived).sort((a, b) => a.order - b.order),
      hasPlan: !!plan && !plan.deleted,
      // For "Hoje está vazio." under a notebook section or the study profile that is empty today.
      liveJourneys: live(journeys),
      notebooks: new Map(live(notebooks).map((n) => [n.journeyId, n])),
      studyProfile: profile && !profile.deleted ? profile.studyProfile ?? '' : '',
      docs: new Map(docs.map((d) => [docKey(d.journeyId, d.title), d.markdown])),
    };
  }, [p.id]);
}

/** A notebook section (or the study profile) that is empty today: its item says so in the detail. */
function emptyToday(p: Proposal, item: ProposalItem, ex: NonNullable<ReturnType<typeof useExisting>>): boolean {
  if (item.key === 'studyProfile') return ex.studyProfile.trim() === '';
  const section = notebookSectionOfKey(item.key);
  if (!section) return false;
  const pkg = p.payload.study?.[Number(item.key.split('.')[1])];
  const subject = pkg ? findSubjectByName(ex.liveJourneys, pkg.subject) : undefined;
  return (subject ? ex.notebooks.get(subject.id)?.[section] ?? '' : '').trim() === '';
}

/** The line under an item that reuses or replaces something that already exists, if any. */
function existingNote(p: Proposal, item: ProposalItem, ex: NonNullable<ReturnType<typeof useExisting>>): string | undefined {
  const [kind, a, part, b] = item.key.split('.');
  if (kind === 'study' && part === 'docs') {
    const pkg = p.payload.study?.[Number(a)];
    const doc = pkg?.docs?.[Number(b)];
    const subject = pkg ? findSubjectByName(ex.liveJourneys, pkg.subject) : undefined;
    const current = doc && subject ? ex.docs.get(docKey(subject.id, doc.title)) : undefined;
    if (current === undefined) return undefined;
    return current === doc!.markdown ? EXISTS_NOTE : DOC_REPLACED_NOTE;
  }
  return existsAlready(p, item, ex) ? EXISTS_NOTE : undefined;
}

function existsAlready(p: Proposal, item: ProposalItem, ex: NonNullable<ReturnType<typeof useExisting>>): boolean {
  const [kind, a] = item.key.split('.');
  const i = Number(a);
  switch (kind) {
    case 'areas': return ex.areas.has(nameKey(p.payload.areas![i]!.name));
    case 'goals': return ex.goals.has(nameKey(p.payload.goals![i]!.title));
    case 'journeys': return ex.journeys.has(nameKey(p.payload.journeys![i]!.title));
    case 'missions': return ex.missions.has(nameKey(p.payload.missions![i]!.title));
    case 'commitments': { const c = p.payload.commitments![i]!; return ex.commitments.has(`${nameKey(c.title)}|${c.start}`); }
    default: return false;
  }
}

/** "/propostas/:id": review and apply a proposal from an assistant (spec 2026-11-25 §7.2). */
export function ProposalScreen({ id }: { id: string }) {
  const p = useProposal(id);
  // Opened from a subject's "Colar resposta do chat": back goes to that subject. Anything else keeps "Ajustes".
  const from = new URLSearchParams(useSearch()).get('from') ?? '';
  const subjectPath = /^\/estudo\/materias\/[A-Za-z0-9_-]+$/.test(from) ? from : undefined;
  return (
    <section className="screen proposal stack" aria-labelledby="proposal-title">
      {subjectPath
        ? <Link href={subjectPath} className="deck__back">← Disciplina</Link>
        : <Link href="/ajustes" className="settings__back">‹ Ajustes</Link>}
      <h1 id="proposal-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Proposta do assistente</h1>
      {p === null && <p className="muted">Esta proposta não existe mais.</p>}
      {p && <ProposalView key={p.id} p={p} />}
    </section>
  );
}

function ProposalView({ p }: { p: Proposal }) {
  const items = proposalItems(p.payload);
  const existing = useExisting(p);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(items.map((i) => i.key)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pending = p.status === 'pending';
  const outcome = new Map((p.outcome ?? []).map((o) => [o.key, o]));
  const groups = [...new Set(items.map((i) => i.group))] as ProposalGroup[];

  const run = async (task: () => Promise<string>) => {
    setBusy(true); setError(undefined);
    try {
      useToast.getState().show(await task());
    } catch (err) {
      if (err instanceof ProposalError) setError(err.message);
      else { console.error('proposal action failed', err); useToast.getState().show(FAILURE_TOAST); }
    } finally {
      setBusy(false);
    }
  };
  const toggle = (key: string) => setChecked((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <>
      <div className="proposal__head">
        <p className="proposal__title">{p.payload.title}</p>
        <p className="muted">{`${p.source} · ${dateText(p.createdAt)} · ${STATUS_TEXT[p.status]}`}</p>
        <p className="proposal__summary">{p.payload.summary}</p>
        {pending && <p className="muted">Nada muda até você aplicar. Desmarque o que não quiser; o que já existe com o mesmo nome é reaproveitado, sem duplicar.</p>}
      </div>
      {groups.map((g) => (
        <section key={g} className="proposal__group stack" aria-labelledby={`proposal-group-${g}`}>
          <h2 id={`proposal-group-${g}`} className="section-title">{PROPOSAL_GROUP_TITLE[g]}</h2>
          {g === 'routine' && p.payload.routine?.mode === 'replace' && existing && existing.blocks.length > 0 && pending && (
            <p className="proposal__warn">
              {`A rotina atual será arquivada (dá para reativar depois): ${existing.blocks.map((b) => `${b.name} (${weekdaysText(b.weekdays)} ${b.targetStart})`).join('; ')}.`}
            </p>
          )}
          {g === 'training' && existing?.hasPlan && pending && <p className="proposal__warn">O plano de treino atual será substituído.</p>}
          <ul className="proposal__items">
            {items.filter((i) => i.group === g).map((item) => {
              const o = outcome.get(item.key);
              const detail = [...(item.detail ?? []), ...(pending && existing && emptyToday(p, item, existing) ? ['Hoje está vazio.'] : [])];
              const note = pending && existing ? existingNote(p, item, existing) : undefined;
              return (
                <li key={item.key} className="proposal__item">
                  {pending ? (
                    <label className="proposal__check">
                      <input type="checkbox" checked={checked.has(item.key)} onChange={() => toggle(item.key)} />
                      <span>{item.text}</span>
                    </label>
                  ) : (
                    <p className="proposal__line">
                      <span>{item.text}</span>
                      {o && <span className="proposal__result">{` — ${RESULT_TEXT[o.result]}${o.reason ? `: ${o.reason}` : ''}`}</span>}
                    </p>
                  )}
                  {note && <p className="proposal__note">{note}</p>}
                  {detail.length > 0 && <ul className="proposal__detail">{detail.map((d, k) => <li key={k}>{d}</li>)}</ul>}
                  {item.why && <p className="proposal__why">{item.why}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {error && <p role="alert" className="training__error">{error}</p>}
      {pending && (
        <div className="body-block__actions">
          <Button variant="primary" disabled={busy || checked.size === 0}
            onClick={() => { void run(async () => applyResultText(await applyProposal(p.id, [...checked]))); }}>
            Aplicar selecionados
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => { void run(async () => { await rejectProposal(p.id); return 'Proposta recusada.'; }); }}>
            Recusar
          </Button>
        </div>
      )}
    </>
  );
}
