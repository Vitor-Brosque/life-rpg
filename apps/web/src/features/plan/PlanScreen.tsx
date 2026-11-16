import { useEffect, useState, type KeyboardEvent } from 'react';
import { useSearch } from 'wouter';
import { tabKeyTarget } from '../../ui/tabKeys';
import { CasaView } from '../casa/CasaView';
import { JourneysView } from '../journeys/JourneysView';
import { RoutineScreen } from '../routine/RoutineScreen';
import { BoardView } from './BoardView';
import { WeekView } from './WeekView';
import './plan.css';

type Tab = 'week' | 'board' | 'routine' | 'journeys' | 'casa';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'week', label: 'Semana' },
  { id: 'board', label: 'Quadro' },
  { id: 'routine', label: 'Rotina' },
  { id: 'journeys', label: 'Jornadas' },
  { id: 'casa', label: 'Casa' },
];
const KEY = 'life-rpg.plan.tab';

/** `?aba=` values (links back from /casa/…, /jornadas and a journey). */
const ABA: Record<string, Tab> = { semana: 'week', quadro: 'board', rotina: 'routine', jornadas: 'journeys', casa: 'casa' };

function readTab(search: string): Tab {
  const asked = ABA[new URLSearchParams(search).get('aba') ?? ''];
  if (asked) {
    try { localStorage.setItem(KEY, asked); } catch { /* storage may be unavailable */ }
    return asked;
  }
  try {
    const saved = localStorage.getItem(KEY);
    return TABS.find((t) => t.id === saved)?.id ?? 'week';
  } catch { return 'week'; }
}

/** Planejar: missions across days (week) or by state (board), the block routine, the journeys and the house. */
export function PlanScreen() {
  const search = useSearch();
  const [tab, setTab] = useState<Tab>(() => readTab(search));
  // A link with `?aba=` while Planejar is already open switches the view too.
  useEffect(() => {
    const asked = ABA[new URLSearchParams(search).get('aba') ?? ''];
    if (asked) setTab(asked);
  }, [search]);
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
        {tab === 'week' ? <WeekView /> : tab === 'board' ? <BoardView /> : tab === 'routine' ? <RoutineScreen />
          : tab === 'journeys' ? <JourneysView /> : <CasaView />}
      </div>
    </section>
  );
}
