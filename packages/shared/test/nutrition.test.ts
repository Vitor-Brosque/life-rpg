import { describe, expect, it } from 'vitest';
import type { Food, FoodLog, NutritionMeal, NutritionTarget, PantryItem, WeighIn } from '../src/types';
import {
  DEFAULT_MAX_PORTION, NO_FAT_NOTE, NUTRITION_MEALS, NUTRITION_MEAL_LABEL, PLAN_TOLERANCE, daySummaryText, estimateText, foodChoices,
  goodFor, goodForText, gramsText, heldAfter, intText,
  kcalWarning, logGramsIssue, macroKcal, maxPortionOf, mealViews, mealsWithoutEaten, nutrientsOf, nutrientsText, nutritionDay,
  nutritionNotes, nutritionSettingsOf, optimizePortions, pantryStatusText, parseDecimal, planRestOfDay, plannedLogId, portionText,
  recipePer100, recipeValues, remainingMeals, remainingText, roundKg, roundPortion, stockFollows, stockLeft, suggestFood, sumNutrients,
  targetFor, targetGroups, targetHistoryText, trainingMeals, trainingTags, unitCountText, validateFood, validateRecipe, weekTargetIssues,
  weekTargets, weighInIssue, weighInSummary, weightChangeText, weightText, type FoodInput, type PlanInput, type PlannedItem,
} from '../src/nutrition';

// Every food and number here is invented (spec: no real data of the person in code, tests or docs).

const base = { createdAt: 1, updatedAt: 1, deleted: false };
const DAY = '2026-11-25'; // a Wednesday

function food(id: string, name: string, group: Food['group'], p: [number, number, number, number], extra: Partial<Food> = {}): Food {
  return {
    ...base, id, name, group, per100: { kcal: p[0], protein: p[1], carbs: p[2], fat: p[3] },
    basis: 'pronto', source: 'tabela', like: 'normal', ...extra,
  };
}

const FRANGO = food('frango', 'Peito de frango', 'proteina', [165, 31, 0, 3.6], { like: 'gosto' });
const OVO = food('ovo', 'Ovo cozido', 'proteina', [155, 13, 1.1, 10.6], { unit: { name: 'ovo', grams: 50 } });
const IOGURTE = food('iogurte', 'Iogurte natural', 'laticinio', [61, 3.5, 4.7, 3.3]);
const ARROZ = food('arroz', 'Arroz branco', 'carboidrato', [130, 2.7, 28, 0.3], { like: 'gosto' });
const PAO = food('pao', 'Pão de forma', 'carboidrato', [250, 9, 47, 3.5], { unit: { name: 'fatia', grams: 25 } });
const BANANA = food('banana', 'Banana', 'fruta', [89, 1.1, 23, 0.3], { unit: { name: 'unidade', grams: 80 } });
const BROCOLIS = food('brocolis', 'Brócolis', 'verdura', [35, 2.4, 7, 0.4]);
const AZEITE = food('azeite', 'Azeite', 'gordura', [884, 0, 0, 100]);
const ALL = [FRANGO, OVO, IOGURTE, ARROZ, PAO, BANANA, BROCOLIS, AZEITE];

const TARGETS: NutritionTarget[] = [{
  ...base, id: 'ntarget-2026-11-01', from: '2026-11-01',
  byWeekday: weekTargets({ protein: 160, carbs: 250, fat: 60 }, { protein: 140, carbs: 200, fat: 70 }),
}];

const stock = (foods: readonly Food[], day = DAY, grams: Record<string, number> = {}): PantryItem[] =>
  foods.map((f) => ({ ...base, id: `pantry-${f.id}`, foodId: f.id, confirmedDay: day, ...(grams[f.id] !== undefined ? { grams: grams[f.id] } : {}) }));

let seq = 0;
function log(meal: NutritionMeal, f: Food, grams: number, status: FoodLog['status'] = 'comido', extra: Partial<FoodLog> = {}): FoodLog {
  seq += 1;
  return {
    ...base, id: `log${seq}`, day: DAY, meal, foodId: f.id, name: f.name, per100: f.per100, basis: f.basis,
    estimate: f.source === 'estimativa', grams, status, order: seq, ...extra,
  };
}

function plan(p: Partial<PlanInput> = {}) {
  const out = planRestOfDay({
    day: DAY, targets: TARGETS, logs: [], meals: NUTRITION_MEALS, foods: ALL, pantry: stock(ALL), hunger: 'normal', ...p,
  });
  if (!out.ok) throw new Error(`blocked: ${out.reason}`);
  return out;
}

const of = (items: readonly PlannedItem[], meal: NutritionMeal) => items.filter((i) => i.meal === meal);
const gramsOf = (items: readonly PlannedItem[], meal: NutritionMeal, foodId: string) =>
  of(items, meal).filter((i) => i.foodId === foodId).reduce((s, i) => s + i.grams, 0);
const byId = new Map(ALL.map((f) => [f.id, f]));
const carbsOf = (items: readonly PlannedItem[], meal: NutritionMeal) =>
  of(items, meal).reduce((s, i) => s + nutrientsOf(byId.get(i.foodId)!.per100, i.grams).carbs, 0);

describe('nutrient math', () => {
  it('an item is grams × value per 100 g ÷ 100, fiber only when known', () => {
    expect(nutrientsOf(ARROZ.per100, 150)).toEqual({ kcal: 195, protein: expect.closeTo(4.05, 6), carbs: 42, fat: expect.closeTo(0.45, 6) });
    expect(nutrientsOf({ ...ARROZ.per100, fiber: 2 }, 50).fiber).toBe(1);
    expect(sumNutrients([{ kcal: 1, protein: 1, carbs: 1, fat: 1 }, { kcal: 1, protein: 1, carbs: 1, fat: 1, fiber: 3 }])).toEqual({ kcal: 2, protein: 2, carbs: 2, fat: 2, fiber: 3 });
    expect(sumNutrients([{ kcal: 1, protein: 1, carbs: 1, fat: 1 }])).not.toHaveProperty('fiber');
  });

  it('meals: eaten and planned apart, in day order; a meal switched off still shows when it has items', () => {
    const logs = [
      log('almoco', ARROZ, 100), log('cafe', PAO, 50), log('almoco', FRANGO, 120, 'planejado'),
      log('ceia', IOGURTE, 170, 'comido', { estimate: true }), log('cafe', OVO, 50, 'comido', { deleted: true }),
    ];
    const views = mealViews(logs, DAY, ['cafe', 'almoco', 'jantar']);
    expect(views.map((v) => v.meal)).toEqual(['cafe', 'almoco', 'jantar', 'ceia']);
    const almoco = views[1]!;
    expect(almoco.eaten.map((l) => l.foodId)).toEqual(['arroz']);
    expect(almoco.planned.map((l) => l.foodId)).toEqual(['frango']);
    expect(almoco.eatenTotals).toMatchObject({ kcal: 130, carbs: 28, grams: 100, estimate: false });
    expect(views[0]!.eatenTotals.kcal).toBe(125);
    expect(views[3]!.eatenTotals.estimate).toBe(true);
  });

  it('the day: target, eaten, planned, what is left and what is left after the plan', () => {
    const logs = [log('cafe', PAO, 100), log('almoco', FRANGO, 200, 'planejado'), log('cafe', OVO, 50, 'comido', { day: '2026-11-24' })];
    const d = nutritionDay({ day: DAY, targets: TARGETS, logs });
    expect(d.target).toEqual({ protein: 160, carbs: 250, fat: 60, kcal: 2180, from: '2026-11-01' });
    expect(d.eaten).toMatchObject({ kcal: 250, protein: 9, carbs: 47, fat: 3.5 });
    expect(d.planned).toMatchObject({ kcal: 330, protein: 62 });
    expect(d.remaining).toMatchObject({ kcal: 1930, protein: 151, carbs: 203 });
    expect(d.afterPlan).toMatchObject({ kcal: 1600, protein: 89 });
    expect(d.estimate).toBe(false);
    expect(nutritionDay({ day: DAY, targets: [], logs })).not.toHaveProperty('remaining');
  });
});

describe('recipes', () => {
  it('per 100 g = sum of the ingredients × 100 ÷ final weight (the cooking fat is an ingredient)', () => {
    const per100 = recipePer100([{ per100: FRANGO.per100, grams: 300 }, { per100: ARROZ.per100, grams: 200 }, { per100: AZEITE.per100, grams: 10 }], 600);
    expect(per100.kcal).toBeCloseTo(843.4 / 6, 6);
    expect(per100.protein).toBeCloseTo(16.4, 6);
    expect(per100.carbs).toBeCloseTo(56 / 6, 6);
    expect(per100.fat).toBeCloseTo(21.4 / 6, 6);
  });

  it('an estimated ingredient makes the recipe estimated; a missing one is reported', () => {
    const est = { ...AZEITE, id: 'oleo', source: 'estimativa' as const };
    expect(recipeValues({ ingredients: [{ foodId: 'frango', grams: 100 }, { foodId: 'oleo', grams: 5 }], yieldGrams: 90 }, [FRANGO, est]).source).toBe('estimativa');
    expect(recipeValues({ ingredients: [{ foodId: 'frango', grams: 100 }], yieldGrams: 90 }, [{ ...FRANGO, source: 'rotulo' }]).source).toBe('rotulo');
    expect(recipeValues({ ingredients: [{ foodId: 'frango', grams: 100 }, { foodId: 'x', grams: 1 }], yieldGrams: 90 }, [FRANGO]).missing).toEqual([1]);
  });

  it('validateRecipe: computes per100, is "pronto", and notes a recipe without cooking fat', () => {
    const ok = validateRecipe({ name: ' Frango com arroz ', ingredients: [{ foodId: 'frango', grams: 300 }, { foodId: 'arroz', grams: 200 }, { foodId: 'azeite', grams: 10 }], yieldGrams: 600, group: 'proteina', like: 'gosto' }, ALL);
    expect(ok.issues).toEqual([]);
    expect(ok.food).toMatchObject({ name: 'Frango com arroz', basis: 'pronto', source: 'tabela', recipe: { yieldGrams: 600 } });
    expect(ok.food!.per100.protein).toBeCloseTo(16.4, 6);
    expect(ok.note).toBeUndefined();
    const noFat = validateRecipe({ name: 'Frango', ingredients: [{ foodId: 'frango', grams: 300 }], yieldGrams: 250, group: 'proteina', like: 'normal' }, ALL);
    expect(noFat.note).toBe(NO_FAT_NOTE);
    expect(noFat.food).toBeDefined();
  });

  it('validateRecipe refuses no ingredient, no final weight, itself, a deleted food and an impossible yield', () => {
    const issues = (input: Partial<Parameters<typeof validateRecipe>[0]>, selfId?: string) => validateRecipe(
      { name: 'R', ingredients: [{ foodId: 'frango', grams: 100 }], yieldGrams: 90, group: 'outro', like: 'normal', ...input }, ALL, selfId,
    ).issues;
    expect(issues({ ingredients: [] })).toEqual([{ field: 'ingredients', message: 'Inclua pelo menos um ingrediente.' }]);
    expect(issues({ yieldGrams: undefined })).toEqual([{ field: 'yieldGrams', message: 'Informe o rendimento final em gramas.' }]);
    expect(issues({ ingredients: [{ foodId: 'r1', grams: 10 }] }, 'r1')[0]!.message).toBe('Uma receita não pode usar ela mesma.');
    expect(issues({ ingredients: [{ foodId: 'apagado', grams: 10 }] })[0]!.message).toBe('Este alimento foi apagado.');
    expect(issues({ ingredients: [{ foodId: 'frango', grams: undefined }] })[0]).toEqual({ field: 'ingredients.0', message: 'Preencha este campo.' });
    expect(issues({ ingredients: [{ foodId: 'azeite', grams: 100 }], yieldGrams: 50 })[0]!.field).toBe('yieldGrams');
  });
});

describe('targets', () => {
  const t = (id: string, from: string, protein: number, extra: Partial<NutritionTarget> = {}): NutritionTarget => ({
    ...base, id, from, byWeekday: weekTargets({ protein, carbs: 200, fat: 60 }, { protein: protein - 20, carbs: 180, fat: 70 }), ...extra,
  });
  const history = [t('a', '2026-11-10', 150), t('b', '2026-11-20', 170), t('c', '2026-11-24', 999, { deleted: true })];

  it('each day uses the record with the greatest from ≤ day, and its weekday', () => {
    expect(targetFor(history, '2026-11-09')).toBeUndefined();
    expect(targetFor(history, '2026-11-18')).toMatchObject({ protein: 150, from: '2026-11-10' });
    expect(targetFor(history, '2026-11-20')).toMatchObject({ protein: 170, from: '2026-11-20' });
    expect(targetFor(history, '2026-11-25')).toMatchObject({ protein: 170, carbs: 200, fat: 60 });
    expect(targetFor(history, '2026-11-28')).toMatchObject({ protein: 150, carbs: 180, fat: 70 }); // Saturday
  });

  it('kcal = 4 × P + 4 × C + 9 × G', () => {
    expect(macroKcal({ protein: 170, carbs: 260, fat: 70 })).toBe(2350);
    expect(targetFor(history, '2026-11-25')!.kcal).toBe(4 * 170 + 4 * 200 + 9 * 60);
  });

  it('two groups on screen, seven days stored; the history line', () => {
    const days = weekTargets({ protein: 170, carbs: 260, fat: 70 }, { protein: 150, carbs: 200, fat: 80 });
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ protein: 150, carbs: 200, fat: 80 });
    expect(days[3]).toEqual({ protein: 170, carbs: 260, fat: 70 });
    expect(targetGroups({ byWeekday: days })).toEqual({ weekdays: days[1], weekend: days[6] });
    expect(targetHistoryText({ from: '2026-11-11', byWeekday: days }))
      .toBe('Desde 11/11: seg a sex P 170 · C 260 · G 70 · 2.350 kcal; sáb e dom P 150 · C 200 · G 80 · 2.120 kcal');
    const same = weekTargets({ protein: 170, carbs: 260, fat: 70 }, { protein: 170, carbs: 260, fat: 70 });
    expect(targetHistoryText({ from: '2026-11-11', byWeekday: same })).toBe('Desde 11/11: P 170 · C 260 · G 70 · 2.350 kcal');
  });

  it('target issues: seven days, numbers ≥ 0', () => {
    expect(weekTargetIssues(weekTargets({ protein: 1, carbs: 1, fat: 1 }, { protein: 1, carbs: 1, fat: 1 }))).toEqual([]);
    expect(weekTargetIssues([])[0]!.field).toBe('byWeekday');
    const days = weekTargets({ protein: 170, carbs: 260, fat: 70 }, { protein: 150, carbs: 200, fat: 80 });
    days[3] = { protein: -1, carbs: 2000, fat: 70 };
    expect(weekTargetIssues(days)).toEqual([
      { field: 'byWeekday.3.protein', message: 'Use zero ou mais.' },
      { field: 'byWeekday.3.carbs', message: 'No máximo 1.000 g.' },
    ]);
  });
});

describe('validation', () => {
  const input = (p: Partial<FoodInput> = {}): FoodInput => ({
    name: 'Peito de frango', per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 }, basis: 'pronto', source: 'rotulo',
    group: 'proteina', like: 'gosto', ...p,
  });

  it('parseDecimal accepts a comma; empty is undefined, anything else null', () => {
    expect(parseDecimal(' 12,5 ')).toBe(12.5);
    expect(parseDecimal('7.25')).toBe(7.25);
    expect(parseDecimal('3,5')).toBe(3.5);
    expect(parseDecimal('3.5')).toBe(3.5);
    expect(parseDecimal('150')).toBe(150);
    expect(parseDecimal('')).toBeUndefined();
    expect(parseDecimal('-3')).toBeNull();
    expect(parseDecimal('1,2,3')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
  });

  it('parseDecimal reads a dot before exactly three digits as thousands, as the app writes them ("Tem hoje · 1.500 g")', () => {
    expect(parseDecimal(intText(1500))).toBe(1500);
    expect(parseDecimal('1.500')).toBe(1500);
    expect(parseDecimal('1.200')).toBe(1200);
    expect(parseDecimal('12.345')).toBe(12345);
    expect(parseDecimal('100.000')).toBe(100_000);
    expect(parseDecimal('1.500,5')).toBe(1500.5);
    expect(parseDecimal('0.500')).toBe(0.5);   // a leading zero is no thousands group
    expect(parseDecimal('1.5000')).toBe(1.5);  // four digits: a decimal point
    expect(parseDecimal('1.50')).toBe(1.5);
    expect(parseDecimal('1.500.')).toBeNull();
    expect(parseDecimal('1.50,5')).toBeNull();
  });

  it('a valid food is stored trimmed, with its optional unit and portion', () => {
    const r = validateFood(input({ name: '  Pão  ', unit: { name: ' fatia ', grams: 25 }, maxPortion: 100, per100: { kcal: 250, protein: 9, carbs: 47, fat: 3.5, fiber: 2 } }));
    expect(r.issues).toEqual([]);
    expect(r.food).toEqual({
      name: 'Pão', per100: { kcal: 250, protein: 9, carbs: 47, fat: 3.5, fiber: 2 }, basis: 'pronto', source: 'rotulo', group: 'proteina',
      like: 'gosto', unit: { name: 'fatia', grams: 25 }, maxPortion: 100,
    });
    expect(validateFood(input({ unit: { name: '' } })).food).not.toHaveProperty('unit');
  });

  it('invalid numbers show the sentence in the field and nothing saves (§7)', () => {
    const r = validateFood(input({ name: ' ', per100: { kcal: 950, protein: 120, carbs: -1, fat: undefined, fiber: null }, maxPortion: 0, unit: { name: 'fatia' } }));
    expect(r.food).toBeUndefined();
    expect(r.issues).toEqual([
      { field: 'name', message: 'Dê um nome.' },
      { field: 'kcal', message: 'No máximo 900 kcal por 100 g.' },
      { field: 'protein', message: 'No máximo 100 g por 100 g.' },
      { field: 'carbs', message: 'Use zero ou mais.' },
      { field: 'fat', message: 'Preencha este campo.' },
      { field: 'fiber', message: 'Use um número (aceita vírgula).' },
      { field: 'unitGrams', message: 'Preencha este campo.' },
      { field: 'maxPortion', message: 'Use um número maior que zero.' },
    ]);
  });

  it('kcal more than 10% away from 4/4/9 × the macros: a warning, never a block', () => {
    expect(kcalWarning({ kcal: 165, protein: 31, carbs: 0, fat: 3.6 })).toBeUndefined();
    expect(kcalWarning({ kcal: 100, protein: 10, carbs: 10, fat: 1 })).toBe('As calorias não batem com os macros: pela soma dariam 89 kcal. Confira os valores.');
    expect(kcalWarning({ kcal: 100 })).toBeUndefined();
    expect(validateFood(input({ per100: { kcal: 100, protein: 10, carbs: 10, fat: 1 } })).food).toBeDefined();
  });

  it('grams of an item and weigh-ins', () => {
    expect(logGramsIssue(undefined)).toBe('Informe as gramas.');
    expect(logGramsIssue(0)).toBe('Informe as gramas.');
    expect(logGramsIssue(6000)).toBe('No máximo 5.000 g.');
    expect(logGramsIssue(120)).toBeUndefined();
    expect(weighInIssue(25)).toBe('Peso entre 30 e 300 kg.');
    expect(weighInIssue(301)).toBe('Peso entre 30 e 300 kg.');
    expect(weighInIssue(72.44)).toBeUndefined();
    expect(roundKg(72.44)).toBe(72.4);
  });
});

describe('stock', () => {
  it('only what was confirmed today is available; the status line', () => {
    expect(pantryStatusText({ confirmedDay: DAY, grams: 300 }, DAY)).toBe('Tem hoje · 300 g');
    expect(pantryStatusText({ confirmedDay: DAY, grams: 300 }, DAY, 'cru')).toBe('Tem hoje · 300 g (cru)');
    expect(pantryStatusText({ confirmedDay: DAY }, DAY)).toBe('Tem hoje');
    expect(pantryStatusText({ confirmedDay: '2026-11-24', grams: 300 }, DAY)).toBe('Tinha em 24/11');
  });

  it('the stock follows an eaten item only when counted, confirmed that day and not counted again after it was eaten', () => {
    const item: PantryItem = { ...base, id: 'pantry-arroz', foodId: 'arroz', confirmedDay: DAY, grams: 300, countedAt: 1000 };
    expect(stockFollows(item, DAY, 1000)).toBe(true);
    expect(stockFollows(item, DAY, 5000)).toBe(true);
    expect(stockFollows(item, DAY, 999)).toBe(false); // eaten before this count: the count already reflects it
    expect(stockFollows({ ...item, countedAt: undefined }, DAY, 1)).toBe(true);
    expect(stockFollows({ ...item, confirmedDay: '2026-11-24' }, DAY, 5000)).toBe(false);
    expect(stockFollows({ ...item, grams: undefined }, DAY, 5000)).toBe(false);
    expect(stockFollows({ ...item, deleted: true }, DAY, 5000)).toBe(false);
    expect(stockFollows(undefined, DAY, 5000)).toBe(false);
  });

  it('an eaten item holds at most what it took: eating clamps at the stock, and only that goes back', () => {
    // eating 120 of 300: it holds 120
    expect(heldAfter(0, 0, 120, 300)).toBe(120);
    // eating 150 of 100: it holds 100 (the stock ends at 0), and deleting it gives back 100, not 150
    const held = heldAfter(0, 0, 150, 100);
    expect(held).toBe(100);
    expect(100 - held).toBe(0);
    expect(held - heldAfter(held, 150, 0, 0)).toBe(100);
    // corrected 150 → 120: the 50 g eaten from elsewhere go first, nothing goes back
    expect(heldAfter(100, 150, 120, 0)).toBe(100);
    // corrected 150 → 80: 20 g go back
    expect(heldAfter(100, 150, 80, 0)).toBe(80);
    // corrected up 120 → 200 with 30 g left: it takes only the 30 g
    expect(heldAfter(120, 120, 200, 30)).toBe(150);
    // nothing taken (not counted when eaten): nothing ever goes back
    expect(heldAfter(0, 100, 0, 300)).toBe(0);
    expect(heldAfter(0, 100, 80, 300)).toBe(0);
  });

  it('the stock left after the planned items of the day (eaten ones already took theirs)', () => {
    const pantry = stock([ARROZ, FRANGO], DAY, { arroz: 300 });
    const left = stockLeft(pantry, [log('almoco', ARROZ, 200, 'planejado'), log('jantar', ARROZ, 250, 'planejado'), log('almoco', ARROZ, 50)], DAY);
    expect(left.get('arroz')).toBe(0);
    expect(left.get('frango')).toBe(Infinity);
    expect(left.has('pao')).toBe(false);
    expect(stockLeft(stock([ARROZ], '2026-11-24', { arroz: 300 }), [], DAY).size).toBe(0);
  });

  it('choosing a food: search by name in any case or accent, today\'s stock first', () => {
    expect(foodChoices(ALL, 'brocolis', [], DAY).map((f) => f.id)).toEqual(['brocolis']);
    const pantry = stock([OVO], DAY).concat(stock([PAO], '2026-11-24'));
    expect(foodChoices(ALL, 'o', pantry, DAY).map((f) => f.id).slice(0, 3)).toEqual(['ovo', 'arroz', 'brocolis']);
  });
});

describe('texts', () => {
  it('numbers in pt-BR: integers, kcal, grams, passou, (cru), estimado', () => {
    expect(intText(1180)).toBe('1.180');
    expect(intText(1234567.4)).toBe('1.234.567');
    expect(intText(-0.3)).toBe('0');
    expect(intText(-12)).toBe('-12');
    expect(remainingText(35.2)).toBe('35 g');
    expect(remainingText(-12)).toBe('passou 12 g');
    expect(remainingText(-120.4, 'kcal')).toBe('passou 120 kcal');
    expect(gramsText(150, 'cru')).toBe('150 g (cru)');
    expect(gramsText(150, 'pronto')).toBe('150 g');
    expect(estimateText(true)).toBe('estimado');
    expect(estimateText(false)).toBe('');
    expect(nutrientsText(nutrientsOf(ARROZ.per100, 150))).toBe('195 kcal · P 4 · C 42 · G 0');
  });

  it('the summary of the day, with and without a target', () => {
    const eaten = { kcal: 1180, protein: 80, carbs: 140, fat: 35, grams: 0, estimate: false };
    expect(daySummaryText({ eaten, target: { protein: 170, carbs: 260, fat: 70, kcal: 2350, from: DAY } }))
      .toBe('Hoje: 1.180 de 2.350 kcal · P 80/170 · C 140/260 · G 35/70');
    expect(daySummaryText({ eaten })).toBe('Hoje: 1.180 kcal · P 80 · C 140 · G 35');
  });

  it('portions in units, weights', () => {
    expect(portionText(50, PAO)).toBe('2 fatias · 50 g');
    expect(portionText(25, PAO)).toBe('1 fatia · 25 g');
    expect(portionText(60, PAO)).toBe('60 g');
    expect(portionText(150, { basis: 'cru' })).toBe('150 g (cru)');
    expect(unitCountText(3, 'colher de sopa')).toBe('3 colheres de sopa');
    expect(unitCountText(2, 'pão')).toBe('2 pães');
    expect(unitCountText(2, 'ovo')).toBe('2 ovos');
    expect(weightText(72.4)).toBe('72,4 kg');
    expect(weightChangeText(-0.6)).toBe('-0,6 kg');
    expect(weightChangeText(0.4)).toBe('+0,4 kg');
    expect(weightChangeText(0)).toBe('0 kg');
  });
});

describe('weigh-ins', () => {
  it('last one, average of the last 7 days with a weigh-in, and the change from the 7 before', () => {
    const w = (id: string, day: string, kg: number, createdAt = 1, deleted = false): WeighIn => ({ ...base, id, day, kg, createdAt, deleted });
    const list = [
      ...Array.from({ length: 7 }, (_, i) => w(`old${i}`, `2026-11-0${i + 1}`, 80)),
      ...Array.from({ length: 6 }, (_, i) => w(`new${i}`, `2026-11-${10 + i}`, 79)),
      w('first', '2026-11-20', 90, 1), w('later', '2026-11-20', 78.6, 2), w('gone', '2026-11-21', 50, 3, true),
    ];
    const s = weighInSummary(list);
    expect(s.last!.id).toBe('later');
    expect(s.days).toBe(7);
    expect(s.average).toBe(roundKg((79 * 6 + 78.6) / 7));
    expect(s.previousAverage).toBe(80);
    expect(s.change).toBe(roundKg(s.average! - 80));
    expect(weighInSummary([])).toEqual({ days: 0 });
    expect(weighInSummary([w('a', DAY, 70)])).toEqual({ days: 1, last: expect.objectContaining({ id: 'a' }), average: 70 });
  });
});

describe('settings and training', () => {
  it('six meals with their names; all on by default; a broken list falls back to all', () => {
    expect(NUTRITION_MEALS.map((m) => NUTRITION_MEAL_LABEL[m])).toEqual(['Café da manhã', 'Lanche da manhã', 'Almoço', 'Café da tarde', 'Jantar', 'Ceia']);
    expect(nutritionSettingsOf(undefined).meals).toEqual(NUTRITION_MEALS);
    expect(nutritionSettingsOf({ nutrition: { meals: ['jantar', 'cafe', 'x' as never, 'cafe'] } }).meals).toEqual(['cafe', 'jantar']);
    expect(nutritionSettingsOf({ nutrition: { meals: [] } }).meals).toEqual(NUTRITION_MEALS);
  });

  it('training before a meal: that meal is pós-treino and the one switched on before it is pré-treino', () => {
    expect(trainingMeals(['cafe', 'almoco', 'tarde', 'jantar'], 'tarde')).toEqual({ pre: 'almoco', post: 'tarde' });
    expect(trainingMeals(['cafe', 'almoco', 'jantar'], 'jantar')).toEqual({ pre: 'almoco', post: 'jantar' });
    // training before the first meal (fasted, before breakfast): pós-treino only
    expect(trainingMeals(['cafe', 'jantar'], 'cafe')).toEqual({ post: 'cafe' });
    expect(trainingMeals(['cafe', 'jantar'], 'almoco')).toEqual({});
    expect(trainingMeals(['cafe', 'jantar'])).toEqual({});
    const build = { day: DAY, hunger: 'normal' as const, afterTraining: 'jantar' as const };
    expect(trainingTags(NUTRITION_MEALS, build, DAY)).toEqual({ tarde: 'pré-treino', jantar: 'pós-treino' });
    expect(trainingTags(NUTRITION_MEALS, { ...build, afterTraining: 'cafe' }, DAY)).toEqual({ cafe: 'pós-treino' });
    expect(trainingTags(NUTRITION_MEALS, build, '2026-11-26')).toEqual({});
    expect(trainingTags(NUTRITION_MEALS, undefined, DAY)).toEqual({});
  });

  it('the settings keep only the meals (an older stored build is dropped)', () => {
    expect(nutritionSettingsOf({ nutrition: { meals: ['cafe'], lastBuild: { day: DAY } } as never })).toEqual({ meals: ['cafe'] });
  });
});

describe('the rest of the day', () => {
  it('meals switched on, with nothing eaten, after the last meal with something eaten', () => {
    expect(remainingMeals(NUTRITION_MEALS, [], DAY)).toEqual(NUTRITION_MEALS);
    expect(remainingMeals(['cafe', 'almoco', 'jantar', 'ceia'], [log('almoco', ARROZ, 100)], DAY)).toEqual(['jantar', 'ceia']);
    expect(remainingMeals(NUTRITION_MEALS, [log('cafe', ARROZ, 100), log('jantar', ARROZ, 100), log('ceia', ARROZ, 10, 'planejado')], DAY)).toEqual(['ceia']);
    expect(remainingMeals(NUTRITION_MEALS, [log('jantar', ARROZ, 100, 'comido', { day: '2026-11-24' })], DAY)).toEqual(NUTRITION_MEALS);
    expect(mealsWithoutEaten([log('cafe', ARROZ, 100), log('almoco', ARROZ, 100, 'planejado')], DAY)).toEqual(['lanche', 'almoco', 'tarde', 'jantar', 'ceia']);
  });
});

describe('optimisation and rounding', () => {
  it('projected coordinate descent reaches the exact grams when it can, and respects the bounds', () => {
    const pure = { per100: { protein: 20, carbs: 0, fat: 0 }, upper: Infinity };
    expect(optimizePortions([pure], { protein: 30, carbs: 0, fat: 0 })[0]).toBeCloseTo(150, 6);
    expect(optimizePortions([{ ...pure, upper: 100 }], { protein: 30, carbs: 0, fat: 0 })[0]).toBe(100);
    const g = optimizePortions([pure, { per100: { protein: 0, carbs: 50, fat: 0 }, upper: Infinity }], { protein: 30, carbs: 40, fat: 0 });
    expect(g[0]).toBeCloseTo(150, 4);
    expect(g[1]).toBeCloseTo(80, 4);
    expect(optimizePortions([pure], { protein: -5, carbs: 0, fat: 0 })[0]).toBe(0);
  });

  it('5 g steps below 100 g, 10 g from 100 g, whole units, never above the bound', () => {
    expect(roundPortion(47, Infinity)).toBe(45);
    expect(roundPortion(48, Infinity)).toBe(50);
    expect(roundPortion(104, Infinity)).toBe(100);
    expect(roundPortion(106, Infinity)).toBe(110);
    expect(roundPortion(106, 103)).toBe(100);
    expect(roundPortion(99, 97)).toBe(95);
    expect(roundPortion(60, Infinity, { name: 'fatia', grams: 25 })).toBe(50);
    expect(roundPortion(63, Infinity, { name: 'fatia', grams: 25 })).toBe(75);
    expect(roundPortion(63, 70, { name: 'fatia', grams: 25 })).toBe(50);
    expect(roundPortion(10, Infinity, { name: 'fatia', grams: 25 })).toBe(0);
  });
});

describe('planRestOfDay (the generator)', () => {
  it('explains what blocks it: no target, no stock confirmed today, no meal left', () => {
    const run = (p: Partial<PlanInput>) => planRestOfDay({ day: DAY, targets: TARGETS, logs: [], meals: NUTRITION_MEALS, foods: ALL, pantry: stock(ALL), hunger: 'normal', ...p });
    expect(run({ targets: [] })).toEqual({ ok: false, reason: 'sem-meta', text: 'Defina as metas primeiro.' });
    expect(run({ pantry: stock(ALL, '2026-11-24') })).toEqual({ ok: false, reason: 'sem-estoque', text: 'Confirme o estoque de hoje primeiro.' });
    expect(run({ pantry: [] })).toMatchObject({ ok: false, reason: 'sem-estoque' });
    expect(run({ meals: ['cafe', 'almoco'], logs: [log('almoco', ARROZ, 100)] })).toMatchObject({ ok: false, reason: 'sem-refeicao' });
  });

  it('fills every remaining meal close to the target, in meal order, with rounded portions of 10 g or more', () => {
    const r = plan();
    expect(r.meals).toEqual(NUTRITION_MEALS);
    expect(r.items.map((i) => NUTRITION_MEALS.indexOf(i.meal))).toEqual([...r.items.map((i) => NUTRITION_MEALS.indexOf(i.meal))].sort((a, b) => a - b));
    for (const m of NUTRITION_MEALS) expect(of(r.items, m).length, m).toBeGreaterThan(0);
    expect(Math.abs(r.afterPlan.protein)).toBeLessThanOrEqual(PLAN_TOLERANCE.protein);
    expect(Math.abs(r.afterPlan.carbs)).toBeLessThanOrEqual(PLAN_TOLERANCE.carbs);
    for (const it of r.items) {
      expect(it.grams).toBeGreaterThanOrEqual(10);
      const unit = byId.get(it.foodId)!.unit;
      if (unit) expect(it.grams % unit.grams, it.foodId).toBe(0);
      else expect(it.grams % (it.grams < 100 ? 5 : 10), it.foodId).toBe(0);
    }
    expect(r.planned.protein).toBeCloseTo(160 - r.afterPlan.protein, 6);
  });

  it('is deterministic: the same state always gives the same plan, whatever the order of the lists', () => {
    const a = plan({ afterTraining: 'jantar' });
    const b = plan({ afterTraining: 'jantar' });
    const c = plan({ afterTraining: 'jantar', foods: [...ALL].reverse(), pantry: stock(ALL).reverse() });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('respects the counted stock (shared by the meals) and the maximum portion', () => {
    const foods = ALL.map((f) => (f.id === 'arroz' ? { ...f, maxPortion: 120 } : f));
    const r = plan({ foods, pantry: stock(ALL, DAY, { frango: 150, brocolis: 150 }) });
    expect(r.items.filter((i) => i.foodId === 'frango').reduce((s, i) => s + i.grams, 0)).toBeLessThanOrEqual(150);
    for (const i of r.items.filter((x) => x.foodId === 'arroz')) expect(i.grams).toBeLessThanOrEqual(120);
    expect(gramsOf(r.items, 'almoco', 'brocolis')).toBe(100);
    expect(gramsOf(r.items, 'jantar', 'brocolis')).toBe(50);
  });

  it('never suggests "nunca", and "pouco" goes in one meal at most', () => {
    const never = plan({ foods: ALL.map((f) => (f.id === 'frango' ? { ...f, like: 'nunca' as const } : f)) });
    expect(never.items.some((i) => i.foodId === 'frango')).toBe(false);
    const little = plan({ foods: ALL.map((f) => (f.id === 'frango' ? { ...f, like: 'pouco' as const } : f)) });
    expect(new Set(little.items.filter((i) => i.foodId === 'frango').map((i) => i.meal)).size).toBe(1);
    const eatenLittle = plan({
      foods: ALL.map((f) => (f.id === 'frango' ? { ...f, like: 'pouco' as const } : f)), logs: [log('cafe', FRANGO, 100)],
    });
    expect(eatenLittle.items.some((i) => i.foodId === 'frango')).toBe(false);
  });

  it('does not repeat the protein source of the previous meal when there is another', () => {
    const r = plan();
    const proteinOf = (m: NutritionMeal) => of(r.items, m).find((i) => ['proteina', 'laticinio'].includes(byId.get(i.foodId)!.group))?.foodId;
    const sources = NUTRITION_MEALS.map(proteinOf);
    for (let i = 1; i < sources.length; i++) expect(sources[i], NUTRITION_MEALS[i]).not.toBe(sources[i - 1]);
    // after an eaten lunch with chicken, the afternoon starts with another source
    const after = plan({ logs: [log('almoco', FRANGO, 150)] });
    expect(of(after.items, 'tarde').map((i) => i.foodId)).not.toContain('frango');
    // with a single source it repeats
    const single = plan({ foods: [FRANGO, ARROZ], pantry: stock([FRANGO, ARROZ]) });
    for (const m of NUTRITION_MEALS) expect(of(single.items, m).map((i) => i.foodId)).toContain('frango');
  });

  it('pré-treino and pós-treino get more carbohydrates', () => {
    const without = plan();
    const withTraining = plan({ afterTraining: 'jantar' });
    expect(carbsOf(withTraining.items, 'tarde')).toBeGreaterThan(carbsOf(without.items, 'tarde'));
    expect(carbsOf(withTraining.items, 'jantar')).toBeGreaterThan(carbsOf(without.items, 'jantar'));
    expect(carbsOf(withTraining.items, 'cafe')).toBeLessThan(carbsOf(without.items, 'cafe'));
  });

  it('only counts what was eaten today: smaller target, meals after the last eaten one, planned items ignored', () => {
    const logs = [log('almoco', FRANGO, 200), log('almoco', ARROZ, 300), log('jantar', OVO, 500, 'planejado')];
    const r = plan({ logs });
    expect(r.meals).toEqual(['tarde', 'jantar', 'ceia']);
    expect(r.items.every((i) => ['tarde', 'jantar', 'ceia'].includes(i.meal))).toBe(true);
    const eatenProtein = 62 + 8.1;
    expect(r.planned.protein + eatenProtein + r.afterPlan.protein).toBeCloseTo(160, 6);
    expect(plan({ logs: logs.slice(0, 2) })).toEqual(r);
  });

  it('adds fat only when the other items do not bring it', () => {
    const foods = [FRANGO, ARROZ, AZEITE];
    const fatty = plan({ foods, pantry: stock(foods) });
    expect(fatty.items.some((i) => i.foodId === 'azeite')).toBe(true);
    const lean = plan({ foods, pantry: stock(foods), targets: [{ ...TARGETS[0]!, byWeekday: weekTargets({ protein: 160, carbs: 250, fat: 5 }, { protein: 1, carbs: 1, fat: 1 }) }] });
    expect(lean.items.some((i) => i.foodId === 'azeite')).toBe(false);
  });

  it('vegetables in lunch and dinner; with hunger "muita" a vegetable and a fruit in every meal', () => {
    const normal = plan();
    expect(NUTRITION_MEALS.filter((m) => of(normal.items, m).some((i) => i.foodId === 'brocolis'))).toEqual(['almoco', 'jantar']);
    expect(gramsOf(normal.items, 'almoco', 'brocolis')).toBe(100);
    const hungry = plan({ hunger: 'muita' });
    for (const m of NUTRITION_MEALS) {
      const ids = of(hungry.items, m).map((i) => i.foodId);
      expect(ids, m).toContain('brocolis');
      expect(ids, m).toContain('banana');
    }
    expect(gramsOf(hungry.items, 'cafe', 'banana')).toBe(80);
  });

  it('with hunger "pouca", the smaller meals stay empty when the target fits in the others, and are used when it does not', () => {
    // a lighter day: it fits in the four bigger meals within the default portions
    const lighterTarget = [{ ...TARGETS[0]!, byWeekday: weekTargets({ protein: 120, carbs: 200, fat: 50 }, { protein: 120, carbs: 200, fat: 50 }) }];
    const light = plan({ hunger: 'pouca', targets: lighterTarget });
    expect(of(light.items, 'lanche')).toEqual([]);
    expect(of(light.items, 'ceia')).toEqual([]);
    expect(light.afterPlan.protein).toBeLessThanOrEqual(PLAN_TOLERANCE.protein);
    const capped = ALL.map((f) => ({ ...f, maxPortion: 60 }));
    const tight = plan({ hunger: 'pouca', foods: capped });
    expect(of(tight.items, 'lanche').length).toBeGreaterThan(0);
    expect(of(tight.items, 'ceia').length).toBeGreaterThan(0);
    // the default portions also count: with the full target, 4 meals cannot carry the protein, so all six are used
    expect(of(plan({ hunger: 'pouca' }).items, 'ceia').length).toBeGreaterThan(0);
  });

  it('with hunger "pouca", a small meal that is pré- or pós-treino is never left empty', () => {
    const lighterTarget = [{ ...TARGETS[0]!, byWeekday: weekTargets({ protein: 120, carbs: 200, fat: 50 }, { protein: 120, carbs: 200, fat: 50 }) }];
    // training before lunch: the morning snack is pré-treino
    const pre = plan({ hunger: 'pouca', targets: lighterTarget, afterTraining: 'almoco' });
    expect(of(pre.items, 'lanche').length).toBeGreaterThan(0);
    expect(of(pre.items, 'ceia')).toEqual([]);
    // training before the supper: the supper is pós-treino
    const post = plan({ hunger: 'pouca', targets: lighterTarget, afterTraining: 'ceia' });
    expect(of(post.items, 'ceia').length).toBeGreaterThan(0);
    expect(of(post.items, 'lanche')).toEqual([]);
  });

  it('training before the first meal (fasted): breakfast is pós-treino and gets more carbohydrates', () => {
    const without = plan();
    const fasted = plan({ afterTraining: 'cafe' });
    expect(carbsOf(fasted.items, 'cafe')).toBeGreaterThan(carbsOf(without.items, 'cafe'));
  });

  it('whole units for foods with a unit, and items under 10 g left out', () => {
    const foods = [OVO, PAO];
    const r = plan({ foods, pantry: stock(foods) });
    for (const i of r.items) expect(i.grams % (i.foodId === 'ovo' ? 50 : 25)).toBe(0);
    // almost everything already eaten: what is left for the supper is under 10 g of anything
    const nearlyDone = plan({ meals: ['jantar', 'ceia'], logs: [log('jantar', FRANGO, 515), log('jantar', ARROZ, 890), log('jantar', AZEITE, 41)] });
    expect(nearlyDone.meals).toEqual(['ceia']);
    expect(nearlyDone.items).toEqual([]);
  });

  it('says what is missing and suggests a registered food, telling whether it is in today\'s stock', () => {
    const onlyRice = plan({ pantry: stock([ARROZ]) });
    const note = onlyRice.notes.find((n) => n.macro === 'protein')!;
    expect(note.kind).toBe('falta');
    expect(note.text).toBe(`Faltam ${intText(onlyRice.afterPlan.protein)} g de proteína.`);
    const need = (onlyRice.afterPlan.protein * 100) / 31;
    const grams = Math.ceil(need / (need < 100 ? 5 : 10)) * (need < 100 ? 5 : 10);
    expect(note.suggestion).toEqual({
      foodId: 'frango', grams, inStock: false,
      text: `Com mais ${intText(grams)} g de Peito de frango (pronto) chegaria. Não está no estoque de hoje.`,
    });
    // 100 g of chicken counted, and the plan uses all of it: the sentence must not say it is still in stock
    const someChicken = plan({ pantry: stock([ARROZ, FRANGO], DAY, { frango: 100 }) });
    expect(someChicken.items.filter((i) => i.foodId === 'frango').reduce((s, i) => s + i.grams, 0)).toBe(100);
    const n2 = someChicken.notes.find((n) => n.macro === 'protein')!;
    expect(n2.suggestion).toMatchObject({ foodId: 'frango', inStock: false });
    expect(n2.suggestion!.text).toMatch(/^Com mais \d+ g de Peito de frango \(pronto\) chegaria\. O estoque contado de hoje já entrou no plano\.$/);
    expect(plan({ foods: [ARROZ], pantry: stock([ARROZ]) }).notes.find((n) => n.macro === 'protein')!.suggestion).toBeUndefined();
  });

  it('the suggestion tells what is left of today\'s stock after the plan', () => {
    const pantry = stock([FRANGO], DAY, { frango: 500 });
    const text = (left?: Map<string, number>) => suggestFood('protein', 31, ALL, pantry, DAY, left)!;
    expect(text()).toMatchObject({ grams: 100, inStock: true, text: 'Com mais 100 g de Peito de frango (pronto) chegaria. Está no estoque de hoje.' });
    expect(text(new Map([['frango', 50]]))).toMatchObject({ inStock: false, text: 'Com mais 100 g de Peito de frango (pronto) chegaria. No estoque de hoje sobram 50 g.' });
    expect(text(new Map([['frango', 0]])).text).toMatch(/O estoque contado de hoje já entrou no plano\.$/);
    expect(text(new Map([['frango', Infinity]])).inStock).toBe(true);
    expect(text(new Map()).text).toMatch(/Não está no estoque de hoje\.$/);
    // on the screen: the stock left is the count minus every planned item of the day
    const logs = [log('almoco', FRANGO, 500, 'planejado')];
    const notes = nutritionNotes({ afterPlan: { protein: 31, carbs: 0, fat: 0 }, foods: ALL, pantry, day: DAY, left: stockLeft(pantry, logs, DAY) });
    expect(notes[0]!.suggestion!.text).toMatch(/O estoque contado de hoje já entrou no plano\.$/);
  });

  it('says how much passed when what was eaten already passes the target', () => {
    const r = plan({ logs: [log('cafe', AZEITE, 80)] });
    expect(r.notes.find((n) => n.macro === 'fat')).toMatchObject({ kind: 'passou', text: `Passou ${intText(-r.afterPlan.fat)} g da meta de gordura.` });
  });

  it('"Bom para": a food marked only for lunch and dinner never goes to breakfast (or any other meal)', () => {
    const lunch: NutritionMeal[] = ['almoco', 'jantar'];
    const foods = ALL.map((f) => (f.id === 'frango' || f.id === 'arroz' ? { ...f, meals: lunch } : f));
    const r = plan({ foods });
    for (const it of r.items.filter((i) => i.foodId === 'frango' || i.foodId === 'arroz')) expect(lunch, it.foodId).toContain(it.meal);
    expect(of(r.items, 'cafe').map((i) => i.foodId)).not.toContain('frango');
    expect(of(r.items, 'cafe').map((i) => i.foodId)).not.toContain('arroz');
    expect(of(r.items, 'almoco').map((i) => i.foodId)).toEqual(expect.arrayContaining(['frango', 'arroz']));
    // breakfast is still filled with the foods good for it
    expect(of(r.items, 'cafe').length).toBeGreaterThan(0);
  });

  it('"Bom para" absent or empty means every meal; a meal with no food good for it stays empty', () => {
    const empty = plan({ foods: ALL.map((f) => ({ ...f, meals: [] })) });
    expect(empty).toEqual(plan());
    const onlyLunch = [FRANGO, ARROZ].map((f) => ({ ...f, meals: ['almoco'] as NutritionMeal[] }));
    const r = plan({ foods: onlyLunch, pantry: stock(onlyLunch), meals: ['cafe', 'almoco'] });
    expect(of(r.items, 'cafe')).toEqual([]);
    expect(of(r.items, 'almoco').length).toBeGreaterThan(0);
  });
});

describe('planRestOfDay: kept planned items, units and default portions', () => {
  const plannedLogs = (items: readonly PlannedItem[]) => items.map((it) => log(it.meal, byId.get(it.foodId) ?? FOODS_EXTRA.get(it.foodId)!, it.grams, 'planejado'));
  const TOMATE = food('tomate', 'Tomate', 'verdura', [18, 0.9, 3.9, 0.2], { unit: { name: 'tomate', grams: 120 } });
  const CENOURA = food('cenoura', 'Cenoura', 'verdura', [41, 0.9, 10, 0.2], { unit: { name: 'cenoura', grams: 60 } });
  const WHEY = food('whey', 'Whey', 'proteina', [400, 80, 8, 6], { unit: { name: 'scoop', grams: 30 }, maxPortion: 20 });
  const FOODS_EXTRA = new Map([TOMATE, CENOURA, WHEY].map((f) => [f.id, f]));

  it('a rebuild counts the planned items kept in a meal that has something eaten: the screen shows what the generator aimed at', () => {
    // lunch: the chicken was eaten first; rice and olive oil are still planned there
    const logs = [log('almoco', FRANGO, 150), log('almoco', ARROZ, 200, 'planejado'), log('almoco', AZEITE, 10, 'planejado')];
    const r = plan({ logs });
    expect(r.meals).toEqual(['tarde', 'jantar', 'ceia']);
    const day = nutritionDay({ day: DAY, targets: TARGETS, logs: [...logs, ...plannedLogs(r.items)] });
    for (const m of ['protein', 'carbs', 'fat'] as const) expect(day.afterPlan![m], m).toBeCloseTo(r.afterPlan[m], 6);
    expect(Math.abs(day.afterPlan!.carbs)).toBeLessThanOrEqual(PLAN_TOLERANCE.carbs); // with the bug: passou 58 g
    expect(Math.abs(day.afterPlan!.protein)).toBeLessThan(2 * PLAN_TOLERANCE.protein);
    expect(r.notes.some((n) => n.macro === 'carbs')).toBe(false);
  });

  it('a rebuild never plans again the counted stock a kept planned item already uses', () => {
    const logs = [log('almoco', FRANGO, 100), log('almoco', ARROZ, 300, 'planejado')];
    const r = plan({ logs, pantry: stock(ALL, DAY, { arroz: 300 }) });
    const rice = r.items.filter((i) => i.foodId === 'arroz').reduce((s, i) => s + i.grams, 0);
    expect(rice + 300).toBeLessThanOrEqual(300);
  });

  it('a kept "pouco" food counts as used, and a kept protein of the last eaten meal is not repeated right after', () => {
    const pouco = { ...PAO, like: 'pouco' as const };
    const little = plan({ foods: [FRANGO, pouco], pantry: stock([FRANGO, pouco]), logs: [log('almoco', FRANGO, 100), log('almoco', pouco, 50, 'planejado')] });
    expect(little.items.some((i) => i.foodId === 'pao')).toBe(false);
    const foods = [FRANGO, OVO, ARROZ];
    const next = plan({ foods, pantry: stock(foods), logs: [log('almoco', ARROZ, 100), log('almoco', FRANGO, 120, 'planejado')] });
    expect(of(next.items, 'tarde').map((i) => i.foodId)).not.toContain('frango');
    expect(of(next.items, 'tarde').map((i) => i.foodId)).toContain('ovo');
  });

  it('a food with a unit that cannot fit one unit leaves the protein to the next candidate', () => {
    // whey: one scoop is 30 g, but its maximum portion is 20 g
    const foods = [WHEY, FRANGO, ARROZ];
    const r = plan({ foods, pantry: stock(foods) });
    expect(r.items.some((i) => i.foodId === 'whey')).toBe(false);
    for (const m of NUTRITION_MEALS) expect(of(r.items, m).map((i) => i.foodId), m).toContain('frango');
    expect(r.notes.find((n) => n.macro === 'protein')).toBeUndefined();
    // eggs: 40 g counted, one egg is 50 g
    const eggs = [OVO, IOGURTE, ARROZ];
    const r2 = plan({ foods: eggs, pantry: stock(eggs, DAY, { ovo: 40 }) });
    expect(r2.items.some((i) => i.foodId === 'ovo')).toBe(false);
    for (const m of NUTRITION_MEALS) expect(of(r2.items, m).map((i) => i.foodId), m).toContain('iogurte');
  });

  it('a unit food whose best portion rounds to zero units gives its place to the next protein', () => {
    // the supper needs about 10 g of egg (a fifth of an egg): the yogurt takes its place
    const foods = [OVO, IOGURTE, ARROZ];
    const small = [{ ...TARGETS[0]!, byWeekday: weekTargets({ protein: 3, carbs: 20, fat: 2 }, { protein: 3, carbs: 20, fat: 2 }) }];
    const r = plan({ foods, pantry: stock(foods), meals: ['ceia'], targets: small });
    expect(r.items.map((i) => i.foodId)).toEqual(['iogurte', 'arroz']);
  });

  it('a vegetable with a unit goes in whole units, the number closest to 100 g', () => {
    const foods = [FRANGO, ARROZ, TOMATE];
    const r = plan({ foods, pantry: stock(foods) });
    expect(gramsOf(r.items, 'almoco', 'tomate')).toBe(120);
    expect(gramsOf(r.items, 'jantar', 'tomate')).toBe(120);
    expect(portionText(120, TOMATE)).toBe('1 tomate · 120 g');
    const carrots = [FRANGO, ARROZ, CENOURA];
    expect(gramsOf(plan({ foods: carrots, pantry: stock(carrots) }).items, 'almoco', 'cenoura')).toBe(120);
    // 200 g of tomato counted: one per meal
    expect(gramsOf(plan({ foods, pantry: stock(foods, DAY, { tomate: 200 }) }).items, 'jantar', 'tomate')).toBe(0);
  });

  it('without its own maximum portion, a food uses its group\'s default, and at most 4 units', () => {
    expect(DEFAULT_MAX_PORTION).toEqual({ proteina: 250, carboidrato: 300, laticinio: 300, fruta: 200, verdura: 200, gordura: 20, outro: 200 });
    expect(maxPortionOf({ group: 'proteina' })).toBe(250);
    expect(maxPortionOf({ group: 'gordura' })).toBe(20);
    expect(maxPortionOf({ group: 'gordura', maxPortion: 40 })).toBe(40);
    expect(maxPortionOf(PAO)).toBe(100);                                                       // 4 slices
    expect(maxPortionOf(OVO)).toBe(200);                                                       // 4 eggs
    expect(maxPortionOf(BANANA)).toBe(200);                                                    // 2 bananas fit
    expect(maxPortionOf({ group: 'proteina', unit: { name: 'marmita', grams: 400 } })).toBe(400); // one unit at least
    const r = plan();
    for (const it of r.items) expect(it.grams, it.foodId).toBeLessThanOrEqual(maxPortionOf(byId.get(it.foodId)!));
  });

  it('yogurt as the only protein of the small meals: the default portion holds, and the shortage sentence shows', () => {
    const small: NutritionMeal[] = ['lanche', 'tarde', 'ceia'];
    const foods = [{ ...IOGURTE, meals: small }, ...[FRANGO, ARROZ].map((f) => ({ ...f, meals: ['almoco', 'jantar'] as NutritionMeal[] })), PAO];
    const r = plan({ foods, pantry: stock(foods), meals: small });
    const yogurt = r.items.filter((i) => i.foodId === 'iogurte');
    expect(yogurt.length).toBe(3);
    for (const it of yogurt) expect(it.grams).toBeLessThanOrEqual(300);
    expect(r.notes.find((n) => n.macro === 'protein')).toMatchObject({ kind: 'falta' });
  });

  it('planned items have one id per day, meal and food', () => {
    expect(plannedLogId(DAY, 'almoco', 'arroz')).toBe('plan-2026-11-25-almoco-arroz');
    const r = plan({ hunger: 'muita' });
    const ids = r.items.map((i) => plannedLogId(DAY, i.meal, i.foodId));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('"Bom para" (meals a food is good for)', () => {
  const input = (meals?: NutritionMeal[]): FoodInput => ({
    name: 'Pão de forma', per100: { kcal: 250, protein: 9, carbs: 47, fat: 3.5 }, basis: 'pronto', source: 'rotulo',
    group: 'carboidrato', like: 'normal', ...(meals ? { meals } : {}),
  });

  it('is stored in day order without repeats or unknown values; none marked is left out', () => {
    expect(validateFood(input(['ceia', 'cafe', 'cafe', 'outra' as NutritionMeal])).food!.meals).toEqual(['cafe', 'ceia']);
    expect(validateFood(input([])).food).not.toHaveProperty('meals');
    expect(validateFood(input()).food).not.toHaveProperty('meals');
    const recipe = validateRecipe({ name: 'Mingau', ingredients: [{ foodId: 'pao', grams: 100 }], yieldGrams: 200, group: 'carboidrato', like: 'normal', meals: ['tarde', 'cafe'] }, ALL);
    expect(recipe.food!.meals).toEqual(['cafe', 'tarde']);
  });

  it('goodFor and goodForText', () => {
    expect(goodFor({}, 'cafe')).toBe(true);
    expect(goodFor({ meals: [] }, 'jantar')).toBe(true);
    expect(goodFor({ meals: ['almoco', 'jantar'] }, 'cafe')).toBe(false);
    expect(goodFor({ meals: ['almoco', 'jantar'] }, 'jantar')).toBe(true);
    expect(goodForText({ meals: ['jantar', 'almoco'] })).toBe('Bom para: Almoço, Jantar');
    expect(goodForText({})).toBeUndefined();
    expect(goodForText({ meals: [...NUTRITION_MEALS] })).toBeUndefined();
  });
});
