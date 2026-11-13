import type {
  BaseRecord, DayKey, FreezerMove, ID, LifeEvent, MealKind, Menu, Mission, MissionStatus, Recipe, ShoppingItem,
  ShoppingList, SyncTable, XpEvent,
} from '@life/shared';
import {
  MEALPREP_XP, PREP_MAX_PORTIONS, RECIPE_NAME_MAX, SHOPPING_TEXT_MAX, addDays, cleanText, dayKeyOf, freezerLow,
  freezerStock, freezerTotal, ingredientKey, mealprepXpId, menuId, parseIngredients, prepMissionId, rawPortions,
  setSlot, shiftSlots, shoppingListId, ulid, weekKey,
} from '@life/shared';
import { db } from '../db/db';
import { newRecord, patch, put, putAll, softDelete, upsert } from '../db/repo';
import { hasLiveXp, withLock } from './common';
import { createMission } from './missionActions';

// Casa (Marco 4, spec §5): recipes, the weekly menu, the shopping list, the freezer and batch prep.
// `freezerMoves` is append-only: portions change by adding a move (or soft-deleting one to undo).

const CASA_AREA = 'area-ordem';

export const PREP_MISSION = {
  title: 'Preparo em lote',
  firstStep: 'Separar os ingredientes e os potes',
  notes: 'Ao terminar, registre as porções em Planejar → Casa → Preparo em lote: o freezer é atualizado e esta missão é concluída.',
};

export class RecipeValidationError extends Error {}

async function dayStartHour(): Promise<number> {
  return (await db.settings.get('settings'))?.dayStartHour ?? 4;
}

async function liveRecipes(): Promise<Recipe[]> {
  return (await db.recipes.toArray()).filter((r) => !r.deleted);
}

// ------------------------------------------------------------------ recipes

/** Creates or edits a recipe: the name is required and unique (ignoring accents and case). */
export const saveRecipe = (input: { id?: ID; name: string; ingredients: string }): Promise<Recipe> =>
  withLock('recipes', async () => {
    const name = cleanText(input.name, RECIPE_NAME_MAX);
    if (!name) throw new RecipeValidationError('Dê um nome ao prato.');
    const key = ingredientKey(name);
    if ((await liveRecipes()).some((r) => r.id !== input.id && ingredientKey(r.name) === key)) {
      throw new RecipeValidationError('Já existe uma receita com esse nome.');
    }
    const ingredients = parseIngredients(input.ingredients);
    const prev = input.id ? await db.recipes.get(input.id) : undefined;
    if (prev && !prev.deleted) return patch<Recipe>('recipes', prev.id, { name, ingredients });
    return put('recipes', newRecord<Recipe>({ name, ingredients }));
  });

/** The live recipe with this name (ignoring accents and case), created with no ingredients when missing. */
export const ensureRecipe = (name: string): Promise<Recipe> => withLock('recipes', async () => {
  const clean = cleanText(name, RECIPE_NAME_MAX);
  if (!clean) throw new RecipeValidationError('Dê um nome ao prato.');
  const key = ingredientKey(clean);
  const found = (await liveRecipes()).find((r) => ingredientKey(r.name) === key);
  return found ?? put('recipes', newRecord<Recipe>({ name: clean, ingredients: [] }));
});

/** Soft delete: lists and pickers hide it; menus that chose it keep showing its name. */
export const deleteRecipe = (id: ID): Promise<void> => softDelete('recipes', id);

export const restoreRecipe = (id: ID): Promise<Recipe> => patch<Recipe>('recipes', id, { deleted: false });

// ------------------------------------------------------------------ menu

/** Sets (or clears, with null) the dish of one meal of the week that starts on `week` (a Monday). */
export const setMenuSlot = (week: DayKey, day: DayKey, meal: MealKind, recipeId: ID | null): Promise<Menu> =>
  withLock('menu', async () => {
    if (day < week || day > addDays(week, 6)) throw new Error(`${day} is not in the week of ${week}`);
    const prev = await db.menus.get(menuId(week));
    const slots = setSlot(prev && !prev.deleted ? prev.slots : [], day, meal, recipeId);
    return upsert<Menu>('menus', menuId(week), { slots }, { week, slots: [] });
  });

/**
 * "Repetir a semana anterior": copies last week's dishes into an empty week, a week later.
 * Resolves with how many meals were copied (0 when this week already has dishes or last week had none).
 */
export const copyPreviousWeek = (week: DayKey): Promise<number> => withLock('menu', async () => {
  const cur = await db.menus.get(menuId(week));
  if (cur && !cur.deleted && cur.slots.length > 0) return 0;
  const prev = await db.menus.get(menuId(addDays(week, -7)));
  if (!prev || prev.deleted || prev.slots.length === 0) return 0;
  await upsert<Menu>('menus', menuId(week), { slots: shiftSlots(prev.slots, 7) }, { week, slots: [] });
  return prev.slots.length;
});

// ------------------------------------------------------------------ shopping list

const listDefaults = (week: DayKey): Omit<ShoppingList, keyof BaseRecord> => ({ week, manual: [], checked: [] });

async function liveList(week: DayKey): Promise<ShoppingList | undefined> {
  const l = await db.shoppingLists.get(shoppingListId(week));
  return l && !l.deleted ? l : undefined;
}

/** Ticks or unticks a row (`g:…` from the menu, `m:…` manual). */
export const toggleShoppingItem = (week: DayKey, key: string): Promise<void> => withLock('shop', async () => {
  const checked = (await liveList(week))?.checked ?? [];
  const next = checked.includes(key) ? checked.filter((k) => k !== key) : [...checked, key];
  await upsert<ShoppingList>('shoppingLists', shoppingListId(week), { checked: next }, listDefaults(week));
});

/** Adds a manual item; blank text or one already listed by hand (same key) adds nothing. */
export const addShoppingItem = (week: DayKey, text: string): Promise<ShoppingItem | undefined> =>
  withLock('shop', async () => {
    const clean = cleanText(text, SHOPPING_TEXT_MAX);
    if (!clean) return undefined;
    const manual = (await liveList(week))?.manual ?? [];
    if (manual.some((m) => ingredientKey(m.text) === ingredientKey(clean))) return undefined;
    const item: ShoppingItem = { id: ulid(), text: clean };
    await upsert<ShoppingList>('shoppingLists', shoppingListId(week), { manual: [...manual, item] }, listDefaults(week));
    return item;
  });

export const removeShoppingItem = (week: DayKey, id: ID): Promise<void> => withLock('shop', async () => {
  const list = await liveList(week);
  if (!list) return;
  await patch<ShoppingList>('shoppingLists', list.id, {
    manual: list.manual.filter((m) => m.id !== id),
    checked: list.checked.filter((k) => k !== `m:${id}`),
  });
});

// ------------------------------------------------------------------ freezer

async function liveMoves(): Promise<FreezerMove[]> {
  return (await db.freezerMoves.toArray()).filter((m) => !m.deleted);
}

export interface EatResult { move?: FreezerMove; total: number; low: boolean }

/** "Comi uma": one portion of the dish out of the freezer (nothing when it has none). */
export const eatPortion = (recipeId: ID, meal?: MealKind): Promise<EatResult> => withLock('freezer', async () => {
  const moves = await liveMoves();
  let move: FreezerMove | undefined;
  if (rawPortions(moves, recipeId) > 0) {
    const at = Date.now();
    move = await put('freezerMoves', newRecord<FreezerMove>({
      at, day: dayKeyOf(at, await dayStartHour()), recipeId, delta: -1, kind: 'eat', ...(meal ? { meal } : {}),
    }));
    moves.push(move);
  }
  const stock = freezerStock(moves);
  return { ...(move ? { move } : {}), total: freezerTotal(stock), low: freezerLow(stock, moves) };
});

/** "Ajustar": makes the dish's count exactly `portions` (0–99) with one 'fix' move. */
export const fixPortions = (recipeId: ID, portions: number): Promise<FreezerMove | undefined> =>
  withLock('freezer', async () => {
    const target = Math.max(0, Math.min(99, Math.round(portions)));
    const delta = target - rawPortions(await liveMoves(), recipeId);
    if (!Number.isFinite(delta) || delta === 0) return undefined;
    const at = Date.now();
    return put('freezerMoves', newRecord<FreezerMove>({ at, day: dayKeyOf(at, await dayStartHour()), recipeId, delta, kind: 'fix' }));
  });

/** Desfazer of "Comi uma" or "Ajustar": soft-deletes the move. */
export const undoFreezerMove = (id: ID): Promise<void> => withLock('freezer', async () => {
  const m = await db.freezerMoves.get(id);
  if (m && !m.deleted) await put('freezerMoves', { ...m, deleted: true });
});

export interface PrepResult {
  day: DayKey;
  moveIds: ID[];
  portions: number;
  xp: number;
  /** The week's prep mission this prep completed: what it had before and the 'completed' event (for Desfazer). */
  mission?: { id: ID; status: MissionStatus; completedAt?: number; eventId: ID };
}

/**
 * "Terminei o preparo": each dish with portions (1–30, repeated dishes summed) goes into the freezer;
 * +10 XP once per logical day (to Ordem); the week's open prep mission is completed without its
 * own XP. One transaction.
 */
export const finishPrep = (items: Array<{ recipeId: ID; portions: number }>): Promise<PrepResult> =>
  withLock('freezer', async () => {
    const at = Date.now();
    const day = dayKeyOf(at, await dayStartHour());
    const sums = new Map<ID, number>();
    for (const i of items) {
      const n = Math.round(i.portions);
      if (Number.isFinite(n) && n > 0) sums.set(i.recipeId, Math.min(PREP_MAX_PORTIONS, (sums.get(i.recipeId) ?? 0) + n));
    }
    if (sums.size === 0) return { day, moveIds: [], portions: 0, xp: 0 };
    const moves = [...sums.entries()].map(([recipeId, delta]) =>
      newRecord<FreezerMove>({ at, day, recipeId, delta, kind: 'prep' }));
    const entries: Array<{ table: SyncTable; record: BaseRecord }> = moves.map((record) => ({ table: 'freezerMoves', record }));
    let xp = 0;
    const xpId = mealprepXpId(day);
    // A prep marked last week (say on Sunday) is often done on the Monday: look at both weeks.
    const ids = [prepMissionId(weekKey(day)), prepMissionId(addDays(weekKey(day), -7))];
    const found = await Promise.all(ids.map((id) => db.missions.get(id)));
    const m = found.find((x) => x && !x.deleted && (x.status === 'open' || x.status === 'doing'));
    // The same effort never earns twice: a prep mission completed by hand today already paid.
    const rewarded = (await Promise.all(ids.map((id) => db.xpEvents.get(`xp-complete-${id}`))))
      .some((x) => x && !x.deleted && x.dayKey === day);
    if (!rewarded && !(await hasLiveXp(xpId))) {
      xp = MEALPREP_XP;
      entries.push({ table: 'xpEvents', record: newRecord<XpEvent>({
        id: xpId, at, amount: xp, reason: 'mealprep', dayKey: day, areaId: CASA_AREA,
      }) });
    }
    let mission: PrepResult['mission'];
    if (m) {
      // Same event shape as completeMission (prevStatus, xpIds), so "undo" on the mission keeps working.
      const event = newRecord<LifeEvent>({ at, type: 'completed', missionId: m.id, data: { prevStatus: m.status, xpIds: [], via: 'prep' } });
      mission = { id: m.id, status: m.status, eventId: event.id, ...(m.completedAt !== undefined ? { completedAt: m.completedAt } : {}) };
      entries.push({ table: 'missions', record: { ...m, status: 'done', completedAt: at } as Mission });
      entries.push({ table: 'events', record: event });
    }
    await putAll(entries);
    return { day, moveIds: moves.map((x) => x.id), portions: moves.reduce((s, x) => s + x.delta, 0), xp, ...(mission ? { mission } : {}) };
  });

/** Desfazer of "Terminei o preparo": the moves go, the XP too (when no other prep stands that day), the mission reopens. */
export const undoPrep = (r: PrepResult): Promise<void> => withLock('freezer', async () => {
  const entries: Array<{ table: SyncTable; record: BaseRecord }> = [];
  for (const id of r.moveIds) {
    const m = await db.freezerMoves.get(id);
    if (m && !m.deleted) entries.push({ table: 'freezerMoves', record: { ...m, deleted: true } });
  }
  const otherPrep = (await liveMoves()).some((m) => m.kind === 'prep' && m.day === r.day && !r.moveIds.includes(m.id));
  const x = await db.xpEvents.get(mealprepXpId(r.day));
  // Whichever prep of the day is undone last takes the day's XP with it (r.xp is 0 for the later ones).
  if (!otherPrep && x && !x.deleted) entries.push({ table: 'xpEvents', record: { ...x, deleted: true } });
  if (r.mission) {
    const m = await db.missions.get(r.mission.id);
    if (m && !m.deleted && m.status === 'done') {
      const reopened: Mission = { ...m, status: r.mission.status };
      if (r.mission.completedAt === undefined) delete reopened.completedAt;
      else reopened.completedAt = r.mission.completedAt;
      entries.push({ table: 'missions', record: reopened });
      entries.push({ table: 'events', record: newRecord<LifeEvent>({
        at: Date.now(), type: 'uncompleted', missionId: m.id, data: { completedEventId: r.mission.eventId },
      }) });
    }
  }
  await putAll(entries);
});

/**
 * "Marcar preparo": the week's prep mission (`prep-${week}`) in Casa e finanças, created — or
 * created again over a done or deleted one — unless it is still open. The caller opens its sheet.
 */
export const ensurePrepMission = (week: DayKey): Promise<Mission> => withLock('prep-mission', async () => {
  const id = prepMissionId(week);
  const prev = await db.missions.get(id);
  if (prev && !prev.deleted && (prev.status === 'open' || prev.status === 'doing')) return prev;
  return createMission({
    id, title: PREP_MISSION.title, firstStep: PREP_MISSION.firstStep, notes: PREP_MISSION.notes,
    durationMin: 90, energy: 'medium', areaId: CASA_AREA,
  });
});
