import { useId } from 'react';
import { DIM_TITLE, HYPOTHESIS_MIN_POSTPONED, POSTPONE_DIMS } from '@life/shared';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { useMissionSheet } from '../mission/MissionSheet';
import { EvidenceLine } from './Evidence';
import type { PatternsView } from './patternData';
import { bucketLine, hypothesisGateText, postponeTotalsText } from './patternText';
import { UseAsExperiment } from './UseAsExperiment';

const MISSIONS_SHOWN = 5;

const openMission = (id: string) => safeRun(() => useMissionSheet.getState().open(id));

/** "Adiamentos" (spec §5.4): what was observed, the groups, and hypotheses that stay hypotheses. */
export function PostponeSection({ view }: { view: PatternsView }) {
  const titleId = useId();
  const missionsId = useId();
  const hypId = useId();
  const pastId = useId();
  const { postpone, hypotheses, pastExperiments } = view;
  const missions = postpone.missions.slice(0, MISSIONS_SHOWN);
  const anyEvent = postpone.postponed + postpone.started + postpone.shrunk + postpone.dropped > 0;
  const dims = POSTPONE_DIMS.filter((d) => postpone.byDim[d].length > 0);

  return (
    <section className="postpone stack" aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">Adiamentos</h2>
      <EvidenceLine kind="observado">{postponeTotalsText(postpone)}</EvidenceLine>

      {missions.length > 0 && (
        <section aria-labelledby={missionsId}>
          <h3 id={missionsId}>Mais adiadas</h3>
          <ul className="postpone__missions">
            {missions.map((m) => (
              <li key={m.missionId}>
                <Button
                  size="sm" variant="ghost"
                  aria-label={`Abrir missão: ${m.title}, adiada ${m.postponed} vezes`}
                  onClick={() => openMission(m.missionId)}
                >
                  {`${m.title} · ${m.postponed}×`}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {anyEvent && dims.length > 0 && (
        <details className="patterns__details">
          <summary>Por esforço, área, parte do dia, dia da semana e tipo do dia</summary>
          {dims.map((d) => (
            <div key={d}>
              <h4 className="postpone__dim">{DIM_TITLE[d]}</h4>
              <ul className="postpone__buckets">
                {postpone.byDim[d].map((b) => <li key={b.key}>{bucketLine(b)}</li>)}
              </ul>
            </div>
          ))}
        </details>
      )}

      <section aria-labelledby={hypId}>
        <h3 id={hypId}>Hipóteses e experimentos</h3>
        {hypotheses.length > 0 ? (
          <>
            {hypotheses.map((h) => (
              <article key={h.id} className="hypothesis px-border" aria-label={h.text}>
                <EvidenceLine kind="hipotese">{h.text}</EvidenceLine>
                <EvidenceLine kind="observado">{h.basis}</EvidenceLine>
                <EvidenceLine kind="experimento">{h.experiment}</EvidenceLine>
                <div className="hypothesis__actions">
                  <UseAsExperiment text={h.experiment} />
                  {h.missionId && (
                    <Button size="sm" variant="ghost" onClick={() => openMission(h.missionId!)}>Abrir missão</Button>
                  )}
                </div>
              </article>
            ))}
            <p className="muted">Hipóteses vêm de contagens de 4 semanas: podem ser acaso e mostram associação, não causa. Você decide se vale testar.</p>
          </>
        ) : (
          <p className="muted">{postpone.postponed < HYPOTHESIS_MIN_POSTPONED
            ? hypothesisGateText(postpone.postponed)
            : 'Nenhum padrão forte o bastante para virar hipótese. Isso também é informação.'}</p>
        )}
      </section>

      {pastExperiments.length > 0 && (
        <section aria-labelledby={pastId}>
          <h3 id={pastId}>Experimentos anteriores</h3>
          <ul className="postpone__past">
            {pastExperiments.map((p) => (
              <li key={p.week}>
                <p>{`Semana de ${p.label}: ${p.experiment}`}</p>
                {p.planned > 0 && <p className="muted">{`Blocos iniciados: ${p.started} de ${p.planned}.`}</p>}
              </li>
            ))}
          </ul>
          <p className="muted">Uma semana é pouco para concluir: compare com calma.</p>
        </section>
      )}
    </section>
  );
}
