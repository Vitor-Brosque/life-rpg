import { Link } from 'wouter';
import type { BlockOccurrence } from '@life/shared';
import {
  CARDIO_MINIMUM_MIN, CARDIO_MINIMUM_TEXT, WORKOUT_LABEL, WORKOUT_MAX_MIN, blockWeekOf, targetText, trainingCounts, trainingDayOf,
} from '@life/shared';
import { useTrainingLog, useTrainingPlan, useWorkouts } from '../../db/corpoData';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { logMinimumCardio, useWorkoutSheet } from './WorkoutSheet';
import './corpo.css';

/**
 * The body block's part of the banner (spec §6.4): today's workouts, "Registrar treino" (minutes
 * since "Começar bloco") and the minimum cardio, highlighted when the block runs in its minimum version.
 */
export function BodyBlockPanel({ occurrence, now }: { occurrence: BlockOccurrence; now: number }) {
  const workouts = useWorkouts();
  const plan = useTrainingPlan();
  const trainingLog = useTrainingLog(occurrence.day);
  const today = (workouts ?? []).filter((w) => w.day === occurrence.day).reverse();
  const hadCardio = today.some((w) => w.kind === 'cardio');
  const startedAt = occurrence.session?.startedAt;
  const elapsed = startedAt !== undefined
    ? Math.min(WORKOUT_MAX_MIN, Math.max(1, Math.round((now - startedAt) / 60_000))) : undefined;
  const blockId = occurrence.block.id;
  const entry = trainingDayOf(plan ?? undefined, occurrence.day);
  const counts = trainingLog ? trainingCounts(trainingLog) : undefined;
  const planned = trainingLog?.planName ?? entry?.name;
  const target = planned ? (trainingLog?.target ?? blockWeekOf(plan?.block, occurrence.day)) : undefined;
  // Only the block: the training screen counts the minutes live from the block session (never stale).
  const openHref = `/corpo/treino?bloco=${blockId}`;

  return (
    <div className="block-banner__group body-block" role="group" aria-label="Treino de hoje">
      {plan && (
        <p className="body-block__plan">
          {planned
            ? `Treino de hoje: ${planned}${target ? ` · ${targetText(target)}` : ''}${counts ? ` · ${counts.done + counts.swapped} de ${trainingLog!.exercises.length} exercícios` : ''}`
            : 'Descanso da musculação.'}
          {' '}<Link href={openHref} className="body-card__link">Abrir treino</Link>
        </p>
      )}
      {today.length > 0 && (
        <p className="body-block__done">{`Hoje: ${today.map((w) => `${WORKOUT_LABEL[w.kind]} ${w.minutes} min`).join(' · ')}`}</p>
      )}
      <div className="body-block__actions">
        <Button size="sm" icon="heart"
          onClick={() => useWorkoutSheet.getState().open({ blockId, ...(elapsed !== undefined ? { minutes: elapsed } : {}) })}>
          Registrar treino
        </Button>
        {!hadCardio && (
          <Button size="sm" onClick={(e) => { focusWhenGone(e.currentTarget); safeRun(logMinimumCardio(blockId)); }}>
            Fiz o cardio mínimo
          </Button>
        )}
      </div>
      {!hadCardio && (
        <p className="body-block__minimum">
          {occurrence.version === 'minimum'
            ? `Hoje vale a versão mínima do cardio: ${CARDIO_MINIMUM_MIN} min de ${CARDIO_MINIMUM_TEXT}.`
            : `Sem vontade de cardio? A versão mínima é ${CARDIO_MINIMUM_MIN} min.`}
        </p>
      )}
    </div>
  );
}
