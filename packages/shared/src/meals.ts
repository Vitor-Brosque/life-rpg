import type { DayKey, FreezerMove, ID, MealKind, Menu, MenuSlot, Recipe, ShoppingList } from './types';
import { addDays, dayKeyOf, weekdayOf } from './dates';
import { normalize } from './parser';
import { weekKey } from './weekStats';

// Casa (Marco 4, spec §5): weekly menu, shopping list, batch prep and the freezer. Pure rules.

export const MEALS: readonly MealKind[] = ['almoco', 'jantar'];
export const MEAL_LABEL: Record<MealKind, string> = { almoco: 'Almoço', jantar: 'Jantar' };
export const MEALPREP_XP = 10;
/** Fewer portions than this (after at least one batch prep) brings the gentle prep suggestion. */
export const FREEZER_LOW = 3;
export const PREP_MAX_PORTIONS = 30;
export const RECIPE_NAME_MAX = 60;
export const INGREDIENT_MAX = 80;
export const MAX_INGREDIENTS = 40;
export const SHOPPING_TEXT_MAX = 80;
/** Lunch is the meal from 10:00 to 16:00; dinner from 17:00 until the logical day ends. */
export const LUNCH_FROM = 10 * 60;
export const LUNCH_UNTIL = 16 * 60;
export const DINNER_FROM = 17 * 60;

export const menuId = (week: DayKey): ID => `menu-${week}`;
export const shoppingListId = (week: DayKey): ID => `shop-${week}`;
export const prepMissionId = (week: DayKey): ID => `prep-${week}`;
export const mealprepXpId = (day: DayKey): ID => `xp-mealprep-${day}`;

/** The week the Casa tab opens on: this week from Monday to Friday, next week on Saturday and Sunday. */
export function planningWeek(today: DayKey): DayKey {
  const wd = weekdayOf(today);
  return wd === 0 || wd === 6 ? addDays(weekKey(today), 7) : weekKey(today);
}

/** The seven days of the week that starts on `week` (a Monday). */
export const weekDays = (week: DayKey): DayKey[] => Array.from({ length: 7 }, (_, i) => addDays(week, i));

/** Key that merges ingredients and names: no accents, lower case, single spaces. */
export function ingredientKey(text: string): string {
  return normalize(text).trim().replace(/\s+/g, ' ');
}

/** Same cleaning as a recipe name or a list item: trimmed, single spaces, at most `max` characters. */
export function cleanText(text: string, max: number): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, max).trim();
}

/**
 * The ingredients typed in the recipe editor, one per line: list markers ("- ", "* ", "• ", "1. ")
 * removed, blank lines and repeated keys dropped, each line ≤ 80 characters, at most 40 lines.
 */
export function parseIngredients(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = cleanText(raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, ''), INGREDIENT_MAX);
    const key = ingredientKey(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length === MAX_INGREDIENTS) break;
  }
  return out;
}

const mealOrder = (m: MealKind): number => MEALS.indexOf(m);
const bySlot = (a: MenuSlot, b: MenuSlot): number =>
  (a.day < b.day ? -1 : a.day > b.day ? 1 : mealOrder(a.meal) - mealOrder(b.meal));

export function slotOf(menu: Pick<Menu, 'slots'> | undefined, day: DayKey, meal: MealKind): MenuSlot | undefined {
  return menu?.slots.find((s) => s.day === day && s.meal === meal);
}

/** The slots with (day, meal) set to `recipeId`, or cleared with null; sorted by day, then meal. */
export function setSlot(slots: readonly MenuSlot[], day: DayKey, meal: MealKind, recipeId: ID | null): MenuSlot[] {
  const rest = slots.filter((s) => !(s.day === day && s.meal === meal));
  return (recipeId ? [...rest, { day, meal, recipeId }] : rest).sort(bySlot);
}

/** "Repetir a semana anterior": the same slots `days` later. */
export function shiftSlots(slots: readonly MenuSlot[], days: number): MenuSlot[] {
  return slots.map((s) => ({ ...s, day: addDays(s.day, days) })).sort(bySlot);
}

export interface DishCount { recipeId: ID; name: string; count: number }

/**
 * Each recipe in the menu with how many meals use it, most used first (then by name). A slot whose
 * recipe is unknown is skipped; a soft-deleted recipe still counts (the menu keeps what was chosen).
 */
export function dishCounts(menu: Pick<Menu, 'slots'> | undefined, recipes: readonly Recipe[]): DishCount[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const counts = new Map<ID, number>();
  for (const s of menu?.slots ?? []) if (byId.has(s.recipeId)) counts.set(s.recipeId, (counts.get(s.recipeId) ?? 0) + 1);
  return [...counts.entries()]
    .map(([recipeId, count]) => ({ recipeId, name: byId.get(recipeId)!.name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));
}

export interface ShoppingRow {
  key: string;          // `g:${ingredientKey}` or `m:${item.id}`
  text: string;
  from: string[];       // names of the dishes that need it (generated rows)
  manualId?: ID;
  checked: boolean;
}

/**
 * The week's shopping list: the ingredients of every distinct dish in the menu (once per dish,
 * merged by ingredientKey, first spelling kept), in alphabetical order, then the manual items in
 * the order they were added. Checked rows go to the end, in the same order.
 */
export function shoppingRows(input: {
  menu?: Pick<Menu, 'slots'>; recipes: readonly Recipe[]; list?: Pick<ShoppingList, 'manual' | 'checked'>;
}): ShoppingRow[] {
  const checked = new Set(input.list?.checked ?? []);
  const byId = new Map(input.recipes.map((r) => [r.id, r]));
  const generated = new Map<string, ShoppingRow>();
  for (const dish of dishCounts(input.menu, input.recipes)) {
    const recipe = byId.get(dish.recipeId)!;
    for (const text of recipe.ingredients) {
      const k = ingredientKey(text);
      if (!k) continue;
      const key = `g:${k}`;
      const row = generated.get(key);
      if (!row) generated.set(key, { key, text, from: [recipe.name], checked: checked.has(key) });
      else if (!row.from.includes(recipe.name)) row.from.push(recipe.name);
    }
  }
  const rows = [
    ...[...generated.values()].sort((a, b) => a.text.localeCompare(b.text, 'pt-BR')),
    ...(input.list?.manual ?? []).map((m): ShoppingRow => ({
      key: `m:${m.id}`, text: m.text, from: [], manualId: m.id, checked: checked.has(`m:${m.id}`),
    })),
  ];
  return [...rows.filter((r) => !r.checked), ...rows.filter((r) => r.checked)];
}

export interface StockRow { recipeId: ID; portions: number }

/** Portions per dish: the sum of the live moves, only dishes with more than zero, most first. */
export function freezerStock(moves: readonly FreezerMove[]): StockRow[] {
  const sums = new Map<ID, number>();
  for (const m of moves) if (!m.deleted) sums.set(m.recipeId, (sums.get(m.recipeId) ?? 0) + m.delta);
  return [...sums.entries()]
    .filter(([, n]) => n > 0)
    .map(([recipeId, portions]) => ({ recipeId, portions }))
    .sort((a, b) => b.portions - a.portions || (a.recipeId < b.recipeId ? -1 : a.recipeId > b.recipeId ? 1 : 0));
}

/** The raw sum of a dish's live moves (may be ≤ 0): "Ajustar" writes the difference to the target. */
export function rawPortions(moves: readonly FreezerMove[], recipeId: ID): number {
  return moves.reduce((s, m) => (!m.deleted && m.recipeId === recipeId ? s + m.delta : s), 0);
}

export const portionsOf = (stock: readonly StockRow[], recipeId: ID): number =>
  stock.find((s) => s.recipeId === recipeId)?.portions ?? 0;

export const freezerTotal = (stock: readonly StockRow[]): number => stock.reduce((s, r) => s + r.portions, 0);

/** Gentle prep suggestion: fewer than 3 portions, once the freezer was ever filled by a batch prep. */
export function freezerLow(stock: readonly StockRow[], moves: readonly FreezerMove[]): boolean {
  return freezerTotal(stock) < FREEZER_LOW && moves.some((m) => !m.deleted && m.kind === 'prep');
}

export interface PrepHint { recipeId: ID; name: string; planned: number; inFreezer: number }

/** The week's dishes for the prep sheet, with how many meals plan them and how many are frozen. */
export function prepHints(menu: Pick<Menu, 'slots'> | undefined, recipes: readonly Recipe[], stock: readonly StockRow[]): PrepHint[] {
  return dishCounts(menu, recipes).map((d) => ({
    recipeId: d.recipeId, name: d.name, planned: d.count, inFreezer: portionsOf(stock, d.recipeId),
  }));
}

/** Lunch from 10:00 to 16:00, dinner from 17:00 until `dayStartHour`; otherwise no meal. */
export function currentMeal(now: number, dayStartHour: number): MealKind | undefined {
  const d = new Date(now);
  const m = d.getHours() * 60 + d.getMinutes();
  if (m >= LUNCH_FROM && m < LUNCH_UNTIL) return 'almoco';
  if (m >= DINNER_FROM || m < dayStartHour * 60) return 'jantar';
  return undefined;
}

export interface MealNow {
  day: DayKey;          // logical day
  meal: MealKind;
  recipeId: ID;
  name: string;
  portions: number;     // in the freezer
  eaten: boolean;       // "Comi uma" already tapped for this meal
}

/** The planned dish of the current meal (menu of the logical day's week), when there is one. */
export function mealNow(input: {
  now: number; dayStartHour: number; menu?: Pick<Menu, 'slots'>; recipes: readonly Recipe[]; moves: readonly FreezerMove[];
}): MealNow | undefined {
  const meal = currentMeal(input.now, input.dayStartHour);
  if (!meal) return undefined;
  const day = dayKeyOf(input.now, input.dayStartHour);
  const slot = slotOf(input.menu, day, meal);
  const recipe = slot ? input.recipes.find((r) => r.id === slot.recipeId) : undefined;
  if (!recipe) return undefined;
  return {
    day, meal, recipeId: recipe.id, name: recipe.name,
    portions: portionsOf(freezerStock(input.moves), recipe.id),
    eaten: input.moves.some((m) => !m.deleted && m.kind === 'eat' && m.day === day && m.meal === meal),
  };
}
