import { useId } from 'react';
import type { PracticeSession } from '@life/shared';
import { hintCount, historySessions, practiceHistory } from '@life/shared';
import { Panel } from '../../ui/Panel';

/** "Observado · suas autoavaliações" (spec §5.5.1): one row per indicator, never a total. */
export function PracticeHistory({ sessions }: { sessions: readonly PracticeSession[] }) {
  const titleId = useId();
  const h = practiceHistory(sessions);
  if (h.count < 2) return null;
  const hints = historySessions(sessions).reduce((n, s) => n + hintCount(s), 0);
  return (
    <Panel variant="stone" className="study-section practice-history" role="region" aria-labelledby={titleId}>
      <h2 id={titleId} className="study__subtitle">Observado · suas autoavaliações</h2>
      <ul className="practice-history__rows">
        {h.series.map((s) => (
          <li key={s.key} className="practice-history__row">
            <span className="practice-history__label">{s.label}</span>
            <span className="practice-history__bars" aria-hidden="true">
              {s.values.map((v, i) => <span key={i} className={`practice-history__bar practice-history__bar--v${v}`} />)}
            </span>
            <span className="practice-history__summary">{s.summary}</span>
            <span className="visually-hidden">Da mais antiga para a mais recente: {s.values.join(', ')}.</span>
          </li>
        ))}
      </ul>
      <p className="practice-history__hints">{hints === 0 ? `Nenhuma pista nas últimas ${h.count} sessões.` : `Pistas: ${hints} nas últimas ${h.count} sessões.`}</p>
      <p className="practice-history__legend">Pista é parte do método; o que importa é o Autônomo nas reconstruções.</p>
      <p className="practice-history__legend">
        Cada barra é uma sessão encerrada. São autoavaliações, não notas: servem para ver tendência. Os três ficam separados de propósito.
      </p>
    </Panel>
  );
}
