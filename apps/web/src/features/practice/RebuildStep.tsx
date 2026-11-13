import { useState } from 'react';
import type { PracticeSession } from '@life/shared';
import { compareFact } from '@life/shared';
import { compareRebuild, setRebuildCode, startRebuild } from '../../domain/practiceActions';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { CodeEditor } from '../study/CodeEditor';
import { CodeView } from '../study/Rich';
import type { StepProps } from './PracticeSteps';
import { useDraftField } from './useDraftField';

/** "Reconstruir sem consulta" (spec §5.2, step 8): the implementation stays hidden until "Comparar". */
export function RebuildStep({ session, go }: StepProps) {
  const rb = session.rebuild;
  const [confirm, setConfirm] = useState(false);

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
        <p className="practice__hint">
          Reescreva a solução sem olhar. A sua implementação fica escondida até você comparar. Fazer isso em outro dia é um teste ainda melhor.
        </p>
        <Button variant="primary" onClick={() => safeRun(startRebuild(session.id))}>Começar reconstrução</Button>
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
            <Button variant="primary" onClick={() => { setConfirm(false); safeRun(startRebuild(session.id)); }}>Sim, refazer</Button>
            <Button onClick={() => setConfirm(false)}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setConfirm(true)}>Refazer reconstrução</Button>
      )}
    </>
  );
}

function RebuildEditor({ session }: { session: PracticeSession }) {
  const draft = useDraftField(session.rebuild?.code ?? '', (v) => setRebuildCode(session.id, v));
  const [busy, setBusy] = useState(false);
  const compare = (): void => {
    if (busy) return;
    setBusy(true);
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
