import type {
  BaseRecord, DayKey, FieldIssue, Food, FoodInput, FoodLog, Hunger, ID, MacroTarget, NutritionBuild, NutritionMeal,
  NutritionSettings, NutritionTarget, PantryItem, PlanOutcome, RecipeInput, Settings, SyncTable, WeighIn,
} from '@life/shared';
import {
  NUTRITION_BUILD_KEY, cleanMeals, heldAfter, logGramsIssue, logSnapshot, mealsWithoutEaten, nextOrder, nutritionSettingsOf,
  nutritionTargetId, pantryGramsIssue, pantryId, planRestOfDay, plannedLogId, roundGrams, roundKg, stockFollows, validateFood,
  validateRecipe, weekTargetIssues, weighInIssue,
} from '@life/shared';
import { db } from '../db/db';
import { getMeta, mutate, newRecord, put, putAll, setMeta } from '../db/repo';
import { getToday, withLock } from './common';

// Nutrição (spec docs/superpowers/specs/2026-11-25-nutricao-design.md). Every write goes through put/putAll, so it is
// queued for sync. No XP anywhere: registering food or weight is data, not effort. Eaten items ('comido') are never
// touched by "Montar o resto do dia", which only replaces planned items of meals with nothing eaten.
//
// Sync limit (spec §7): the stock is one record per food, last write wins. Eating the same counted food on two
// devices before a sync keeps one of the two decrements; the next count fixes it.

/** A form problem: `issues` has every field and sentence; `message` is the first sentence. */
export class NutritionValidationError extends Error {
  constructor(public issues: FieldIssue[]) { super(issues[0]?.message ?? 'Confira os campos.'); }
}

type Entry = { table: SyncTable; record: BaseRecord };

const invalid = (field: string, message: string) => new NutritionValidationError([{ field, message }]);
const GONE = 'Este alimento foi apagado.';
const nutritionLock = <T>(fn: () => Promise<T>): Promise<T> => withLock('nutrition', fn);

async function liveFood(id: ID): Promise<Food | undefined> {
  const f = await db.foods.get(id);
  return f && !f.deleted ? f : undefined;
}

async function liveLog(id: ID): Promise<FoodLog | undefined> {
  const l = await db.foodLogs.get(id);
  return l && !l.deleted ? l : undefined;
}

async function livePantry(foodId: ID): Promise<PantryItem | undefined> {
  const p = await db.pantry.get(pantryId(foodId));
  return p && !p.deleted ? p : undefined;
}

type Eaten = Pick<FoodLog, 'foodId' | 'day' | 'createdAt' | 'eatenAt' | 'stockTaken'>;

/**
 * The stock follows an eaten item whose grams go from `from` to `to` (0 = deleted): it gives back at most what the
 * item took, and takes more only from what is left (heldAfter). Nothing moves when the stock does not follow it: not
 * counted, confirmed another day, or counted again after the item was eaten (stockFollows). Resolves with the grams the
 * item now holds (its `stockTaken`) and the stock write, if any.
 */
async function stockChange(log: Eaten, from: number, to: number): Promise<{ held: number; entries: Entry[] }> {
  const held = log.stockTaken ?? 0;
  const item = await livePantry(log.foodId);
  if (!stockFollows(item, log.day, log.eatenAt ?? log.createdAt)) return { held, entries: [] };
  const next = heldAfter(held, from, to, item.grams);
  const grams = Math.max(0, roundGrams(item.grams - (next - held)));
  const record: PantryItem = { ...item, grams };
  return { held: next, entries: grams === item.grams ? [] : [{ table: 'pantry', record }] };
}

/** `log` with the grams it holds out of the stock (the field goes away at 0). */
function withHeld<T extends FoodLog>(log: T, held: number): T {
  const { stockTaken: _s, ...rest } = log;
  return (held > 0 ? { ...rest, stockTaken: roundGrams(held) } : rest) as T;
}

// ------------------------------------------------------------------ foods and recipes

/** The stored record for `fields`: a new food, or `id` with its optional fields replaced (a cleared one goes away). */
async function foodRecord(fields: Omit<Food, keyof BaseRecord>, id?: ID): Promise<Food> {
  if (id === undefined) return newRecord<Food>(fields);
  const prev = await liveFood(id);
  if (!prev) throw invalid('name', GONE);
  const { unit: _u, maxPortion: _m, meals: _b, recipe: _r, ...kept } = prev;
  return { ...kept, ...fields };
}

/** Creates or edits a food (validated, §7). Editing never changes past logs: they keep their own copy. */
export const saveFood = (input: FoodInput, id?: ID): Promise<Food> => nutritionLock(async () => {
  const { food, issues } = validateFood(input);
  if (!food) throw new NutritionValidationError(issues);
  return put('foods', await foodRecord(food, id));
});

/** Creates or edits a recipe: per100 is computed now from the ingredients and the final weight. `note` = no cooking fat. */
export const saveRecipe = (input: RecipeInput, id?: ID): Promise<{ food: Food; note?: string }> => nutritionLock(async () => {
  const foods = (await db.foods.toArray()).filter((f) => !f.deleted);
  const { food, issues, note } = validateRecipe(input, foods, id);
  if (!food) throw new NutritionValidationError(issues);
  const saved = await put('foods', await foodRecord(food, id));
  return { food: saved, ...(note ? { note } : {}) };
});

/** "Apagar" a food: soft-deletes it and its stock item. The diary keeps its copies. Resolves with it (for Desfazer). */
export const deleteFood = (id: ID): Promise<Food | undefined> => nutritionLock(async () => {
  const food = await liveFood(id);
  if (!food) return undefined;
  const entries: Entry[] = [{ table: 'foods', record: { ...food, deleted: true } }];
  const item = await livePantry(id);
  if (item) entries.push({ table: 'pantry', record: { ...item, deleted: true } });
  await putAll(entries);
  return food;
});

/** Desfazer of "Apagar": the same food again (its stock item stays out until marked again). */
export const restoreFood = (food: Food): Promise<Food> => nutritionLock(() => put('foods', { ...food, deleted: false }));

// ------------------------------------------------------------------ targets

/**
 * "Salvar metas": the 7 weekday targets (0 = Sunday) in force from today. A new record when today has none, else
 * today's is replaced; older records stay as the history.
 */
export const saveTargets = (byWeekday: MacroTarget[]): Promise<NutritionTarget> => nutritionLock(async () => {
  const issues = weekTargetIssues(byWeekday);
  if (issues.length > 0) throw new NutritionValidationError(issues);
  const from = await getToday();
  const id = nutritionTargetId(from);
  const days = byWeekday.map((t) => ({ protein: t.protein, carbs: t.carbs, fat: t.fat }));
  const prev = await db.nutritionTargets.get(id);
  return put('nutritionTargets', prev ? { ...prev, byWeekday: days, deleted: false } : newRecord<NutritionTarget>({ id, from, byWeekday: days }));
});

// ------------------------------------------------------------------ the diary by meal

export interface EatInput { meal: NutritionMeal; foodId: ID; grams: number; day?: DayKey }

/**
 * "Adicionar o que comi": an eaten item (the food copied now); a counted stock confirmed that day goes down (never
 * below 0), and the item remembers what it took.
 */
export const logEaten = (input: EatInput): Promise<FoodLog> => nutritionLock(async () => {
  const issue = logGramsIssue(input.grams);
  if (issue) throw invalid('grams', issue);
  const food = await liveFood(input.foodId);
  if (!food) throw invalid('foodId', GONE);
  const day = input.day ?? await getToday();
  const grams = roundGrams(input.grams);
  const items = await db.foodLogs.where('day').equals(day).toArray();
  const log = newRecord<FoodLog>({
    day, meal: input.meal, ...logSnapshot(food), grams, status: 'comido', order: nextOrder(items, day, input.meal), eatenAt: Date.now(),
  });
  const { held, entries } = await stockChange(log, 0, grams);
  await putAll([{ table: 'foodLogs', record: withHeld(log, held) }, ...entries]);
  return (await db.foodLogs.get(log.id))!;
});

/**
 * The grams of an item corrected (eaten or planned). For an eaten one the stock follows: less eaten gives back at
 * most what it took, more eaten takes only from what is left.
 */
export const correctGrams = (logId: ID, grams: number): Promise<FoodLog> => nutritionLock(async () => {
  const issue = logGramsIssue(grams);
  if (issue) throw invalid('grams', issue);
  const log = await liveLog(logId);
  if (!log) throw new Error(`foodLogs:${logId} not found`);
  const next = roundGrams(grams);
  if (log.status !== 'comido') {
    await put('foodLogs', { ...log, grams: next });
    return (await db.foodLogs.get(log.id))!;
  }
  const { held, entries } = await stockChange(log, log.grams, next);
  await putAll([{ table: 'foodLogs', record: withHeld({ ...log, grams: next }, held) }, ...entries]);
  return (await db.foodLogs.get(log.id))!;
});

/**
 * "Apagar" an item (or "Tirar" a planned one): soft-deleted; an eaten one gives back what it took from the stock (when
 * the stock still follows it). Resolves with it (Desfazer).
 */
export const deleteLog = (logId: ID): Promise<FoodLog | undefined> => nutritionLock(async () => {
  const log = await liveLog(logId);
  if (!log) return undefined;
  if (log.status !== 'comido') {
    await put('foodLogs', { ...log, deleted: true });
    return log;
  }
  const { held, entries } = await stockChange(log, log.grams, 0);
  await putAll([{ table: 'foodLogs', record: withHeld({ ...log, deleted: true }, held) }, ...entries]);
  return log;
});

/** "Tirar" a planned item. Resolves with it (Desfazer with restoreLog). Nothing for an eaten item. */
export const removePlanned = async (logId: ID): Promise<FoodLog | undefined> => {
  const log = await liveLog(logId);
  return log?.status === 'planejado' ? deleteLog(logId) : undefined;
};

/**
 * Desfazer of deleteLog / removePlanned: the same item again. An eaten one takes again what the deletion gave back
 * (from what is left); when the deletion gave nothing back (the stock had been counted again), nothing is taken.
 */
export const restoreLog = (log: FoodLog): Promise<FoodLog> => nutritionLock(async () => {
  // The deleted record (it says what the deletion gave back), unless something else took its id since.
  const found = await db.foodLogs.get(log.id);
  const stored = found?.deleted && found.status === log.status ? found : withHeld(log, 0);
  if (stored.status !== 'comido') {
    await put('foodLogs', { ...stored, deleted: false });
    return (await db.foodLogs.get(log.id))!;
  }
  // The deleted record holds what was not given back: it still counts as taken, so it moves nothing now.
  const keeps = (stored.stockTaken ?? 0) > 0;
  const { held, entries } = await stockChange(stored, keeps ? stored.grams : 0, stored.grams);
  await putAll([{ table: 'foodLogs', record: withHeld({ ...stored, deleted: false }, held) }, ...entries]);
  return (await db.foodLogs.get(log.id))!;
});

/** "Comi" on a planned item: it becomes eaten, with the suggested grams or the corrected ones; the stock goes down. */
export const eatPlanned = (logId: ID, grams?: number): Promise<FoodLog> => nutritionLock(async () => {
  if (grams !== undefined) {
    const issue = logGramsIssue(grams);
    if (issue) throw invalid('grams', issue);
  }
  const log = await liveLog(logId);
  if (!log || log.status !== 'planejado') throw new Error(`foodLogs:${logId} is not a planned item`);
  const eaten = grams === undefined ? log.grams : roundGrams(grams);
  const record: FoodLog = { ...log, grams: eaten, status: 'comido', eatenAt: Date.now() };
  const { held, entries } = await stockChange({ ...record, stockTaken: 0 }, 0, eaten);
  await putAll([{ table: 'foodLogs', record: withHeld(record, held) }, ...entries]);
  return (await db.foodLogs.get(log.id))!;
});

// ------------------------------------------------------------------ the day's stock

/**
 * "Tem hoje" / "Confirmar" / "Adicionar ao estoque": the food is available today, with the grams left (in the food's
 * basis) or, without grams, "tem, sem contar" (a previous count is dropped: the screen pre-fills it to keep it). A
 * count remembers when it was typed: items eaten before it no longer move the stock (the count already reflects them).
 */
export const confirmPantry = (foodId: ID, grams?: number): Promise<PantryItem> => nutritionLock(async () => {
  const issue = pantryGramsIssue(grams);
  if (issue) throw invalid('grams', issue);
  if (!(await liveFood(foodId))) throw invalid('foodId', GONE);
  const confirmedDay = await getToday();
  const id = pantryId(foodId);
  const prev = await db.pantry.get(id);
  const counted = grams === undefined ? {} : { grams: roundGrams(grams), countedAt: Date.now() };
  if (prev) {
    const { grams: _g, countedAt: _c, ...kept } = prev;
    return put('pantry', { ...kept, foodId, confirmedDay, ...counted, deleted: false });
  }
  return put('pantry', newRecord<PantryItem>({ id, foodId, confirmedDay, ...counted }));
});

/** "Adicionar ao estoque": the same as confirming the food today. */
export const addToPantry = confirmPantry;

/** Takes a food out of the stock list (soft delete). Resolves with it. */
export const removeFromPantry = (foodId: ID): Promise<PantryItem | undefined> => nutritionLock(async () => {
  const item = await livePantry(foodId);
  if (!item) return undefined;
  await put('pantry', { ...item, deleted: true });
  return item;
});

/** Desfazer of removeFromPantry: the same stock item again, with its day and grams (nothing when the food is gone). */
export const restorePantry = (item: PantryItem): Promise<PantryItem | undefined> => nutritionLock(async () => {
  if (!(await liveFood(item.foodId))) return undefined;
  return put('pantry', { ...item, deleted: false });
});

// ------------------------------------------------------------------ "Montar o resto do dia"

export interface BuildInput { hunger: Hunger; afterTraining?: NutritionMeal }

/** This device's last build (local meta, never synced), or undefined. */
export const getNutritionBuild = (): Promise<NutritionBuild | undefined> => getMeta<NutritionBuild>(NUTRITION_BUILD_KEY);

/**
 * Runs the generator for today and REPLACES the planned items of every meal with nothing eaten (eaten items are never
 * touched). Planned items get one id per day, meal and food (plannedLogId), so two devices building the same plan
 * before a sync converge instead of doubling. Remembers the build (day, hunger, meal right after training) in this
 * device's meta: it drives the pré/pós-treino tags and is never synced, so it never rewrites the shared Settings.
 * Resolves with the outcome: when blocked (no target, no stock confirmed today, no meal left) nothing is written.
 */
export const buildRestOfDay = (input: BuildInput): Promise<PlanOutcome> => nutritionLock(async () => {
  const day = await getToday();
  const [targets, logs, foods, pantry, settings] = await Promise.all([
    db.nutritionTargets.toArray(), db.foodLogs.where('day').equals(day).toArray(), db.foods.toArray(), db.pantry.toArray(),
    db.settings.get('settings'),
  ]);
  const nutrition = nutritionSettingsOf(settings);
  const afterTraining = input.afterTraining && nutrition.meals.includes(input.afterTraining) ? input.afterTraining : undefined;
  const outcome = planRestOfDay({ day, targets, logs, meals: nutrition.meals, foods, pantry, hunger: input.hunger, afterTraining });
  if (!outcome.ok) return outcome;

  const byId = new Map(foods.map((f) => [f.id, f]));
  const orders = new Map<NutritionMeal, number>();
  const fresh = outcome.items.map((it) => {
    const order = orders.get(it.meal) ?? 0;
    orders.set(it.meal, order + 1);
    return newRecord<FoodLog>({
      id: plannedLogId(day, it.meal, it.foodId), day, meal: it.meal, ...logSnapshot(byId.get(it.foodId)!), grams: it.grams,
      status: 'planejado', order,
    });
  });
  const freshIds = new Set(fresh.map((l) => l.id));
  const open = new Set(mealsWithoutEaten(logs, day));
  const stale = logs.filter((l) => !l.deleted && l.status === 'planejado' && open.has(l.meal) && !freshIds.has(l.id));
  await putAll([
    ...stale.map((l) => ({ table: 'foodLogs' as const, record: { ...l, deleted: true } })),
    ...fresh.map((l) => ({ table: 'foodLogs' as const, record: l })),
  ]);
  const build: NutritionBuild = { day, hunger: input.hunger, ...(afterTraining ? { afterTraining } : {}) };
  await setMeta(NUTRITION_BUILD_KEY, build);
  return outcome;
});

// ------------------------------------------------------------------ weigh-ins (append-only)

/** "Registrar" a weight (30–300 kg, one decimal). It never changes the targets. */
export const addWeighIn = (kg: number, day?: DayKey): Promise<WeighIn> => nutritionLock(async () => {
  const issue = weighInIssue(kg);
  if (issue) throw invalid('kg', issue);
  return put('weighIns', newRecord<WeighIn>({ day: day ?? await getToday(), kg: roundKg(kg) }));
});

/** "Apagar" a weigh-in (soft delete; weigh-ins are never edited). Resolves with it (for Desfazer). */
export const deleteWeighIn = (id: ID): Promise<WeighIn | undefined> => nutritionLock(async () => {
  const w = await db.weighIns.get(id);
  if (!w || w.deleted) return undefined;
  await put('weighIns', { ...w, deleted: true });
  return w;
});

/**
 * Desfazer of "Apagar": the same weight on the same day, as a new record (append-only) that keeps the original
 * `createdAt`, so the day's latest weigh-in (the one the average uses) stays the same.
 */
export const restoreWeighIn = (w: WeighIn): Promise<WeighIn> => nutritionLock(async () => {
  const issue = weighInIssue(w.kg);
  if (issue) throw invalid('kg', issue);
  return put('weighIns', newRecord<WeighIn>({ day: w.day, kg: roundKg(w.kg), createdAt: w.createdAt }));
});

// ------------------------------------------------------------------ settings

/** Saves the meals switched on (at least one). Resolves with the settings now in force. */
export const saveNutritionSettings = (changes: { meals?: NutritionMeal[] }): Promise<NutritionSettings> => nutritionLock(async () => {
  const meals = changes.meals === undefined ? undefined : cleanMeals(changes.meals);
  if (meals?.length === 0) throw invalid('meals', 'Deixe pelo menos uma refeição ligada.');
  const settings = await db.settings.get('settings');
  const withChanges = (s?: Settings): NutritionSettings => ({ ...nutritionSettingsOf(s), ...(meals ? { meals } : {}) });
  if (!settings || settings.deleted) return withChanges(settings);
  const saved = await mutate<Settings>('settings', 'settings', (prev) => ({ nutrition: withChanges(prev) }));
  return nutritionSettingsOf(saved);
});

/** Switches one meal on or off (the last one on stays on: NutritionValidationError). */
export async function setMealOn(meal: NutritionMeal, on: boolean): Promise<NutritionSettings> {
  const cur = nutritionSettingsOf(await db.settings.get('settings')).meals;
  return saveNutritionSettings({ meals: on ? [...cur, meal] : cur.filter((m) => m !== meal) });
}
