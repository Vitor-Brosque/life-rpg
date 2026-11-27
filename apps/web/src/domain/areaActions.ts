import type { Area, ID } from '@life/shared';
import { db } from '../db/db';
import { newRecord, patch, put } from '../db/repo';

/** Area colours offered in Ajustes (the seed areas use the first six). */
export const AREA_COLORS: Array<{ color: string; name: string }> = [
  { color: '#e5675d', name: 'Vermelho' },
  { color: '#7fb7e6', name: 'Azul' },
  { color: '#a98be0', name: 'Lilás' },
  { color: '#e0a84a', name: 'Âmbar' },
  { color: '#6fbf8a', name: 'Verde' },
  { color: '#e68fb5', name: 'Rosa' },
  { color: '#5fc7c0', name: 'Turquesa' },
  { color: '#f08a4b', name: 'Laranja' },
  { color: '#c9a27e', name: 'Areia' },
  { color: '#9aa6b8', name: 'Cinza' },
];

/** "Adicionar área" (Ajustes) and a proposal's new area: the first colour no live area uses, after every other area. */
export async function createArea(name: string, attribute: string): Promise<Area> {
  const areas = (await db.areas.toArray()).filter((a) => !a.deleted);
  const used = new Set(areas.filter((a) => !a.archived).map((a) => a.color.toLowerCase()));
  const color = AREA_COLORS.find((c) => !used.has(c.color))?.color ?? AREA_COLORS[0]!.color;
  const order = areas.reduce((mx, a) => Math.max(mx, a.order + 1), 0);
  return put('areas', newRecord<Area>({ name: name.trim(), attribute: attribute.trim(), color, icon: 'star', order, archived: false }));
}

export const renameArea = (id: ID, name: string): Promise<Area> => patch<Area>('areas', id, { name: name.trim() });
