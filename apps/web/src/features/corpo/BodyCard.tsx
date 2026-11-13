import { useId } from 'react';
import { Link } from 'wouter';
import { lastSleepNight, sleepWindow, weekKey, workoutWeek } from '@life/shared';
import { useSleepLogs, useWorkouts } from '../../db/corpoData';
import { useNow, useToday } from '../../db/hooks';
import { formatDuration } from '../../ui/format';
import { Panel } from '../../ui/Panel';
import './corpo.css';

/** Personagem → "Corpo": one line of sleep, one of workouts, and the way to /corpo (spec §6.4). */
export function BodyCard() {
  const id = useId();
  const now = useNow();
  const today = useToday();
  const logs = useSleepLogs();
  const workouts = useWorkouts();
  const window = logs ? sleepWindow(logs, lastSleepNight(now)) : undefined;
  const week = workouts && today ? workoutWeek(workouts, weekKey(today)) : undefined;
  return (
    <Panel variant="stone" className="body-card" role="region" aria-labelledby={id}>
      <h2 id={id} className="section-title">Corpo</h2>
      <p>
        {window?.enough
          ? `Sono: ${formatDuration(window.avgMinutes!)} em média · deitar ±${formatDuration(window.bed!.spreadMin)}`
          : 'Sono: registre algumas noites para ver a regularidade.'}
      </p>
      <p>{`Treinos nesta semana: ${week?.total ?? 0}`}</p>
      <Link href="/corpo" className="body-card__link">Ver sono e treinos</Link>
    </Panel>
  );
}
