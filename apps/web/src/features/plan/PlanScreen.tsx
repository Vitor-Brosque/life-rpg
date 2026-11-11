import { useState, type KeyboardEvent } from 'react';
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
  // Tab pattern: one stop in the Tab order; arrows (wrapping), Home and End switch views.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length
      : e.key === 'ArrowLeft' ? (i - 1 + TABS.length) % TABS.length
        : e.key === 'Home' ? 0
          : e.key === 'End' ? TABS.length - 1
            : -1;
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
        {tab === 'week' ? <WeekView /> : <BoardView />}
      </div>
    </section>
  );
}
