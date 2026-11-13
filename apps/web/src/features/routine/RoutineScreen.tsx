import { useState } from 'react';
import type { Block } from '@life/shared';
import { weekdayOf } from '@life/shared';
import { useAreas, useJourneys, useRoutineBlocks, useSettings, useToday } from '../../db/hooks';
import { Button } from '../../ui/Button';
import { BlockSheet } from './BlockSheet';
import { CopyDaySheet } from './CopyDaySheet';
import { RecurringSection } from './RecurringSection';
import { RoutineEditor } from './RoutineEditor';
import { RoutineSetup } from './RoutineSetup';
import './routine.css';

const SKIP_KEY = 'life-rpg.routine.skipSetup';

function readSkip(): boolean {
  try { return localStorage.getItem(SKIP_KEY) === '1'; } catch { return false; }
}
function writeSkip(): void {
  try { localStorage.setItem(SKIP_KEY, '1'); } catch { /* storage may be unavailable */ }
}

type SheetState = { kind: 'block'; block?: Block } | { kind: 'copy' };

/**
 * Planejar → Rotina (§7). With no routine yet it asks one question and previews the suggested
 * routine; otherwise it is the block editor (weekday tabs, cards, "+ Bloco", "Copiar este dia para…").
 */
export function RoutineScreen() {
  const all = useRoutineBlocks();
  const today = useToday();
  const settings = useSettings();
  const areas = useAreas();
  const journeys = useJourneys();
  const [skipped, setSkipped] = useState(readSkip);
  const [setupOpen, setSetupOpen] = useState(false);
  const [picked, setPicked] = useState<number>();
  const [sheet, setSheet] = useState<SheetState>();

  if (!all || !today) return <p className="muted">Carregando…</p>;
  const blocks = all.filter((b) => !b.archived);
  const todayWeekday = weekdayOf(today);
  const weekday = picked ?? todayWeekday;
  const close = () => setSheet(undefined);
  const sheets = (
    <>
      <BlockSheet open={sheet?.kind === 'block'} block={sheet?.kind === 'block' ? sheet.block : undefined}
        weekday={weekday} onClose={close} />
      <CopyDaySheet open={sheet?.kind === 'copy'} weekday={weekday} onClose={close} />
    </>
  );

  if (setupOpen || (all.length === 0 && !skipped)) {
    return (
      <RoutineSetup
        onSkip={() => { writeSkip(); setSkipped(true); setSetupOpen(false); }}
        onCreated={() => setSetupOpen(false)}
      />
    );
  }

  if (blocks.length === 0) {
    return (
      <div className="routine routine--empty stack">
        <p className="day-box__empty">
          Sem rotina por enquanto. A sugerida monta segunda a sexta a partir da hora em que você começa o dia.
        </p>
        <div className="routine__actions">
          <Button variant="primary" icon="calendar" onClick={() => setSetupOpen(true)}>Criar rotina sugerida</Button>
          <Button icon="plus" aria-label="Novo bloco" onClick={() => setSheet({ kind: 'block' })}>Bloco</Button>
        </div>
        <RecurringSection today={today} />
        {sheets}
      </div>
    );
  }

  return (
    <>
      <RoutineEditor
        blocks={blocks}
        areas={areas}
        journeys={journeys}
        weekday={weekday}
        todayWeekday={todayWeekday}
        dayStartHour={settings?.dayStartHour ?? 4}
        onWeekday={setPicked}
        onOpen={(block) => setSheet({ kind: 'block', block })}
        onAdd={() => setSheet({ kind: 'block' })}
        onCopy={() => setSheet({ kind: 'copy' })}
      />
      <RecurringSection today={today} />
      {sheets}
    </>
  );
}
