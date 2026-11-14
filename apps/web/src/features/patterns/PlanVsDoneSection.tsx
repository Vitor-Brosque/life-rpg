import type { AreaMinutes, PeriodKind } from '@life/shared';
import { formatDuration } from '../../ui/format';
import { DAY_MODE_LABEL } from '../agora/DayTypeCard';
import { shortDay } from '../corpo/corpoFormat';
import { EvidenceLine } from './Evidence';
import { MiniBars } from './MiniBars';
import type { PatternsView } from './patternData';
import { planVsDoneSeries, planVsDoneText } from './patternText';

const areaLine = (a: AreaMinutes): string => a.plannedMin > 0
  ? `${a.name}: ${formatDuration(a.executedMin)} executados de ${formatDuration(a.plannedMin)} planejados`
  : `${a.name}: ${formatDuration(a.executedMin)} executados, sem bloco planejado`;

/** "Planejado × executado" (Acompanhamento D): minutes per period and area, only from days with a recorded plan. */
export function PlanVsDoneSection({ view, kind }: { view: PatternsView; kind: PeriodKind }) {
  const points = view.planVsDone;
  const total = points.reduce((s, p) => s + p.daysWithPlan, 0);
  const areas = new Map<string, AreaMinutes>();
  for (const p of points) {
    for (const a of p.areas) {
      const cur = areas.get(a.key);
      if (cur) { cur.plannedMin += a.plannedMin; cur.executedMin += a.executedMin; }
      else areas.set(a.key, { ...a });
    }
  }
  const rows = [...areas.values()].sort(
    (a, b) => b.plannedMin - a.plannedMin || b.executedMin - a.executedMin || a.name.localeCompare(b.name, 'pt-BR'));
  const days = points.flatMap((p) => p.days).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  return (
    <section className="plan-done stack" aria-labelledby="plan-done-title">
      <h2 id="plan-done-title" className="section-title">Planejado × executado</h2>
      <EvidenceLine kind="observado">{planVsDoneText(points, kind)}</EvidenceLine>
      {total > 0 && (
        <>
          <MiniBars values={points.map((p) => p.executedMin)} background={points.map((p) => p.plannedMin)}
            labels={points.map((p) => p.period.label)} atypical={points.map((p) => p.atypical === true)} />
          <p className="plan-done__caption">Barra clara: planejado. Barra cheia: executado.</p>
          <p className="visually-hidden">{planVsDoneSeries(points, kind)}</p>
          <h3>Por área</h3>
          <ul className="plan-done__areas">{rows.map((a) => <li key={a.key}>{areaLine(a)}</li>)}</ul>
          <details className="patterns__details">
            <summary>Ver dias</summary>
            <ul className="plan-done__days">
              {days.map((d) => (
                <li key={d.day}>
                  {`${shortDay(d.day)}${d.mode !== 'normal' ? ` (${DAY_MODE_LABEL[d.mode]})` : ''}: ${formatDuration(d.executedMin)} de ${formatDuration(d.plannedMin)}`}
                  <ul className="plan-done__day-areas">{d.areas.map((a) => <li key={a.key}>{areaLine(a)}</li>)}</ul>
                </li>
              ))}
            </ul>
          </details>
          <p className="muted">{`dias com plano registrado: ${total}`}</p>
        </>
      )}
    </section>
  );
}
