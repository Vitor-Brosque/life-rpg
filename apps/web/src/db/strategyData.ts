import { useLiveQuery } from 'dexie-react-hooks';
import type { DayKey, ID, Strategy } from '@life/shared';
import { legacyExperiment, strategyLine, strategyLinkValue, testingStrategies } from '@life/shared';
import { db } from './db';

// Estratégias: reading only (opening a screen never writes).

/** Every strategy not deleted for good (the ones in "Apagadas recentemente" included: the rules pick). */
export function useStrategies(): Strategy[] | undefined {
  return useLiveQuery(async () => (await db.strategies.toArray()).filter((s) => !s.deleted));
}

export interface StrategyLinks {
  /** Live, unarchived blocks, one per name (the first in routine order). */
  blocks: Array<{ id: ID; name: string }>;
  /** Active journeys (the subjects included), in their order. */
  journeys: Array<{ id: ID; title: string }>;
  /** strategyLinkValue → name, for every live block and journey (archived and finished included). */
  names: Record<string, string>;
}

const nameKey = (name: string): string => name.trim().toLocaleLowerCase('pt-BR');

/** The "Ligar a" options and the names of every link. */
export function useStrategyLinks(): StrategyLinks | undefined {
  return useLiveQuery(async () => {
    const [blocks, journeys] = await Promise.all([db.blocks.toArray(), db.journeys.toArray()]);
    const names: Record<string, string> = {};
    for (const b of blocks) if (!b.deleted) names[strategyLinkValue({ kind: 'block', id: b.id })] = b.name.trim();
    for (const j of journeys) if (!j.deleted) names[strategyLinkValue({ kind: 'journey', id: j.id })] = j.title.trim();
    const seen = new Set<string>();
    const options = blocks
      .filter((b) => !b.deleted && !b.archived)
      .sort((a, b) => a.order - b.order || a.targetStart.localeCompare(b.targetStart))
      .filter((b) => !seen.has(nameKey(b.name)) && seen.add(nameKey(b.name)) !== undefined)
      .map((b) => ({ id: b.id, name: b.name.trim() }));
    return {
      blocks: options,
      journeys: journeys.filter((j) => !j.deleted && j.status === 'active').sort((a, b) => a.order - b.order)
        .map((j) => ({ id: j.id, title: j.title.trim() })),
      names,
    };
  });
}

/**
 * The texts of the line under the status strip (Agora and Painel): the testing strategies ("Estratégias em teste: …")
 * and the week's old experiment unless a strategy has its title. While the strategies load, the old experiment shows as
 * it always did (it comes with the week record) and the strategies line waits.
 */
export function useWeekLineTexts(today: DayKey | undefined, experiment: string | undefined): { strategies?: string; experiment?: string } {
  const list = useStrategies();
  if (!today) return {};
  const strategies = list ? strategyLine(testingStrategies(list, today).map((s) => s.title)) : undefined;
  const legacy = legacyExperiment(experiment, list ?? []);
  return { ...(strategies ? { strategies } : {}), ...(legacy ? { experiment: legacy } : {}) };
}
