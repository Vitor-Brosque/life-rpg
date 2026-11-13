import { useState } from 'react';
import type { Indicator, IndicatorKey, PracticeScore } from '@life/shared';
import { INDICATORS, PRACTICE_LIMITS, rebuildFact } from '@life/shared';
import { PracticeIncompleteError, concludePractice, reopenPractice, setPracticeRating, updatePractice } from '../../domain/practiceActions';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { useCompanion } from '../companion/store';
import { DraftText, ScoreChoice } from './PracticeFields';
import type { StepProps } from './PracticeSteps';
import { dayMonth } from './practiceData';

/** "Fechar" (spec §5.2, step 9): three separate self-ratings, never summed and never rewarded. */
export function CloseStep({ session }: StepProps) {
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [delivered, understood, autonomous] = INDICATORS as [Indicator, Indicator, Indicator];
  const rate = (key: IndicatorKey) => (v: PracticeScore): void => {
    setMissing(false);
    safeRun(setPracticeRating(session.id, key, v));
  };
  const score = (ind: Indicator) => (
    <ScoreChoice name={`${ind.key}-${session.id}`} legend={`${ind.label} — ${ind.question}`} options={ind.options}
      value={session.ratings[ind.key]} onChange={rate(ind.key)} />
  );
  const conclude = (): void => {
    if (busy) return;
    setBusy(true);
    safeRun(concludePractice(session.id)
      .then(({ xp }) => {
        useToast.getState().show(xp > 0 ? `Sessão encerrada · +${xp} XP` : 'Sessão encerrada');
        void useCompanion.getState().say('practiceDone');
      })
      .catch((e: unknown) => {
        if (e instanceof PracticeIncompleteError) { setMissing(true); return; }
        throw e;
      })
      .finally(() => setBusy(false)));
  };

  return (
    <>
      {score(delivered)}
      <DraftText label="Explique em 2 frases o que você fez e por que funciona" multiline rows={3}
        maxLength={PRACTICE_LIMITS.explanation} saved={session.explanation}
        onSave={(v) => updatePractice(session.id, { explanation: v })} />
      {score(understood)}
      <p className="practice-fact">{rebuildFact(session)}</p>
      {score(autonomous)}
      <p className="practice__hint">Os três ficam separados e não valem XP: servem para você ver a tendência com honestidade.</p>
      <DraftText label="Primeira ação da próxima sessão (opcional)" maxLength={PRACTICE_LIMITS.nextAction}
        saved={session.nextAction ?? ''} onSave={(v) => updatePractice(session.id, { nextAction: v })} />
      {session.status === 'done' ? (
        <div className="practice__done">
          <p>Sessão encerrada em {dayMonth(session.endedAt ?? session.updatedAt)}.</p>
          <Button onClick={() => safeRun(reopenPractice(session.id))}>Reabrir sessão</Button>
        </div>
      ) : (
        <>
          {missing && <p role="alert" className="practice__alert">Escolha uma opção em cada indicador.</p>}
          <Button variant="primary" disabled={busy} onClick={conclude}>Encerrar sessão</Button>
        </>
      )}
    </>
  );
}
