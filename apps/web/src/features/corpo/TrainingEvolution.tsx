import { Link } from 'wouter';
import type { DayKey } from '@life/shared';
import { cardioWeeks, discomfortText, exerciseHistory, setsRirText, setsText } from '@life/shared';
import { useTrainingLogs, useWorkouts } from '../../db/corpoData';
import { useToday } from '../../db/hooks';
import { formatDuration, plural } from '../../ui/format';
import { EvidenceLine } from '../patterns/Evidence';
import { MiniBars } from '../patterns/MiniBars';

const ddmm = (day: DayKey): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const kgText = (kg: number): string => String(kg).replace('.', ',');

/** "Evolução por exercício" and "Cardio por semana": observed only, no records, targets or colour. */
export function TrainingEvolution() {
  const today = useToday();
  const logs = useTrainingLogs();
  const workouts = useWorkouts();
  if (!today) return null;
  const history = logs ? exerciseHistory(logs, today) : [];
  const weeks = workouts ? cardioWeeks(workouts, today) : [];
  const total = weeks.reduce((s, w) => s + w.sessions, 0);
  const minutes = weeks.reduce((s, w) => s + w.minutes, 0);

  return (
    <>
      <h3 className="corpo__subtitle">Evolução por exercício</h3>
      {history.length === 0 ? (
        <p className="muted">A evolução aparece depois do primeiro treino com séries registradas.</p>
      ) : (
        <>
          <EvidenceLine kind="observado">Melhor série e volume das últimas sessões de cada exercício.</EvidenceLine>
          {history.map((h) => {
            const last = h.sessions[h.sessions.length - 1]!;
            return (
              <details key={h.key} className="corpo__why training-evo">
                <summary>{`${h.name} · ${plural(h.sessions.length, 'sessão', 'sessões')} · última ${ddmm(last.day)}`}</summary>
                <MiniBars values={h.sessions.map((s) => s.best?.kg)} labels={h.sessions.map((s) => ddmm(s.day))} />
                <ul className="training-evo__list">
                  {[...h.sessions].reverse().map((s) => (
                    <li key={s.day}>
                      <span>
                        {s.best
                          ? `${ddmm(s.day)}: melhor ${kgText(s.best.kg)} kg × ${s.best.reps} · volume ${s.volume.toLocaleString('pt-BR')} kg`
                          : `${ddmm(s.day)}: ${setsText(s.sets)} (sem carga)`}
                        {setsRirText(s.sets) && ` · ${setsRirText(s.sets)}`}
                        {s.discomfort && <span className="training-evo__discomfort">{` · ${discomfortText(s.discomfort)}`}</span>}
                      </span>
                      {' '}
                      <Link href={`/corpo/treino?dia=${s.day}`} className="body-card__link" aria-label={`Ver o treino de ${ddmm(s.day)}`}>Ver dia</Link>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </>
      )}

      <h3 className="corpo__subtitle">Cardio por semana</h3>
      <EvidenceLine kind="observado">
        {total === 0
          ? 'Nenhum cardio nas últimas 8 semanas completas.'
          : `Últimas 8 semanas completas: ${plural(total, 'sessão', 'sessões')}, ${formatDuration(minutes)} de cardio.`}
      </EvidenceLine>
      <MiniBars values={weeks.map((w) => w.minutes)} labels={weeks.map((w) => w.period.label)} />
      <p className="visually-hidden">
        {`Por semana, da mais antiga para a mais recente: ${weeks.map((w) => `${w.period.label}: ${plural(w.sessions, 'sessão', 'sessões')}, ${formatDuration(w.minutes)}`).join('; ')}.`}
      </p>
    </>
  );
}
