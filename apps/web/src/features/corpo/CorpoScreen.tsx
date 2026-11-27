import { Link } from 'wouter';
import { WORKOUT_LABEL, addDays, lastSleepNight, sleepQualityOf, sleepWindow, weekKey, workoutWeek } from '@life/shared';
import { useSleepLogs, useSleepSettings, useWorkouts } from '../../db/corpoData';
import { useNow, useToday } from '../../db/hooks';
import { removeWorkout, restoreWorkout } from '../../domain/workoutActions';
import { saveSleepSettings } from '../../domain/sleepActions';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE, focusWhenGone } from '../../ui/focusAfter';
import { formatDuration, plural } from '../../ui/format';
import { Panel } from '../../ui/Panel';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { NutritionSection } from '../nutrition/NutritionSection';
import { kindsText, rangeText, shortDay, spreadText } from './corpoFormat';
import { SleepNights } from './SleepNights';
import { TrainingEvolution } from './TrainingEvolution';
import { TrainingToday } from './TrainingToday';
import { useSleepSheet } from './SleepSheet';
import { logMinimumCardio, useWorkoutSheet } from './WorkoutSheet';
import './corpo.css';

export const SYMPTOMS_NOTE = 'Sintomas como ronco, obstrução nasal ou bruxismo: procure avaliação profissional. O app só registra horários.';

/** "/corpo": sleep regularity (observed), the week's workouts (spec §6.3) and the day's nutrition summary. */
export function CorpoScreen() {
  const now = useNow();
  const today = useToday();
  const logs = useSleepLogs();
  const settings = useSleepSettings();
  const workouts = useWorkouts();
  const quality = logs ? sleepQualityOf(logs, lastSleepNight(now)) : undefined;
  const qualityText = quality ? `${String(quality.avg).replace('.', ',')} de 5 · ${plural(quality.nights, 'noite', 'noites')}` : undefined;
  const sleep = logs ? sleepWindow(logs, lastSleepNight(now)) : undefined;
  const week = workouts && today ? workoutWeek(workouts, weekKey(today)) : undefined;
  const since = today ? addDays(today, -13) : undefined;
  const recent = workouts && since ? workouts.filter((w) => w.day >= since) : [];

  const remove = (id: string, control: Element) => { focusWhenGone(control, undefined, { preventScroll: true }); safeRun(async () => {
    const gone = await removeWorkout(id);
    if (!gone) return;
    useToast.getState().show('Treino apagado.', { label: 'Desfazer', run: () => safeRun(restoreWorkout(gone)) });
  }); };

  return (
    <section className="screen corpo stack" aria-labelledby="corpo-title">
      <Link href="/personagem" className="settings__back">‹ Personagem</Link>
      <h1 id="corpo-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Corpo</h1>

      <section className="stack" aria-labelledby="sono-title">
        <h2 id="sono-title" className="section-title">Sono</h2>
        {settings && !settings.noteDismissed && (
          <Panel variant="stone" className="corpo__note">
            <p>{SYMPTOMS_NOTE}</p>
            <Button size="sm" onClick={(e) => { focusWhenGone(e.currentTarget); safeRun(saveSleepSettings({ noteDismissed: true })); }}>
              Entendi
            </Button>
          </Panel>
        )}
        {sleep && (sleep.enough ? (
          <div className="corpo__observed">
            <p className="corpo__eyebrow">Observado nas últimas 14 noites</p>
            <dl className="corpo__stats">
              <div><dt>Duração média</dt><dd>{formatDuration(sleep.avgMinutes!)}</dd></div>
              <div><dt>Deitar</dt><dd>{spreadText(sleep.bed!)}<span className="corpo__range">{rangeText(sleep.bed!)}</span></dd></div>
              <div><dt>Acordar</dt><dd>{spreadText(sleep.wake!)}<span className="corpo__range">{rangeText(sleep.wake!)}</span></dd></div>
              <div><dt>Noites completas</dt><dd>{`${sleep.complete} de 14`}</dd></div>
              {qualityText && <div><dt>Qualidade percebida</dt><dd>{qualityText}</dd></div>}
            </dl>
          </div>
        ) : (
          <p className="muted">
            {`Com 3 noites completas (Deitei e Acordei), aparecem aqui os horários médios e quanto eles variam. Até agora: ${sleep.complete}.`}
          </p>
        ))}
        {sleep && !sleep.enough && qualityText && (
          <dl className="corpo__stats"><div><dt>Qualidade percebida</dt><dd>{qualityText}</dd></div></dl>
        )}
        <h3 className="corpo__subtitle">Últimas 14 noites</h3>
        {sleep && <SleepNights nights={sleep.nights} />}
        <div><Button onClick={() => useSleepSheet.getState().open()}>Registrar uma noite</Button></div>
        <details className="corpo__why">
          <summary>Por que olhar para isso?</summary>
          <p>
            Em estudantes universitários, horários de sono mais irregulares aparecem associados a notas mais baixas
            (Phillips et al., 2017). É uma associação, não prova de causa. Aqui vale como experimento pessoal: observar
            seus horários por algumas semanas e ver se o cansaço e o estudo mudam quando eles ficam mais parecidos.
          </p>
        </details>
      </section>

      <section className="stack" aria-labelledby="treino-title">
        <h2 id="treino-title" className="section-title">Treino</h2>
        <TrainingToday />
        {week && (week.total > 0 ? (
          <p className="corpo__week">
            {`${plural(week.total, 'treino', 'treinos')} · ${formatDuration(week.minutes)}`}
            <span className="corpo__range">{kindsText(week.byKind)}</span>
          </p>
        ) : <p className="muted">Nenhum treino nesta semana ainda.</p>)}
        <div><Button variant="primary" icon="heart" onClick={() => useWorkoutSheet.getState().open()}>Registrar treino</Button></div>
        <Panel variant="stone" className="corpo__minimum" role="region" aria-labelledby="cardio-min-title">
          <h3 id="cardio-min-title" className="corpo__subtitle">Versão mínima do cardio</h3>
          <p>Sem energia para o cardio? 10 min de caminhada leve ou bicicleta, em ritmo de conversa, já contam.</p>
          <div><Button size="sm" onClick={() => safeRun(logMinimumCardio())}>Fiz o cardio mínimo</Button></div>
          <p className="muted">Começar é a parte difícil: a versão mínima vale o mesmo XP.</p>
        </Panel>
        <h3 className="corpo__subtitle">Últimos 14 dias</h3>
        {recent.length === 0 ? (
          <p className="muted">Nenhum treino registrado nos últimos 14 dias.</p>
        ) : (
          <ul className="corpo__workouts" aria-label="Últimos 14 dias">
            {recent.map((w) => {
              const label = `${shortDay(w.day)} · ${WORKOUT_LABEL[w.kind]} · ${w.minutes} min${w.minimum ? ' · mínimo' : ''}`;
              return (
                <li key={w.id} className="corpo__workout">
                  <span>{label}</span>
                  <Button size="sm" variant="ghost" icon="trash"
                    aria-label={`Apagar treino: ${WORKOUT_LABEL[w.kind]}, ${w.minutes} min, ${shortDay(w.day)}`}
                    onClick={(e) => remove(w.id, e.currentTarget)} />
                </li>
              );
            })}
          </ul>
        )}
        <TrainingEvolution />
      </section>

      <NutritionSection />
    </section>
  );
}

