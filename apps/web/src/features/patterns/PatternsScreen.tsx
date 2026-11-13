import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import type { PeriodKind } from '@life/shared';
import { weekKey } from '@life/shared';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import '../settings/settings.css';
import { AssociationSection, HowCalculated } from './AssociationCards';
import { buildPatternsView, usePatternData } from './patternData';
import { MonthReflections } from './MonthReflections';
import { PostponeSection } from './PostponeSection';
import { TrendSection } from './TrendCards';
import { WeekExperimentContext } from './UseAsExperiment';
import { WatchNotice } from './WatchNotice';
import './patterns.css';

export const PATTERNS_PERIOD_KEY = 'life-rpg.patterns.period';
const LEGEND = 'Observado: o que os registros mostram. Hipótese: uma leitura possível, nunca certeza. Experimento: uma mudança pequena para testar por uma semana.';
const EMPTY = 'Os padrões aparecem com o uso. Depois de algumas semanas de blocos, revisões e registros, esta tela mostra tendências e associações. Nada aqui é nota.';

function readKind(): PeriodKind {
  try { return localStorage.getItem(PATTERNS_PERIOD_KEY) === 'month' ? 'month' : 'week'; } catch { return 'week'; }
}

/** "/padroes" (spec §5.2): observed trends, weeks 5–8, associations; everything from rules. */
export function PatternsScreen() {
  const [kind, setKind] = useState<PeriodKind>(readKind);
  const data = usePatternData();
  const view = useMemo(() => (data ? buildPatternsView(data, kind) : undefined), [data, kind]);
  const experiment = useMemo(() => {
    const w = data?.weeks.find((x) => x.id === weekKey(data.today));
    return { current: w?.experiment?.trim() || undefined };
  }, [data]);
  const choose = (k: PeriodKind) => {
    setKind(k);
    try { localStorage.setItem(PATTERNS_PERIOD_KEY, k); } catch { /* storage may be unavailable */ }
  };
  if (!view) return <section className="screen patterns" aria-busy="true" aria-label="Padrões" />;
  return (
    <WeekExperimentContext.Provider value={experiment}>
    <section className="screen patterns stack" aria-labelledby="patterns-title">
      <Link href="/personagem" className="settings__back">‹ Personagem</Link>
      <h1 id="patterns-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Padrões</h1>
      <p className="patterns__legend">{LEGEND}</p>
      {!view.hasData ? <Panel variant="stone"><p>{EMPTY}</p></Panel> : (
        <>
          {view.watch.map((n) => <WatchNotice key={n.key} notice={n} />)}
          <TrendSection view={view} kind={kind} onKind={choose} />
          <PostponeSection view={view} />
          <AssociationSection view={view} />
          <MonthReflections data={data!} />
          <HowCalculated />
        </>
      )}
    </section>
    </WeekExperimentContext.Provider>
  );
}
