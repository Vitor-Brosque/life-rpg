import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import type { PeriodKind } from '@life/shared';
import { dayIndex } from '@life/shared';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import '../settings/settings.css';
import { AssociationSection, HowCalculated } from './AssociationCards';
import { buildPatternsView, usePatternData } from './patternData';
import { MonthReflections } from './MonthReflections';
import { PlanVsDoneSection } from './PlanVsDoneSection';
import { PostponeSection } from './PostponeSection';
import { TrendSection } from './TrendCards';
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
  // The day index depends only on the data: toggling Semanas/Meses reuses it.
  const idx = useMemo(() => (data ? dayIndex(data) : undefined), [data]);
  const view = useMemo(() => (data && idx ? buildPatternsView(data, kind, idx) : undefined), [data, idx, kind]);
  const choose = (k: PeriodKind) => {
    setKind(k);
    try { localStorage.setItem(PATTERNS_PERIOD_KEY, k); } catch { /* storage may be unavailable */ }
  };
  if (!view) return <section className="screen patterns" aria-busy="true" aria-label="Padrões" />;
  return (
    <section className="screen patterns stack" aria-labelledby="patterns-title">
      <Link href="/personagem" className="settings__back">‹ Personagem</Link>
      <h1 id="patterns-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Padrões</h1>
      <p className="patterns__legend">{LEGEND}</p>
      {!view.hasData ? <Panel variant="stone"><p>{EMPTY}</p></Panel> : (
        <>
          {view.watch.map((n) => <WatchNotice key={n.key} notice={n} />)}
          <TrendSection view={view} kind={kind} onKind={choose} />
          <PlanVsDoneSection view={view} kind={kind} />
          <PostponeSection view={view} />
          <AssociationSection view={view} />
          <MonthReflections data={data!} />
          <HowCalculated />
        </>
      )}
    </section>
  );
}
