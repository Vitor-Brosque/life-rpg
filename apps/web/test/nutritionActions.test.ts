import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoodInput, FoodLog, MacroTarget } from '@life/shared';
import {
  NUTRITION_MEALS, PLAN_TOLERANCE, nutritionDay, plannedLogId, recipePer100, targetFor, trainingTags, weekTargets, weighInSummary,
} from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import {
  NutritionValidationError, addWeighIn, buildRestOfDay, confirmPantry, correctGrams, deleteFood, deleteLog, deleteWeighIn, eatPlanned,
  getNutritionBuild, logEaten, removeFromPantry, removePlanned, restoreFood, restoreLog, restoreWeighIn, saveFood, saveNutritionSettings,
  saveRecipe, saveTargets, setMealOn,
} from '../src/domain/nutritionActions';

// Every food and number here is invented. Today is Wednesday 2026-11-25 (day start 04:00).

const at = (d: number, h: number, m = 0): Date => new Date(2026, 10, d, h, m);
const DAY = '2026-11-25';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(25, 10));
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

const input = (name: string, group: FoodInput['group'], p: [number, number, number, number], extra: Partial<FoodInput> = {}): FoodInput => ({
  name, group, per100: { kcal: p[0], protein: p[1], carbs: p[2], fat: p[3] }, basis: 'pronto', source: 'tabela', like: 'normal', ...extra,
});

async function pantryFoods() {
  const frango = await saveFood(input('Peito de frango', 'proteina', [165, 31, 0, 3.6], { like: 'gosto' }));
  const ovo = await saveFood(input('Ovo cozido', 'proteina', [155, 13, 1.1, 10.6], { unit: { name: 'ovo', grams: 50 } }));
  const arroz = await saveFood(input('Arroz branco', 'carboidrato', [130, 2.7, 28, 0.3]));
  const brocolis = await saveFood(input('Brócolis', 'verdura', [35, 2.4, 7, 0.4]));
  const azeite = await saveFood(input('Azeite', 'gordura', [884, 0, 0, 100]));
  return { frango, ovo, arroz, brocolis, azeite };
}

const TARGET: MacroTarget = { protein: 160, carbs: 250, fat: 60 };
const liveLogs = async (): Promise<FoodLog[]> => (await db.foodLogs.toArray()).filter((l) => !l.deleted);

describe('foods and recipes', () => {
  it('saveFood validates (nothing saves) and stores a food queued for sync', async () => {
    const bad = saveFood(input(' ', 'proteina', [950, 31, 0, 3.6]));
    await expect(bad).rejects.toBeInstanceOf(NutritionValidationError);
    await expect(bad).rejects.toMatchObject({ issues: [{ field: 'name', message: 'Dê um nome.' }, { field: 'kcal', message: 'No máximo 900 kcal por 100 g.' }] });
    expect(await db.foods.count()).toBe(0);
    const f = await saveFood(input('Arroz branco', 'carboidrato', [130, 2.7, 28, 0.3], { maxPortion: 200 }));
    expect(f).toMatchObject({ name: 'Arroz branco', maxPortion: 200, deleted: false });
    expect(await db.outbox.get(`foods:${f.id}`)).toBeDefined();
    const edited = await saveFood(input('Arroz branco', 'carboidrato', [128, 2.5, 28, 0.2]), f.id);
    expect(edited.id).toBe(f.id);
    expect(edited.createdAt).toBe(f.createdAt);
    expect(edited).not.toHaveProperty('maxPortion'); // cleared in the form
  });

  it('editing or deleting a food never changes the diary (the log keeps its copy)', async () => {
    const f = await saveFood(input('Arroz branco', 'carboidrato', [130, 2.7, 28, 0.3], { source: 'estimativa' }));
    const l = await logEaten({ meal: 'almoco', foodId: f.id, grams: 150 });
    expect(l).toMatchObject({ day: DAY, name: 'Arroz branco', per100: { kcal: 130 }, basis: 'pronto', estimate: true, status: 'comido', order: 0 });
    await saveFood(input('Arroz integral', 'carboidrato', [111, 2.6, 23, 0.9]), f.id);
    await confirmPantry(f.id, 300);
    const gone = await deleteFood(f.id);
    expect(gone!.id).toBe(f.id);
    expect((await db.foods.get(f.id))!.deleted).toBe(true);
    expect((await db.pantry.get(`pantry-${f.id}`))!.deleted).toBe(true);
    expect(await db.foodLogs.get(l.id)).toMatchObject({ name: 'Arroz branco', per100: { kcal: 130 }, deleted: false });
    await expect(logEaten({ meal: 'jantar', foodId: f.id, grams: 100 })).rejects.toMatchObject({ message: 'Este alimento foi apagado.' });
    expect((await restoreFood(gone!)).deleted).toBe(false);
  });

  it('saveRecipe computes per 100 g on save, propagates the estimate and notes a recipe without cooking fat', async () => {
    const { frango, arroz, azeite } = await pantryFoods();
    const { food, note } = await saveRecipe({
      name: 'Frango com arroz', group: 'proteina', like: 'gosto', yieldGrams: 600,
      ingredients: [{ foodId: frango.id, grams: 300 }, { foodId: arroz.id, grams: 200 }, { foodId: azeite.id, grams: 10 }],
    });
    expect(note).toBeUndefined();
    expect(food).toMatchObject({ basis: 'pronto', source: 'tabela', recipe: { yieldGrams: 600 } });
    expect(food.per100).toEqual(recipePer100([{ per100: frango.per100, grams: 300 }, { per100: arroz.per100, grams: 200 }, { per100: azeite.per100, grams: 10 }], 600));
    const guess = await saveFood(input('Molho', 'outro', [80, 1, 10, 4], { source: 'estimativa' }));
    const second = await saveRecipe({ name: 'Frango ao molho', group: 'proteina', like: 'normal', yieldGrams: 350, ingredients: [{ foodId: frango.id, grams: 300 }, { foodId: guess.id, grams: 100 }] }, food.id);
    expect(second.food.id).toBe(food.id);
    expect(second.food.source).toBe('estimativa');
    expect(second.note).toBe('Sem gordura no preparo. Se usou óleo ou azeite, inclua como ingrediente.');
    await expect(saveRecipe({ name: 'Vazia', group: 'outro', like: 'normal', yieldGrams: 100, ingredients: [] }))
      .rejects.toMatchObject({ message: 'Inclua pelo menos um ingrediente.' });
    await expect(saveRecipe({ name: 'Sem rendimento', group: 'outro', like: 'normal', ingredients: [{ foodId: arroz.id, grams: 100 }] }))
      .rejects.toMatchObject({ message: 'Informe o rendimento final em gramas.' });
  });
});

describe('the diary and the stock', () => {
  it('logging eaten food takes the grams from a counted stock confirmed today; corrections and deletions follow', async () => {
    const { arroz, frango } = await pantryFoods();
    await confirmPantry(arroz.id, 500);
    await confirmPantry(frango.id); // "tem, sem contar"
    const rice = await logEaten({ meal: 'almoco', foodId: arroz.id, grams: 150 });
    expect((await db.pantry.get(`pantry-${arroz.id}`))!.grams).toBe(350);
    const chicken = await logEaten({ meal: 'almoco', foodId: frango.id, grams: 120 });
    expect(chicken.order).toBe(1);
    expect(await db.pantry.get(`pantry-${frango.id}`)).not.toHaveProperty('grams');
    await correctGrams(rice.id, 200);
    expect((await db.foodLogs.get(rice.id))!.grams).toBe(200);
    expect((await db.pantry.get(`pantry-${arroz.id}`))!.grams).toBe(300);
    const gone = await deleteLog(rice.id);
    expect(gone).toMatchObject({ id: rice.id, grams: 200, deleted: false });
    expect((await db.foodLogs.get(rice.id))!.deleted).toBe(true);
    expect((await db.pantry.get(`pantry-${arroz.id}`))!.grams).toBe(500);
    await restoreLog(gone!);
    expect((await db.foodLogs.get(rice.id))!.deleted).toBe(false);
    expect((await db.pantry.get(`pantry-${arroz.id}`))!.grams).toBe(300);
    await expect(logEaten({ meal: 'jantar', foodId: arroz.id, grams: 0 })).rejects.toMatchObject({ message: 'Informe as gramas.' });
  });

  const stockOf = async (foodId: string) => (await db.pantry.get(`pantry-${foodId}`))!.grams;

  it('eating more than the counted stock empties it; deleting the item gives back only what it took', async () => {
    const { arroz } = await pantryFoods();
    await confirmPantry(arroz.id, 100);
    const big = await logEaten({ meal: 'almoco', foodId: arroz.id, grams: 150 });
    expect(big.stockTaken).toBe(100);
    expect(await stockOf(arroz.id)).toBe(0);
    // less eaten than logged: the 50 g that did not come from the stock go first
    await correctGrams(big.id, 120);
    expect(await stockOf(arroz.id)).toBe(0);
    const gone = await deleteLog(big.id);
    expect(await stockOf(arroz.id)).toBe(100); // with the bug: 150, more than there ever was
    await restoreLog(gone!);
    expect(await stockOf(arroz.id)).toBe(0);
  });

  it('an item eaten before the stock was counted never moves that count (delete or correct)', async () => {
    const { arroz } = await pantryFoods();
    vi.setSystemTime(at(24, 20));
    await confirmPantry(arroz.id, 900); // yesterday's count: eating today does not touch it
    vi.setSystemTime(at(25, 8));
    const breakfast = await logEaten({ meal: 'cafe', foodId: arroz.id, grams: 100 });
    expect(breakfast).not.toHaveProperty('stockTaken');
    vi.setSystemTime(at(25, 12));
    await confirmPantry(arroz.id, 300); // what is in the pot now
    vi.setSystemTime(at(25, 13));
    await correctGrams(breakfast.id, 80);
    expect(await stockOf(arroz.id)).toBe(300); // with the bug: 320
    await correctGrams(breakfast.id, 130);
    expect(await stockOf(arroz.id)).toBe(300);
    const gone = await deleteLog(breakfast.id);
    expect(await stockOf(arroz.id)).toBe(300); // with the bug: 430
    await restoreLog(gone!);
    expect(await stockOf(arroz.id)).toBe(300);
  });

  it('counted again after eating: deleting gives nothing back and Desfazer takes nothing again', async () => {
    const { arroz } = await pantryFoods();
    await confirmPantry(arroz.id, 500);
    vi.setSystemTime(at(25, 12));
    const lunch = await logEaten({ meal: 'almoco', foodId: arroz.id, grams: 100 });
    expect(await stockOf(arroz.id)).toBe(400);
    vi.setSystemTime(at(25, 15));
    await confirmPantry(arroz.id, 400); // the count already reflects the lunch
    const gone = await deleteLog(lunch.id);
    expect(await stockOf(arroz.id)).toBe(400); // with the bug: 500
    await restoreLog(gone!);
    expect(await stockOf(arroz.id)).toBe(400); // with the bug: 300 after the undo
    // eating after the count follows it as usual
    vi.setSystemTime(at(25, 19));
    const dinner = await logEaten({ meal: 'jantar', foodId: arroz.id, grams: 150 });
    expect(await stockOf(arroz.id)).toBe(250);
    await deleteLog(dinner.id);
    expect(await stockOf(arroz.id)).toBe(400);
  });

  it('"Comi" on a planned item remembers what it took, so deleting it gives back only that', async () => {
    const { arroz } = await pantryFoods();
    await confirmPantry(arroz.id, 60);
    const item = await put('foodLogs', newRecord<FoodLog>({
      day: DAY, meal: 'almoco', foodId: arroz.id, name: arroz.name, per100: arroz.per100, basis: 'pronto', estimate: false, grams: 150,
      status: 'planejado', order: 0,
    }));
    const eaten = await eatPlanned(item.id);
    expect(eaten).toMatchObject({ status: 'comido', stockTaken: 60, eatenAt: Date.now() });
    expect(await stockOf(arroz.id)).toBe(0);
    await deleteLog(item.id);
    expect(await stockOf(arroz.id)).toBe(60);
  });

  it('a stock from another day does not change when eating today', async () => {
    const { arroz } = await pantryFoods();
    vi.setSystemTime(at(24, 12));
    await confirmPantry(arroz.id, 500);
    vi.setSystemTime(at(25, 10));
    await logEaten({ meal: 'almoco', foodId: arroz.id, grams: 150 });
    expect(await db.pantry.get(`pantry-${arroz.id}`)).toMatchObject({ confirmedDay: '2026-11-24', grams: 500 });
  });

  it('confirming the stock today: yesterday\'s item becomes today\'s, with or without grams; it can leave the list', async () => {
    const { arroz } = await pantryFoods();
    vi.setSystemTime(at(24, 12));
    await confirmPantry(arroz.id, 300);
    vi.setSystemTime(at(25, 10));
    const uncounted = await confirmPantry(arroz.id);
    expect(uncounted).toMatchObject({ id: `pantry-${arroz.id}`, foodId: arroz.id, confirmedDay: DAY });
    expect(uncounted).not.toHaveProperty('grams');
    expect(await confirmPantry(arroz.id, 250.04)).toMatchObject({ confirmedDay: DAY, grams: 250 });
    expect(await db.pantry.count()).toBe(1);
    await expect(confirmPantry(arroz.id, -1)).rejects.toBeInstanceOf(NutritionValidationError);
    expect((await removeFromPantry(arroz.id))!.grams).toBe(250);
    expect((await db.pantry.get(`pantry-${arroz.id}`))!.deleted).toBe(true);
    expect((await confirmPantry(arroz.id, 100)).deleted).toBe(false);
  });
});

describe('targets and weigh-ins', () => {
  it('saving targets keeps the history: a new record from today, or today\'s replaced', async () => {
    vi.setSystemTime(at(20, 9));
    await saveTargets(weekTargets({ protein: 150, carbs: 240, fat: 60 }, { protein: 130, carbs: 200, fat: 70 }));
    vi.setSystemTime(at(25, 9));
    const first = await saveTargets(weekTargets({ protein: 170, carbs: 260, fat: 70 }, { protein: 150, carbs: 200, fat: 80 }));
    vi.setSystemTime(at(25, 11));
    const again = await saveTargets(weekTargets(TARGET, { protein: 150, carbs: 200, fat: 80 }));
    expect(again.id).toBe('ntarget-2026-11-25');
    expect(again.createdAt).toBe(first.createdAt);
    const all = await db.nutritionTargets.toArray();
    expect(all.map((t) => t.from).sort()).toEqual(['2026-11-20', '2026-11-25']);
    expect(targetFor(all, '2026-11-23')).toMatchObject({ protein: 150 });
    expect(targetFor(all, DAY)).toMatchObject({ protein: 160, carbs: 250, fat: 60 });
    await expect(saveTargets(weekTargets({ protein: -1, carbs: 1, fat: 1 }, TARGET))).rejects.toBeInstanceOf(NutritionValidationError);
  });

  it('a weigh-in never changes the targets; it is deleted (not edited) and Desfazer adds it again', async () => {
    const t = await saveTargets(weekTargets(TARGET, TARGET));
    await expect(addWeighIn(25)).rejects.toMatchObject({ message: 'Peso entre 30 e 300 kg.' });
    const w = await addWeighIn(80.26);
    expect(w).toMatchObject({ day: DAY, kg: 80.3 });
    expect(await db.nutritionTargets.toArray()).toEqual([t]);
    const gone = await deleteWeighIn(w.id);
    expect(gone!.id).toBe(w.id);
    expect((await db.weighIns.get(w.id))!.deleted).toBe(true);
    const back = await restoreWeighIn(gone!);
    expect(back.id).not.toBe(w.id);
    expect(back).toMatchObject({ day: DAY, kg: 80.3, deleted: false });
    expect(await db.nutritionTargets.toArray()).toEqual([t]);
  });

  it('Desfazer of a deleted weigh-in keeps which weigh-in is the day\'s latest', async () => {
    vi.setSystemTime(at(25, 7));
    const early = await addWeighIn(80);
    vi.setSystemTime(at(25, 8));
    await addWeighIn(79);
    const summary = async () => weighInSummary(await db.weighIns.toArray());
    expect(await summary()).toMatchObject({ average: 79, last: { kg: 79 } });
    vi.setSystemTime(at(25, 9));
    const gone = await deleteWeighIn(early.id);
    const back = await restoreWeighIn(gone!);
    expect(back.createdAt).toBe(early.createdAt);
    expect(back.updatedAt).toBeGreaterThan(early.createdAt);
    expect(await summary()).toMatchObject({ average: 79, last: { kg: 79 } }); // with the bug: 80
  });
});

describe('"Montar o resto do dia"', () => {
  async function ready() {
    const foods = await pantryFoods();
    await saveTargets(weekTargets(TARGET, TARGET));
    for (const f of Object.values(foods)) await confirmPantry(f.id);
    return foods;
  }

  it('is blocked, writing nothing, without a target or without stock confirmed today', async () => {
    const { arroz } = await pantryFoods();
    await confirmPantry(arroz.id);
    expect(await buildRestOfDay({ hunger: 'normal' })).toMatchObject({ ok: false, reason: 'sem-meta' });
    await removeFromPantry(arroz.id);
    await saveTargets(weekTargets(TARGET, TARGET));
    expect(await buildRestOfDay({ hunger: 'normal' })).toEqual({ ok: false, reason: 'sem-estoque', text: 'Confirme o estoque de hoje primeiro.' });
    expect(await db.foodLogs.count()).toBe(0);
  });

  it('writes the plan as planned items of the remaining meals and remembers the build on this device only', async () => {
    const { frango } = await ready();
    const eaten = await logEaten({ meal: 'cafe', foodId: frango.id, grams: 100 });
    const settingsBefore = await db.settings.get('settings');
    const out = await buildRestOfDay({ hunger: 'normal', afterTraining: 'jantar' });
    expect(out.ok).toBe(true);
    const planned = (await liveLogs()).filter((l) => l.status === 'planejado');
    expect(planned.length).toBe(out.ok ? out.items.length : -1);
    expect(new Set(planned.map((l) => l.meal))).toEqual(new Set(['lanche', 'almoco', 'tarde', 'jantar', 'ceia']));
    expect(planned.every((l) => l.day === DAY && l.name && l.per100 && l.grams >= 10)).toBe(true);
    expect(planned.every((l) => l.id === plannedLogId(DAY, l.meal, l.foodId))).toBe(true);
    expect(await db.foodLogs.get(eaten.id)).toEqual(eaten);
    // the build is in the local meta; the shared Settings record is not rewritten (a change from another device survives)
    const build = await getNutritionBuild();
    expect(build).toEqual({ day: DAY, hunger: 'normal', afterTraining: 'jantar' });
    expect(trainingTags(NUTRITION_MEALS, build, DAY)).toEqual({ tarde: 'pré-treino', jantar: 'pós-treino' });
    expect(await db.settings.get('settings')).toEqual(settingsBefore);
    expect(await db.outbox.get(`foodLogs:${planned[0]!.id}`)).toBeDefined();
  });

  it('training before the first meal left can be chosen (it becomes pós-treino)', async () => {
    await ready();
    const out = await buildRestOfDay({ hunger: 'normal', afterTraining: 'cafe' });
    expect(out.ok).toBe(true);
    expect(await getNutritionBuild()).toEqual({ day: DAY, hunger: 'normal', afterTraining: 'cafe' });
    expect(trainingTags(NUTRITION_MEALS, await getNutritionBuild(), DAY)).toEqual({ cafe: 'pós-treino' });
  });

  it('two devices building the same plan before a sync write the same records (no doubled plan)', async () => {
    await ready();
    const plannedNow = async () => (await liveLogs()).filter((l) => l.status === 'planejado')
      .map((l) => ({ id: l.id, grams: l.grams })).sort((a, b) => (a.id < b.id ? -1 : 1));
    await buildRestOfDay({ hunger: 'normal' });
    const first = await plannedNow();
    // the "other device": same data, no planned items yet
    await db.foodLogs.clear();
    await buildRestOfDay({ hunger: 'normal' });
    expect(await plannedNow()).toEqual(first);
    // building again on one device rewrites the same ids: still one item per meal and food
    await buildRestOfDay({ hunger: 'normal' });
    expect(await plannedNow()).toEqual(first);
  });

  it('rebuilding never touches eaten items and replaces only the planned items of meals with nothing eaten', async () => {
    const { arroz } = await ready();
    await buildRestOfDay({ hunger: 'normal' });
    const firstPlan = (await liveLogs()).filter((l) => l.status === 'planejado');
    const lunchPlanned = firstPlan.filter((l) => l.meal === 'almoco');
    expect(lunchPlanned.length).toBeGreaterThan(0);
    // lunch: one planned item eaten ("Comi" with other grams), one eaten from the list
    const eatenPlanned = await eatPlanned(lunchPlanned[0]!.id, 130);
    expect(eatenPlanned).toMatchObject({ status: 'comido', grams: 130 });
    const typed = await logEaten({ meal: 'almoco', foodId: arroz.id, grams: 90 });
    const eatenBefore = (await liveLogs()).filter((l) => l.status === 'comido');

    const out = await buildRestOfDay({ hunger: 'muita' });
    expect(out.ok && out.meals).toEqual(['tarde', 'jantar', 'ceia']);
    const after = await liveLogs();
    // eaten items exactly as they were
    expect(after.filter((l) => l.status === 'comido').sort((a, b) => (a.id < b.id ? -1 : 1)))
      .toEqual(eatenBefore.sort((a, b) => (a.id < b.id ? -1 : 1)));
    expect(after.find((l) => l.id === typed.id)).toEqual(typed);
    // lunch has something eaten: its other planned items stay; breakfast and the morning snack (nothing eaten) lose theirs
    const stillLunch = lunchPlanned.slice(1).map((l) => l.id);
    expect(after.filter((l) => l.status === 'planejado' && l.meal === 'almoco').map((l) => l.id).sort()).toEqual(stillLunch.sort());
    expect(after.some((l) => l.status === 'planejado' && (l.meal === 'cafe' || l.meal === 'lanche'))).toBe(false);
    for (const l of firstPlan.filter((x) => x.meal === 'cafe' || x.meal === 'lanche')) expect((await db.foodLogs.get(l.id))!.deleted).toBe(true);
    // the rebuilt meals hold exactly the new plan (an old item of the same food and meal is rewritten in place)
    const rebuiltMeals = ['tarde', 'jantar', 'ceia'];
    const fresh = after.filter((l) => l.status === 'planejado' && rebuiltMeals.includes(l.meal));
    const items = out.ok ? out.items : [];
    expect(fresh.map((l) => `${l.meal}:${l.foodId}:${l.grams}`).sort()).toEqual(items.map((i) => `${i.meal}:${i.foodId}:${i.grams}`).sort());
    for (const l of firstPlan.filter((x) => rebuiltMeals.includes(x.meal) && !fresh.some((f) => f.id === x.id))) {
      expect((await db.foodLogs.get(l.id))!.deleted).toBe(true);
    }
    const tarde = fresh.filter((l) => l.meal === 'tarde');
    expect(tarde.map((l) => l.order).sort((a, b) => a - b)).toEqual(tarde.map((_, i) => i));
    // the kept lunch items count: what the screen shows after the build is what the generator aimed at
    const day = nutritionDay({ day: DAY, targets: await db.nutritionTargets.toArray(), logs: after });
    for (const m of ['protein', 'carbs', 'fat'] as const) expect(day.afterPlan![m], m).toBeCloseTo(out.ok ? out.afterPlan[m] : NaN, 6);
  });

  it('a rebuild after a partial lunch neither passes the target with the kept items nor plans the same counted stock twice', async () => {
    const { frango, arroz, azeite } = await ready();
    await confirmPantry(arroz.id, 300);
    // lunch: the chicken was eaten first; 200 g of rice and 10 g of olive oil are still planned there
    await logEaten({ meal: 'almoco', foodId: frango.id, grams: 150 });
    const keep = [{ f: arroz, grams: 200 }, { f: azeite, grams: 10 }];
    for (const { f, grams } of keep) {
      await put('foodLogs', newRecord<FoodLog>({
        id: plannedLogId(DAY, 'almoco', f.id), day: DAY, meal: 'almoco', foodId: f.id, name: f.name, per100: f.per100, basis: 'pronto',
        estimate: false, grams, status: 'planejado', order: 0,
      }));
    }
    const out = await buildRestOfDay({ hunger: 'normal' });
    expect(out.ok && out.meals).toEqual(['tarde', 'jantar', 'ceia']);
    const logs = await liveLogs();
    const day = nutritionDay({ day: DAY, targets: await db.nutritionTargets.toArray(), logs });
    expect(day.afterPlan!.carbs).toBeGreaterThanOrEqual(-PLAN_TOLERANCE.carbs); // with the bug: passou about 58 g
    const plannedRice = logs.filter((l) => l.status === 'planejado' && l.foodId === arroz.id).reduce((s, l) => s + l.grams, 0);
    expect(plannedRice).toBeLessThanOrEqual(300); // with the bug: the 200 g kept, plus more rice for the afternoon and dinner
  });

  it('"Comi" and "Tirar" on planned items: the stock follows only what was eaten', async () => {
    const { arroz } = await ready();
    await confirmPantry(arroz.id, 1000);
    await buildRestOfDay({ hunger: 'normal' });
    const planned = (await liveLogs()).filter((l) => l.status === 'planejado');
    const rice = planned.find((l) => l.foodId === arroz.id)!;
    const other = planned.find((l) => l.foodId !== arroz.id)!;
    expect((await removePlanned(other.id))!.id).toBe(other.id);
    expect((await db.foodLogs.get(other.id))!.deleted).toBe(true);
    expect((await db.pantry.get(`pantry-${arroz.id}`))!.grams).toBe(1000);
    await eatPlanned(rice.id);
    expect(await db.foodLogs.get(rice.id)).toMatchObject({ status: 'comido', grams: rice.grams });
    expect((await db.pantry.get(`pantry-${arroz.id}`))!.grams).toBe(1000 - rice.grams);
    expect(await removePlanned(rice.id)).toBeUndefined(); // already eaten: "Tirar" does nothing
    await expect(eatPlanned(rice.id)).rejects.toThrow();
  });
});

describe('settings and XP', () => {
  it('meals switched on: kept in day order, at least one', async () => {
    expect((await saveNutritionSettings({ meals: ['jantar', 'cafe'] })).meals).toEqual(['cafe', 'jantar']);
    expect((await db.settings.get('settings'))!.nutrition!.meals).toEqual(['cafe', 'jantar']);
    await expect(saveNutritionSettings({ meals: [] })).rejects.toMatchObject({ message: 'Deixe pelo menos uma refeição ligada.' });
    expect((await setMealOn('almoco', true)).meals).toEqual(['cafe', 'almoco', 'jantar']);
    expect((await setMealOn('cafe', false)).meals).toEqual(['almoco', 'jantar']);
  });

  it('nothing in the nutrition gives XP', async () => {
    const before = await db.xpEvents.count();
    const { arroz } = await pantryFoods();
    await saveTargets(weekTargets(TARGET, TARGET));
    await confirmPantry(arroz.id, 500);
    await logEaten({ meal: 'almoco', foodId: arroz.id, grams: 100 });
    await buildRestOfDay({ hunger: 'normal' });
    await addWeighIn(70);
    expect(await db.xpEvents.count()).toBe(before);
  });

  it('the v15 tables exist with their indexes', () => {
    expect(db.verno).toBeGreaterThanOrEqual(15);
    const idx = (t: string) => db.table(t).schema.indexes.map((i) => i.name);
    expect(idx('foods')).toEqual(['name']);
    expect(idx('nutritionTargets')).toEqual(['from']);
    expect(idx('foodLogs')).toEqual(['day']);
    expect(idx('pantry')).toEqual(['foodId']);
    expect(idx('weighIns')).toEqual(['day']);
  });
});

