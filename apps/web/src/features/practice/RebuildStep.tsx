import { useState } from 'react';
import { Link } from 'wouter';
import type { PracticeSession } from '@life/shared';
import { compareFact } from '@life/shared';
import { useToday } from '../../db/hooks';
import { compareRebuild, createRetest, setRebuildCode, startRebuild } from '../../domain/practiceActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { CodeEditor } from '../study/CodeEditor';
import { CodeView } from '../study/Rich';
import type { StepProps } from './PracticeSteps';
import { dayKeyMonth, focusStepTitle, usePracticeSessions } from './practiceData';
import { useDraftField } from './useDraftField';

/** "Reconstruir sem consulta" (spec §5.2, step 8): the implementation stays hidden until "Comparar". */
export function RebuildStep({ session, go }: StepProps) {
  const rb = session.rebuild;
  const [confirm, setConfirm] = useState(false);
  const today = useToday();
  const early = !!session.availableFrom && !!today && session.availableFrom > today;

  if (!rb) {
    if (!session.code.trim()) {
      return (
        <div className="practice__empty">
          <p className="muted">Implemente primeiro; depois reconstrua sem consultar.</p>
          <Button size="sm" variant="ghost" onClick={() => go('code')}>Ir para Implementar</Button>
        </div>
      );
    }
    return (
      <>
        {early && <p className="practice__hint" role="note">{`Marcada para ${dayKeyMonth(session.availableFrom!)}. Pode começar antes, se quiser.`}</p>}
        <p className="practice__hint">
          Reescreva a solução sem olhar. A sua implementação fica escondida até você comparar. Fazer isso em outro dia é um teste ainda melhor.
        </p>
        <Button variant="primary" onClick={(e) => { focusWhenGone(e.currentTarget, focusStepTitle); safeRun(startRebuild(session.id)); }}>
          Começar reconstrução
        </Button>
      </>
    );
  }

  // Keyed by startedAt: "Sim, refazer" mounts a fresh draft, never showing the previous rebuild's code.
  if (rb.comparedAt === undefined) return <RebuildEditor key={rb.startedAt} session={session} />;

  return (
    <>
      <div className="practice-compare">
        <section aria-label="Sua reconstrução" className="practice-compare__side">
          <h3 className="practice-compare__title">Sua reconstrução</h3>
          {rb.code.trim() ? <CodeView code={rb.code} lang={session.language} /> : <p className="muted">(vazia)</p>}
        </section>
        <section aria-label="Implementação" className="practice-compare__side">
          <h3 className="practice-compare__title">Implementação</h3>
          {session.code.trim() ? <CodeView code={session.code} lang={session.language} /> : <p className="muted">(vazia)</p>}
        </section>
      </div>
      <p className="practice__hint">{compareFact(session)} O que faltou? Registre como erro para virar card.</p>
      {confirm ? (
        <div className="practice__confirm" role="group" aria-label="Refazer reconstrução">
          <p>Apagar a reconstrução atual e começar de novo?</p>
          <div className="cluster">
            <Button variant="primary" onClick={(e) => { focusWhenGone(e.currentTarget, focusStepTitle); setConfirm(false); safeRun(startRebuild(session.id)); }}>
              Sim, refazer
            </Button>
            <Button autoFocus onClick={(e) => { focusWhenGone(e.currentTarget, focusStepTitle); setConfirm(false); }}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setConfirm(true)}>Refazer reconstrução</Button>
      )}
      <RetestGroup session={session} />
    </>
  );
}

const RETEST_CHOICES: ReadonlyArray<{ label: string; days: number }> = [
  { label: 'Em 3 dias', days: 3 }, { label: 'Em 1 semana', days: 7 }, { label: 'Em 2 semanas', days: 14 },
];

/** "Reconstruir de novo, sem consultar" (P2): schedule a fresh rebuild session; one at a time. */
function RetestGroup({ session }: { session: PracticeSession }) {
  const sessions = usePracticeSessions();
  if (!sessions) return null;
  const pending = sessions.find((s) => s.retestOf === session.id && s.status === 'open');
  if (pending) {
    return (
      <p className="practice__hint practice-retest">
        {`Reconstrução marcada para ${pending.availableFrom ? dayKeyMonth(pending.availableFrom) : 'hoje'}. `}
        <Link className="practice__link" href={`/pratica/${pending.id}?voltar=${encodeURIComponent(`/pratica/${session.id}`)}`}>Abrir</Link>
      </p>
    );
  }
  return (
    <div className="practice-retest" role="group" aria-label="Reconstruir de novo, sem consultar">
      <p className="practice__hint">Uma nova tentativa mais tarde mostra o que ficou.</p>
      <div className="cluster">
        {RETEST_CHOICES.map(({ label, days }) => (
          <Button key={days} onClick={(e) => { focusWhenGone(e.currentTarget, focusStepTitle); safeRun(createRetest(session.id, days)); }}>
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function RebuildEditor({ session }: { session: PracticeSession }) {
  const draft = useDraftField(session.rebuild?.code ?? '', (v) => setRebuildCode(session.id, v));
  const [busy, setBusy] = useState(false);
  const compare = (): void => {
    if (busy) return;
    setBusy(true);
    focusWhenGone(document.activeElement, focusStepTitle);
    // Save what was typed first: compareRebuild reads the stored rebuild to decide the bonus.
    safeRun(draft.flush()
      .then(() => compareRebuild(session.id))
      .then(({ xp }) => { useToast.getState().show(xp > 0 ? `Reconstrução comparada · +${xp} XP` : 'Reconstrução comparada'); })
      .finally(() => setBusy(false)));
  };
  return (
    <>
      <div onFocus={draft.onFocus} onBlur={draft.onBlur}>
        <CodeEditor label="Reconstrução" value={draft.value} onChange={draft.onChange} language={session.language} rows={14} />
      </div>
      <p className="practice__hint">Sem consultar: nem a implementação, nem a internet. Travou? Registre o erro.</p>
      <Button variant="primary" disabled={busy} onClick={compare}>Comparar com a implementação</Button>
    </>
  );
}
