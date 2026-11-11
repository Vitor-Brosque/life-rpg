import { useState } from 'react';
import { BoardView } from './BoardView';
import { WeekView } from './WeekView';
import './plan.css';

type Tab = 'week' | 'board';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'week', label: 'Semana' },
  { id: 'board', label: 'Quadro' },
];
const KEY = 'life-rpg.plan.tab';

function readTab(): Tab {
  try { return localStorage.getItem(KEY) === 'board' ? 'board' : 'week'; } catch { return 'week'; }
}

/** Planejar: secondary views to arrange missions across days (week) or by state (board). */
export function PlanScreen() {
  const [tab, setTab] = useState<Tab>(readTab);
  const choose = (t: Tab) => {
    setTab(t);
    try { localStorage.setItem(KEY, t); } catch { /* storage may be unavailable */ }
  };
  return (
    <section className="screen plan stack">
      <h1>Planejar</h1>
      <div className="plan__tabs" role="tablist" aria-label="Visões do planejamento">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`plan-tab-${t.id}`} aria-selected={tab === t.id}
            aria-controls="plan-panel" className="plan__tab" onClick={() => choose(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div id="plan-panel" role="tabpanel" aria-labelledby={`plan-tab-${tab}`}>
        {tab === 'week' ? <WeekView /> : <BoardView />}
      </div>
    </section>
  );
}
