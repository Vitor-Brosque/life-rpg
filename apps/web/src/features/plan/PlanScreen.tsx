import { useState, type KeyboardEvent } from 'react';
import { tabKeyTarget } from '../../ui/tabKeys';
import { RoutineScreen } from '../routine/RoutineScreen';
import { BoardView } from './BoardView';
import { WeekView } from './WeekView';
import './plan.css';

type Tab = 'week' | 'board' | 'routine';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'week', label: 'Semana' },
  { id: 'board', label: 'Quadro' },
  { id: 'routine', label: 'Rotina' },
];
const KEY = 'life-rpg.plan.tab';

function readTab(): Tab {
  try {
    const saved = localStorage.getItem(KEY);
    return TABS.find((t) => t.id === saved)?.id ?? 'week';
  } catch { return 'week'; }
}

/** Planejar: missions across days (week) or by state (board), and the block routine. */
export function PlanScreen() {
  const [tab, setTab] = useState<Tab>(readTab);
  const choose = (t: Tab) => {
    setTab(t);
    try { localStorage.setItem(KEY, t); } catch { /* storage may be unavailable */ }
  };
  // Tab pattern: one stop in the Tab order; arrows (wrapping), Home and End switch views.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = tabKeyTarget(e.key, TABS.findIndex((t) => t.id === tab), TABS.length);
    if (next < 0) return;
    e.preventDefault();
    const id = TABS[next]!.id;
    choose(id);
    document.getElementById(`plan-tab-${id}`)?.focus();
  };
  return (
    <section className="screen plan stack">
      <h1>Planejar</h1>
      <div className="plan__tabs" role="tablist" aria-label="Visões do planejamento" onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`plan-tab-${t.id}`} aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1} aria-controls="plan-panel" className="plan__tab" onClick={() => choose(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div id="plan-panel" role="tabpanel" aria-labelledby={`plan-tab-${tab}`}>
        {tab === 'week' ? <WeekView /> : tab === 'board' ? <BoardView /> : <RoutineScreen />}
      </div>
    </section>
  );
}
