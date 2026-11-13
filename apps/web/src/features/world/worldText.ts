import type { Area, Territory, WorldModel, WorldNews } from '@life/shared';
import { STAGES, stageSummary } from '@life/shared';
import { OUTFIT_NAMES } from '../../art/palette';

// Text alternatives and copy of the world (spec §6). Pure: tested in worldText.test.ts.

type AreaRef = Pick<Area, 'id' | 'attribute'>;

const outfitName = (i: number): string => OUTFIT_NAMES[i] ?? 'nova';

/** The companion's celebration: one sentence per news, at most two, or undefined when none applies. */
export function celebrationText(news: readonly WorldNews[], areas: readonly AreaRef[]): string | undefined {
  const sentences: string[] = [];
  for (const n of news) {
    if (n.kind === 'outfit') {
      sentences.push(`Nova cor de roupa: ${outfitName(n.outfit)}. Ela já está em Editar aparência.`);
      continue;
    }
    const area = areas.find((a) => a.id === n.areaId);
    if (area) sentences.push(`O território de ${area.attribute} agora é ${STAGES[n.stage]!.a}!`);
  }
  if (sentences.length === 0) return undefined;
  if (sentences.length <= 2) return sentences.join(' ');
  return `${sentences.slice(0, 2).join(' ')} E há mais novidades no mapa.`;
}

/** One news for the Personagem card: "Vigor virou aldeia" / "Nova cor de roupa: Esmeralda". */
export function newsLine(n: WorldNews, areas: readonly AreaRef[]): string | undefined {
  if (n.kind === 'outfit') return `Nova cor de roupa: ${outfitName(n.outfit)}`;
  const area = areas.find((a) => a.id === n.areaId);
  return area ? `${area.attribute} virou ${STAGES[n.stage]!.one}` : undefined;
}

/** "Jornada “X”: 3 de 7 missões" / "…: 0 de 1 missão" / "…: sem missões ainda" (no closing period). */
export function journeyLine(j: { title: string; done: number; total: number }): string {
  if (j.total === 0) return `Jornada “${j.title}”: sem missões ainda`;
  return `Jornada “${j.title}”: ${j.done} de ${j.total} ${j.total === 1 ? 'missão' : 'missões'}`;
}

export function nextStageText(t: Pick<Territory, 'next'>): string {
  if (!t.next) return 'Estágio máximo. O castelo fica, mesmo nos dias parados.';
  return `Próximo estágio: ${STAGES[t.next.stage]!.name}, no nível ${t.next.level} (${t.next.xpLeft === 1 ? 'falta' : 'faltam'} ${t.next.xpLeft} XP)`;
}

export interface TerritoryFlags { avatarHere: boolean; talk: boolean; grew: boolean }

/** Accessible name of a territory on the map (and its full text in the list). */
export function territoryLabel(t: Territory, f: TerritoryFlags): string {
  const j = t.journeys[0];
  return [
    `${t.area.attribute}, ${t.area.name}: ${STAGES[t.stage]!.name}, nível ${t.level.level}.`,
    `${t.npc.name} (${t.npc.role}) ${f.talk ? 'tem um recado para hoje' : 'está aqui'}.`,
    ...(f.avatarHere ? ['Você está aqui.'] : []),
    ...(f.grew ? ['Cresceu nos últimos dias.'] : []),
    ...(j ? [`${journeyLine(j)}.`] : []),
  ].join(' ');
}

export function hubLabel(companionName: string, avatarHere: boolean): string {
  return `Encruzilhada, onde começam as estradas das jornadas. ${companionName} está aqui.${avatarHere ? ' Você está aqui.' : ''}`;
}

/** "Você está em Ofício · 7 territórios · 1 vila, 2 aldeias, 4 acampamentos". */
export function worldSummary(model: WorldModel): string {
  const here = model.territories.find((t) => t.area.id === model.avatar.areaId);
  const where = here ? `Você está em ${here.area.attribute}` : 'Você está na Encruzilhada';
  return `${where} · ${stageSummary(model.territories.map((t) => t.stage))}`;
}
