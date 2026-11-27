import type {
  BaseRecord, DayKey, Food, FoodBasis, FoodGroup, FoodLike, FoodLog, FoodRecipe, FoodSource, FoodUnit, Hunger, ID,
  MacroTarget, NutritionBuild, NutritionMeal, NutritionSettings, NutritionTarget, Nutrients, PantryItem, WeighIn,
} from './types';
import { weekdayOf } from './dates';
import { normalize } from './parser';

// Nutrição (spec docs/superpowers/specs/2026-11-25-nutricao-design.md): pure rules for foods and recipes, the day's
// target, the diary by meal, the day's stock, weigh-ins and the generator that plans the rest of the day ("Montar o
// resto do dia"). No XP and nothing here is ever read by the assistants. Field names follow the code (English); the
// texts the person reads are pt-BR and neutral (passing a target is "passou X g", never an alarm).

// ------------------------------------------------------------------ constants and labels

export const NUTRITION_MEALS: readonly NutritionMeal[] = ['cafe', 'lanche', 'almoco', 'tarde', 'jantar', 'ceia'];
export const NUTRITION_MEAL_LABEL: Record<NutritionMeal, string> = {
  cafe: 'Café da manhã', lanche: 'Lanche da manhã', almoco: 'Almoço', tarde: 'Café da tarde', jantar: 'Jantar', ceia: 'Ceia',
};
export const FOOD_BASIS_LABEL: Record<FoodBasis, string> = { pronto: 'Pronto', cru: 'Cru' };
export const FOOD_SOURCE_LABEL: Record<FoodSource, string> = { rotulo: 'Rótulo', tabela: 'Tabela', estimativa: 'Estimativa' };
export const FOOD_GROUP_LABEL: Record<FoodGroup, string> = {
  proteina: 'Proteína', carboidrato: 'Carboidrato', gordura: 'Gordura', fruta: 'Fruta', verdura: 'Verdura',
  laticinio: 'Laticínio', outro: 'Outro',
};
export const FOOD_LIKE_LABEL: Record<FoodLike, string> = { gosto: 'Gosto', normal: 'Normal', pouco: 'Pouco', nunca: 'Nunca' };
export const HUNGER_LABEL: Record<Hunger, string> = { pouca: 'Pouca', normal: 'Normal', muita: 'Muita' };

export type Macro = keyof MacroTarget;
export const MACROS: readonly Macro[] = ['protein', 'carbs', 'fat'];
export const MACRO_NAME: Record<Macro, string> = { protein: 'proteína', carbs: 'carboidratos', fat: 'gordura' };
export const MACRO_LETTER: Record<Macro, string> = { protein: 'P', carbs: 'C', fat: 'G' };
/** Calories per gram of each macro: the target's kcal come from these. */
export const KCAL_PER_GRAM: Readonly<MacroTarget> = { protein: 4, carbs: 4, fat: 9 };

/** Share of the remaining target each meal takes: 1, and 1,5 for almoço and jantar. */
export const MEAL_WEIGHT: Readonly<Record<NutritionMeal, number>> = { cafe: 1, lanche: 1, almoco: 1.5, tarde: 1, jantar: 1.5, ceia: 1 };
/** Pré-treino and pós-treino take 1,3 × their part of the carbohydrates (the other meals adjust). */
export const TRAINING_CARB_FACTOR = 1.3;
/** Weights of the squared deviation the generator minimises per meal. */
export const PLAN_PENALTY: Readonly<MacroTarget> = { protein: 3, carbs: 1, fat: 1.5 };
/** Passes of the projected coordinate descent (at most). */
export const PLAN_STEPS = 200;
/** Fixed portion of a vegetable (or what is left of it in stock). */
export const VEGETABLE_GRAMS = 100;
/** Fixed portion of the extra fruit with hunger "muita" when the fruit has no unit (else one unit). */
export const FRUIT_GRAMS = 100;
/** Planned items below this are left out. */
export const MIN_ITEM_GRAMS = 10;
/** The smaller meals: with hunger "pouca" they stay empty when the target already fits in the others. */
export const SMALL_MEALS: readonly NutritionMeal[] = ['lanche', 'ceia'];
/** Meals that get a vegetable when there is one (with hunger "muita", every meal gets one, and a fruit). */
export const MAIN_MEALS: readonly NutritionMeal[] = ['almoco', 'jantar'];
/** Left or passed within this (grams), per macro, is "close enough": no sentence, and the plan "fits". */
export const PLAN_TOLERANCE: Readonly<MacroTarget> = { protein: 5, carbs: 10, fat: 5 };
/** The generator's grams per meal for a food without its own maximum portion, by group. */
export const DEFAULT_MAX_PORTION: Readonly<Record<FoodGroup, number>> = {
  proteina: 250, carboidrato: 300, laticinio: 300, fruta: 200, verdura: 200, gordura: 20, outro: 200,
};
/** A food with a unit and without its own maximum portion: at most this many units per meal. */
export const MAX_UNITS_PER_MEAL = 4;

export const FOOD_NAME_MAX = 60;
export const KCAL_PER100_MAX = 900;
export const MACRO_PER100_MAX = 100;
/** Typed kcal more than 10% away from 4/4/9 × the macros: a warning that never blocks saving. */
export const KCAL_MISMATCH = 0.1;
export const LOG_GRAMS_MAX = 5000;
export const PANTRY_GRAMS_MAX = 100_000;
export const TARGET_MACRO_MAX = 1000;
export const WEIGHT_MIN = 30;
export const WEIGHT_MAX = 300;
/** Days with a weigh-in that make the average. */
export const WEIGH_IN_DAYS = 7;
export const WEIGH_IN_NOTE = 'Uma pesagem isolada não muda as metas.';
export const NO_FAT_NOTE = 'Sem gordura no preparo. Se usou óleo ou azeite, inclua como ingrediente.';

export const nutritionTargetId = (from: DayKey): ID => `ntarget-${from}`;
/** The device-local meta key (web app, never synced) of the last "Montar o resto do dia" (a NutritionBuild). */
export const NUTRITION_BUILD_KEY = 'nutritionBuild';
export const pantryId = (foodId: ID): ID => `pantry-${foodId}`;

const live = <T extends { deleted: boolean }>(xs: readonly T[]): T[] => xs.filter((x) => !x.deleted);
const mealIndex = (m: NutritionMeal): number => NUTRITION_MEALS.indexOf(m);

// ------------------------------------------------------------------ settings

export const DEFAULT_NUTRITION: NutritionSettings = { meals: [...NUTRITION_MEALS] };

/** Known meals of `list`, without repeats, in day order. */
export function cleanMeals(list: unknown): NutritionMeal[] {
  return Array.isArray(list) ? NUTRITION_MEALS.filter((m) => list.includes(m)) : [];
}

/**
 * `settings.nutrition` with defaults: every meal on when the list is missing, broken or empty. Only the meals: anything
 * else an older version stored there (the last build) is dropped.
 */
export function nutritionSettingsOf(s?: { nutrition?: Partial<NutritionSettings> }): NutritionSettings {
  const meals = cleanMeals(s?.nutrition?.meals);
  return { meals: meals.length > 0 ? meals : [...NUTRITION_MEALS] };
}

export interface TrainingMeals { pre?: NutritionMeal; post?: NutritionMeal }

/**
 * Training happens right before `after`: that meal becomes pós-treino and the meal switched on before it, if any,
 * pré-treino. Any meal can be chosen, the first one included (training before breakfast: no pré-treino).
 */
export function trainingMeals(meals: readonly NutritionMeal[], after?: NutritionMeal): TrainingMeals {
  const on = cleanMeals(meals);
  const i = after ? on.indexOf(after) : -1;
  if (i < 0) return {};
  const pre = on[i - 1];
  return { ...(pre ? { pre } : {}), post: after };
}

/** "pré-treino" / "pós-treino" of the meals of `day`, from this device's last build made that day. */
export function trainingTags(meals: readonly NutritionMeal[], build: NutritionBuild | undefined, day: DayKey): Partial<Record<NutritionMeal, string>> {
  if (!build || build.day !== day) return {};
  const t = trainingMeals(meals, build.afterTraining);
  return { ...(t.pre ? { [t.pre]: 'pré-treino' } : {}), ...(t.post ? { [t.post]: 'pós-treino' } : {}) };
}

// ------------------------------------------------------------------ nutrient math

export const ZERO_NUTRIENTS: Readonly<Nutrients> = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

/** Nutrients of `grams` of a food: grams × value per 100 g ÷ 100. */
export function nutrientsOf(per100: Nutrients, grams: number): Nutrients {
  const f = grams / 100;
  const out: Nutrients = { kcal: per100.kcal * f, protein: per100.protein * f, carbs: per100.carbs * f, fat: per100.fat * f };
  if (per100.fiber !== undefined) out.fiber = per100.fiber * f;
  return out;
}

/** Sum of nutrients; fiber only when some part has it. */
export function sumNutrients(list: readonly Nutrients[]): Nutrients {
  const out: Nutrients = { ...ZERO_NUTRIENTS };
  let fiber: number | undefined;
  for (const n of list) {
    out.kcal += n.kcal; out.protein += n.protein; out.carbs += n.carbs; out.fat += n.fat;
    if (n.fiber !== undefined) fiber = (fiber ?? 0) + n.fiber;
  }
  if (fiber !== undefined) out.fiber = fiber;
  return out;
}

/** a − b for kcal and the macros (fiber left out). Negative = passed. */
export function diffNutrients(a: Nutrients, b: Nutrients): Nutrients {
  return { kcal: a.kcal - b.kcal, protein: a.protein - b.protein, carbs: a.carbs - b.carbs, fat: a.fat - b.fat };
}

/** kcal = 4 × P + 4 × C + 9 × G. */
export function macroKcal(m: MacroTarget): number {
  return KCAL_PER_GRAM.protein * m.protein + KCAL_PER_GRAM.carbs * m.carbs + KCAL_PER_GRAM.fat * m.fat;
}

/** Totals of some food logs: their nutrients, grams, and whether any of them is estimated. */
export interface Totals extends Nutrients { grams: number; estimate: boolean }

export function totalsOf(logs: readonly Pick<FoodLog, 'per100' | 'grams' | 'estimate'>[]): Totals {
  return {
    ...sumNutrients(logs.map((l) => nutrientsOf(l.per100, l.grams))),
    grams: logs.reduce((s, l) => s + l.grams, 0),
    estimate: logs.some((l) => l.estimate),
  };
}

/** The live logs of `day`, by meal, then order inside the meal. */
export function dayLogs(logs: readonly FoodLog[], day: DayKey): FoodLog[] {
  return live(logs).filter((l) => l.day === day)
    .sort((a, b) => mealIndex(a.meal) - mealIndex(b.meal) || a.order - b.order || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

/** The next `order` of a meal: after every item it has. */
export function nextOrder(logs: readonly FoodLog[], day: DayKey, meal: NutritionMeal): number {
  return live(logs).filter((l) => l.day === day && l.meal === meal).reduce((n, l) => Math.max(n, l.order + 1), 0);
}

/** What a food log copies from the food when it is written (the history never changes with the food). */
export function logSnapshot(food: Food): Pick<FoodLog, 'foodId' | 'name' | 'per100' | 'basis' | 'estimate'> {
  return { foodId: food.id, name: food.name, per100: { ...food.per100 }, basis: food.basis, estimate: food.source === 'estimativa' };
}

export interface MealView {
  meal: NutritionMeal;
  eaten: FoodLog[];
  planned: FoodLog[];
  eatenTotals: Totals;
  plannedTotals: Totals;
}

/** The meals of `day` in order: the ones switched on, and any other that has something logged. */
export function mealViews(logs: readonly FoodLog[], day: DayKey, meals: readonly NutritionMeal[]): MealView[] {
  const items = dayLogs(logs, day);
  return NUTRITION_MEALS.filter((m) => meals.includes(m) || items.some((l) => l.meal === m)).map((meal) => {
    const eaten = items.filter((l) => l.meal === meal && l.status === 'comido');
    const planned = items.filter((l) => l.meal === meal && l.status === 'planejado');
    return { meal, eaten, planned, eatenTotals: totalsOf(eaten), plannedTotals: totalsOf(planned) };
  });
}

// ------------------------------------------------------------------ targets

/** The day's target: macros of its weekday, kcal derived, and the day the record is in force from. */
export interface DayTarget extends MacroTarget { kcal: number; from: DayKey }

/** The target record in force on `day`: the live one with the greatest `from` ≤ day. */
export function targetRecordFor(targets: readonly NutritionTarget[], day: DayKey): NutritionTarget | undefined {
  return live(targets).filter((t) => t.from <= day).sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : b.updatedAt - a.updatedAt))[0];
}

/** The target of `day` (its weekday in the record in force), or undefined when there is none. */
export function targetFor(targets: readonly NutritionTarget[], day: DayKey): DayTarget | undefined {
  const rec = targetRecordFor(targets, day);
  const m = rec?.byWeekday[weekdayOf(day)];
  if (!rec || !m) return undefined;
  return { protein: m.protein, carbs: m.carbs, fat: m.fat, kcal: macroKcal(m), from: rec.from };
}

/** The 7 weekday targets (0 = Sunday) from the two groups of the screen: Monday to Friday, Saturday and Sunday. */
export function weekTargets(weekdays: MacroTarget, weekend: MacroTarget): MacroTarget[] {
  return Array.from({ length: 7 }, (_, d) => ({ ...(d === 0 || d === 6 ? weekend : weekdays) }));
}

/** The two groups of a record (Monday's and Saturday's values), to fill the screen. */
export function targetGroups(t: Pick<NutritionTarget, 'byWeekday'>): { weekdays?: MacroTarget; weekend?: MacroTarget } {
  return { weekdays: t.byWeekday[1], weekend: t.byWeekday[6] };
}

export interface NutritionDay {
  day: DayKey;
  target?: DayTarget;
  eaten: Totals;
  planned: Totals;
  remaining?: Nutrients;    // target − eaten ("falta"; negative = passou)
  afterPlan?: Nutrients;    // target − eaten − planned
  estimate: boolean;
}

/** The top of the screen: the day's target, eaten, planned, what is left and what is left after the plan. */
export function nutritionDay(input: { day: DayKey; targets: readonly NutritionTarget[]; logs: readonly FoodLog[] }): NutritionDay {
  const items = dayLogs(input.logs, input.day);
  const eaten = totalsOf(items.filter((l) => l.status === 'comido'));
  const planned = totalsOf(items.filter((l) => l.status === 'planejado'));
  const target = targetFor(input.targets, input.day);
  const out: NutritionDay = { day: input.day, eaten, planned, estimate: eaten.estimate || planned.estimate };
  if (!target) return out;
  const remaining = diffNutrients(target, eaten);
  return { ...out, target, remaining, afterPlan: diffNutrients(remaining, planned) };
}

// ------------------------------------------------------------------ recipes

/** Per 100 g of a recipe: the sum of its ingredients' nutrients × 100 ÷ the final weight. */
export function recipePer100(parts: readonly { per100: Nutrients; grams: number }[], yieldGrams: number): Nutrients {
  const sum = sumNutrients(parts.map((p) => nutrientsOf(p.per100, p.grams)));
  return nutrientsOf(sum, yieldGrams > 0 ? (100 * 100) / yieldGrams : 0);
}

/** A recipe's source: estimated when any ingredient is; else 'tabela' when any is; else 'rotulo'. */
export function recipeSourceOf(sources: readonly FoodSource[]): FoodSource {
  if (sources.includes('estimativa')) return 'estimativa';
  return sources.includes('tabela') ? 'tabela' : 'rotulo';
}

export interface RecipeValues { per100: Nutrients; source: FoodSource; missing: number[] }

/** per100 and source of a recipe from the stored foods; `missing` = indexes of ingredients whose food is gone. */
export function recipeValues(recipe: FoodRecipe, foods: readonly Food[]): RecipeValues {
  const byId = new Map(live(foods).map((f) => [f.id, f]));
  const missing: number[] = [];
  const parts: { per100: Nutrients; grams: number; source: FoodSource }[] = [];
  recipe.ingredients.forEach((ing, i) => {
    const f = byId.get(ing.foodId);
    if (f) parts.push({ per100: f.per100, grams: ing.grams, source: f.source });
    else missing.push(i);
  });
  return { per100: recipePer100(parts, recipe.yieldGrams), source: recipeSourceOf(parts.map((p) => p.source)), missing };
}

/** The note of a recipe without any ingredient of the fat group (it still saves). */
export function recipeFatNote(ingredients: readonly { foodId: ID }[], foods: readonly Food[]): string | undefined {
  const byId = new Map(foods.map((f) => [f.id, f]));
  return ingredients.some((i) => byId.get(i.foodId)?.group === 'gordura') ? undefined : NO_FAT_NOTE;
}

export const isRecipe = (f: Pick<Food, 'recipe'>): boolean => f.recipe !== undefined;

/** "Bom para": whether the generator may put the food in `meal` (no meal marked = every meal). */
export function goodFor(food: Pick<Food, 'meals'>, meal: NutritionMeal): boolean {
  const meals = cleanMeals(food.meals);
  return meals.length === 0 || meals.includes(meal);
}

/** "Bom para: Café da manhã, Ceia", or undefined when the food is good for every meal. */
export function goodForText(food: Pick<Food, 'meals'>): string | undefined {
  const meals = cleanMeals(food.meals);
  if (meals.length === 0 || meals.length === NUTRITION_MEALS.length) return undefined;
  return `Bom para: ${meals.map((m) => NUTRITION_MEAL_LABEL[m]).join(', ')}`;
}

// ------------------------------------------------------------------ validation

/** A problem of one field of a form: where it goes and the sentence shown under the field. */
export interface FieldIssue { field: string; message: string }

export const NUMBER_TEXT = {
  required: 'Preencha este campo.',
  invalid: 'Use um número (aceita vírgula).',
  negative: 'Use zero ou mais.',
  positive: 'Use um número maior que zero.',
  kcalMax: `No máximo ${KCAL_PER100_MAX} kcal por 100 g.`,
  macroMax: `No máximo ${MACRO_PER100_MAX} g por 100 g.`,
} as const;

/**
 * A number typed in a field, written as the app writes it: the comma is the decimal separator ("12,5"), and a dot
 * followed by exactly three digits groups the thousands ("1.500" = 1500, "1.500,5" = 1500,5). Any other dot is a
 * decimal point ("3.5", "0.500"). undefined = empty; null = not a number.
 */
export function parseDecimal(text: string): number | undefined | null {
  const t = text.trim();
  if (t === '') return undefined;
  if (/^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^\d+(,\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  return /^\d+\.\d+$/.test(t) ? Number(t) : null;
}

interface NumberRule { required?: boolean; positive?: boolean; max?: number; maxText?: string }

/** The sentence for one number, or undefined when it is fine. NaN or null = not a number. */
export function numberIssue(v: number | null | undefined, rule: NumberRule): string | undefined {
  if (v === undefined) return rule.required ? NUMBER_TEXT.required : undefined;
  if (v === null || !Number.isFinite(v)) return NUMBER_TEXT.invalid;
  if (v < 0) return NUMBER_TEXT.negative;
  if (rule.positive && v === 0) return NUMBER_TEXT.positive;
  if (rule.max !== undefined && v > rule.max) return rule.maxText ?? `No máximo ${intText(rule.max)}.`;
  return undefined;
}

const nameIssue = (name: string): string | undefined => {
  const t = name.trim();
  if (t === '') return 'Dê um nome.';
  return t.length > FOOD_NAME_MAX ? `No máximo ${FOOD_NAME_MAX} caracteres.` : undefined;
};

export type FoodFields = Omit<Food, keyof BaseRecord>;

/** The food form as typed (numbers already parsed: undefined = empty, null = not a number). */
export interface FoodInput {
  name: string;
  per100: { kcal?: number | null; protein?: number | null; carbs?: number | null; fat?: number | null; fiber?: number | null };
  basis: FoodBasis;
  source: FoodSource;
  group: FoodGroup;
  like: FoodLike;
  unit?: { name: string; grams?: number | null };
  maxPortion?: number | null;
  /** "Bom para": the meals marked (none = every meal). Unknown values and repeats are dropped. */
  meals?: readonly NutritionMeal[];
}

type Extras = Pick<FoodFields, 'unit' | 'maxPortion' | 'meals'>;

/** Unit, portion and "Bom para" of the forms, shared by foods and recipes. */
function extrasOf(input: Pick<FoodInput, 'unit' | 'maxPortion' | 'meals'>, bad: (field: string, m?: string) => void): Extras {
  const out: Extras = {};
  const meals = cleanMeals(input.meals);
  if (meals.length > 0) out.meals = meals;
  const u = input.unit;
  const unitName = u?.name.trim() ?? '';
  if (u && (unitName !== '' || u.grams !== undefined)) {
    if (unitName === '') bad('unit', 'Dê um nome à unidade (ex.: fatia).');
    else if (unitName.length > 30) bad('unit', 'No máximo 30 caracteres.');
    else {
      const issue = numberIssue(u.grams, { required: true, positive: true, max: LOG_GRAMS_MAX, maxText: `No máximo ${intText(LOG_GRAMS_MAX)} g.` });
      if (issue) bad('unitGrams', issue);
      else out.unit = { name: unitName, grams: u.grams! };
    }
  }
  const mp = numberIssue(input.maxPortion, { positive: true, max: LOG_GRAMS_MAX, maxText: `No máximo ${intText(LOG_GRAMS_MAX)} g.` });
  if (mp) bad('maxPortion', mp);
  else if (input.maxPortion !== undefined && input.maxPortion !== null) out.maxPortion = input.maxPortion;
  return out;
}

/**
 * Validates the food form (§7): name; kcal, protein, carbs and fat required, ≥ 0, kcal ≤ 900 and each macro ≤ 100 per
 * 100 g; fiber optional; unit with name and grams; portion > 0. Returns what to store, or the issues (nothing saves).
 */
export function validateFood(input: FoodInput): { food?: FoodFields; issues: FieldIssue[] } {
  const issues: FieldIssue[] = [];
  const bad = (field: string, message?: string) => { if (message) issues.push({ field, message }); };
  bad('name', nameIssue(input.name));
  const p = input.per100;
  bad('kcal', numberIssue(p.kcal, { required: true, max: KCAL_PER100_MAX, maxText: NUMBER_TEXT.kcalMax }));
  for (const k of ['protein', 'carbs', 'fat'] as const) bad(k, numberIssue(p[k], { required: true, max: MACRO_PER100_MAX, maxText: NUMBER_TEXT.macroMax }));
  bad('fiber', numberIssue(p.fiber, { max: MACRO_PER100_MAX, maxText: NUMBER_TEXT.macroMax }));
  const extras = extrasOf(input, bad);
  if (issues.length > 0) return { issues };
  const per100: Nutrients = { kcal: p.kcal!, protein: p.protein!, carbs: p.carbs!, fat: p.fat! };
  if (p.fiber !== undefined && p.fiber !== null) per100.fiber = p.fiber;
  return {
    food: { name: input.name.trim(), per100, basis: input.basis, source: input.source, group: input.group, like: input.like, ...extras },
    issues,
  };
}

/** The warning of typed kcal more than 10% away from 4/4/9 × the macros (never blocks saving). */
export function kcalWarning(per100: Partial<Nutrients>): string | undefined {
  const { kcal, protein, carbs, fat } = per100;
  if (kcal === undefined || protein === undefined || carbs === undefined || fat === undefined) return undefined;
  const computed = macroKcal({ protein, carbs, fat });
  const ref = Math.max(kcal, computed);
  if (ref === 0 || Math.abs(kcal - computed) / ref <= KCAL_MISMATCH) return undefined;
  return `As calorias não batem com os macros: pela soma dariam ${kcalText(computed)}. Confira os valores.`;
}

/** The recipe form as typed. A recipe is always weighed ready ('pronto'). */
export interface RecipeInput {
  name: string;
  ingredients: { foodId: ID; grams?: number | null }[];
  yieldGrams?: number | null;
  group: FoodGroup;
  like: FoodLike;
  unit?: { name: string; grams?: number | null };
  maxPortion?: number | null;
  meals?: readonly NutritionMeal[];
}

/**
 * Validates a recipe (§7) and computes its per100 and source from the stored foods: at least one ingredient, grams for
 * each, every ingredient a live food other than the recipe itself, and the final weight. `note` = no cooking fat.
 */
export function validateRecipe(input: RecipeInput, foods: readonly Food[], selfId?: ID): { food?: FoodFields; issues: FieldIssue[]; note?: string } {
  const issues: FieldIssue[] = [];
  const bad = (field: string, message?: string) => { if (message) issues.push({ field, message }); };
  bad('name', nameIssue(input.name));
  const byId = new Map(live(foods).map((f) => [f.id, f]));
  if (input.ingredients.length === 0) bad('ingredients', 'Inclua pelo menos um ingrediente.');
  input.ingredients.forEach((ing, i) => {
    if (selfId !== undefined && ing.foodId === selfId) bad(`ingredients.${i}`, 'Uma receita não pode usar ela mesma.');
    else if (!byId.has(ing.foodId)) bad(`ingredients.${i}`, 'Este alimento foi apagado.');
    else bad(`ingredients.${i}`, numberIssue(ing.grams, { required: true, positive: true, max: LOG_GRAMS_MAX, maxText: `No máximo ${intText(LOG_GRAMS_MAX)} g.` }));
  });
  const y = input.yieldGrams;
  if (y === undefined || y === null || y === 0) bad('yieldGrams', 'Informe o rendimento final em gramas.');
  else bad('yieldGrams', numberIssue(y, { positive: true, max: LOG_GRAMS_MAX * 4, maxText: `No máximo ${intText(LOG_GRAMS_MAX * 4)} g.` }));
  const extras = extrasOf(input, bad);
  if (issues.length > 0) return { issues };
  const recipe: FoodRecipe = { ingredients: input.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams! })), yieldGrams: y! };
  const { per100, source } = recipeValues(recipe, foods);
  if (per100.protein + per100.carbs + per100.fat > MACRO_PER100_MAX || per100.kcal > KCAL_PER100_MAX) {
    return { issues: [{ field: 'yieldGrams', message: 'O rendimento ficou menor que o peso dos nutrientes. Confira as gramas.' }] };
  }
  const note = recipeFatNote(recipe.ingredients, foods);
  return {
    food: { name: input.name.trim(), per100, basis: 'pronto', source, group: input.group, like: input.like, ...extras, recipe },
    issues,
    ...(note ? { note } : {}),
  };
}

/** Issues of one group of targets (protein, carbs, fat in grams), fields prefixed with `prefix`. */
export function macroTargetIssues(t: { protein?: number | null; carbs?: number | null; fat?: number | null }, prefix = ''): FieldIssue[] {
  const out: FieldIssue[] = [];
  for (const k of MACROS) {
    const m = numberIssue(t[k], { required: true, max: TARGET_MACRO_MAX, maxText: `No máximo ${intText(TARGET_MACRO_MAX)} g.` });
    if (m) out.push({ field: `${prefix}${k}`, message: m });
  }
  return out;
}

/** Issues of the 7 weekday targets (fields `byWeekday.<d>.<macro>`). */
export function weekTargetIssues(byWeekday: readonly MacroTarget[]): FieldIssue[] {
  if (byWeekday.length !== 7) return [{ field: 'byWeekday', message: 'A meta precisa dos 7 dias da semana.' }];
  return byWeekday.flatMap((t, d) => macroTargetIssues(t, `byWeekday.${d}.`));
}

/** The grams of an eaten item: required, > 0, at most 5.000 g. */
export function logGramsIssue(grams: number | null | undefined): string | undefined {
  if (grams === undefined || grams === 0) return 'Informe as gramas.';
  return numberIssue(grams, { positive: true, max: LOG_GRAMS_MAX, maxText: `No máximo ${intText(LOG_GRAMS_MAX)} g.` });
}

/** The optional grams of the stock: empty = "tem, sem contar"; else ≥ 0. */
export function pantryGramsIssue(grams: number | null | undefined): string | undefined {
  return numberIssue(grams, { max: PANTRY_GRAMS_MAX, maxText: `No máximo ${intText(PANTRY_GRAMS_MAX)} g.` });
}

/** A weigh-in: 30–300 kg. */
export function weighInIssue(kg: number | null | undefined): string | undefined {
  if (kg === undefined) return NUMBER_TEXT.required;
  if (kg === null || !Number.isFinite(kg) || kg < WEIGHT_MIN || kg > WEIGHT_MAX) return `Peso entre ${WEIGHT_MIN} e ${WEIGHT_MAX} kg.`;
  return undefined;
}

/** One decimal, as stored. */
export const roundKg = (kg: number): number => Math.round(kg * 10) / 10;
/** Grams as stored: one decimal. */
export const roundGrams = (g: number): number => Math.round(g * 10) / 10;

// ------------------------------------------------------------------ stock

/** Live stock items confirmed on `day` (the only ones available that day). */
export function pantryToday(pantry: readonly PantryItem[], day: DayKey): PantryItem[] {
  return live(pantry).filter((p) => p.confirmedDay === day);
}

export function inStockToday(pantry: readonly PantryItem[], foodId: ID, day: DayKey): boolean {
  return pantryToday(pantry, day).some((p) => p.foodId === foodId);
}

/** "Tem hoje · 300 g", "Tem hoje" or "Tinha em 24/11". */
export function pantryStatusText(item: Pick<PantryItem, 'confirmedDay' | 'grams'>, day: DayKey, basis?: FoodBasis): string {
  if (item.confirmedDay !== day) return `Tinha em ${ddmm(item.confirmedDay)}`;
  return item.grams === undefined ? 'Tem hoje' : `Tem hoje · ${gramsText(item.grams, basis)}`;
}

/**
 * Whether the stock follows an item eaten on `day` at `eatenAt` (ms): only a counted stock confirmed that day, and not
 * counted again after the item was eaten (a later count already reflects what is left).
 */
export function stockFollows(item: PantryItem | undefined, day: DayKey, eatenAt: number): item is PantryItem & { grams: number } {
  return !!item && !item.deleted && item.grams !== undefined && item.confirmedDay === day
    && (item.countedAt === undefined || item.countedAt <= eatenAt);
}

/**
 * The grams an eaten item holds out of the counted stock when its grams go from `from` to `to` (0 = deleted), given
 * what it held and what the stock has left. Going down, the part eaten from elsewhere goes first, so at most what it
 * held goes back; going up, it takes only from what is left. The stock moves by (new − old held), never below 0 and
 * never above what was taken.
 */
export function heldAfter(held: number, from: number, to: number, stockGrams: number): number {
  if (to <= from) return Math.max(0, Math.min(held, to));
  return held + Math.max(0, Math.min(to - from, stockGrams));
}

/** Today's stock left after the planned items among `logs`: grams per food (Infinity = "tem, sem contar"). */
export function stockLeft(pantry: readonly PantryItem[], logs: readonly FoodLog[], day: DayKey): Map<ID, number> {
  const left = new Map<ID, number>();
  for (const p of pantryToday(pantry, day)) left.set(p.foodId, p.grams ?? Infinity);
  for (const l of live(logs)) {
    const g = left.get(l.foodId);
    if (l.day === day && l.status === 'planejado' && g !== undefined && Number.isFinite(g)) left.set(l.foodId, Math.max(0, g - l.grams));
  }
  return left;
}

/** Foods to choose from: live, matching the search by name (any case or accent), today's stock first, then by name. */
export function foodChoices(foods: readonly Food[], query: string, pantry: readonly PantryItem[], day: DayKey): Food[] {
  const q = normalize(query.trim());
  const stock = new Set(pantryToday(pantry, day).map((p) => p.foodId));
  return live(foods).filter((f) => normalize(f.name).includes(q))
    .sort((a, b) => Number(stock.has(b.id)) - Number(stock.has(a.id)) || byName(a, b));
}

// ------------------------------------------------------------------ weigh-ins

export interface WeighInSummary {
  last?: WeighIn;
  average?: number;          // of the last 7 days with a weigh-in (the latest weigh-in of each day)
  previousAverage?: number;  // of the 7 days with a weigh-in before those
  change?: number;           // average − previousAverage
  days: number;              // days in `average`
}

/** The weigh-ins in numbers: last one, average of the last 7 days with a weigh-in and the change from the 7 before. */
export function weighInSummary(weighIns: readonly WeighIn[]): WeighInSummary {
  const sorted = live(weighIns).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1)));
  const perDay: WeighIn[] = [];
  for (const w of sorted) if (perDay[perDay.length - 1]?.day !== w.day) perDay.push(w);
  const avg = (xs: WeighIn[]) => roundKg(xs.reduce((s, w) => s + w.kg, 0) / xs.length);
  const recent = perDay.slice(0, WEIGH_IN_DAYS);
  const before = perDay.slice(WEIGH_IN_DAYS, WEIGH_IN_DAYS * 2);
  const out: WeighInSummary = { days: recent.length };
  if (sorted[0]) out.last = sorted[0];
  if (recent.length > 0) out.average = avg(recent);
  if (before.length > 0) {
    out.previousAverage = avg(before);
    out.change = roundKg(out.average! - out.previousAverage);
  }
  return out;
}

// ------------------------------------------------------------------ texts

const ddmm = (day: DayKey): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** An integer in pt-BR: 1180 → "1.180" (rounded; never "-0"). */
export function intText(n: number): string {
  const r = Math.round(n) || 0;
  const s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return r < 0 ? `-${s}` : s;
}

export const kcalText = (n: number): string => `${intText(n)} kcal`;

/** "(cru)" next to the weights of raw foods; nothing for ready ones. */
export const basisNote = (basis?: FoodBasis): string => (basis === 'cru' ? ' (cru)' : '');

/** "150 g" or "150 g (cru)". */
export const gramsText = (grams: number, basis?: FoodBasis): string => `${intText(grams)} g${basisNote(basis)}`;

/** "72,4 kg". */
export const weightText = (kg: number): string => `${String(roundKg(kg)).replace('.', ',')} kg`;

/** "+0,4 kg", "-0,6 kg" or "0 kg". */
export function weightChangeText(change: number): string {
  const r = roundKg(change) || 0;
  return `${r > 0 ? '+' : ''}${weightText(r)}`;
}

/** What is left, or "passou 12 g" when it is negative (kcal with `unit` 'kcal'). */
export function remainingText(n: number, unit: 'g' | 'kcal' = 'g'): string {
  const r = Math.round(n) || 0;
  return r < 0 ? `passou ${intText(-r)} ${unit}` : `${intText(r)} ${unit}`;
}

/** "P 80/170" (without a target: "P 80"). */
export function progressText(macro: Macro, eaten: number, target?: number): string {
  return `${MACRO_LETTER[macro]} ${intText(eaten)}${target === undefined ? '' : `/${intText(target)}`}`;
}

/** "195 kcal · P 4 · C 42 · G 0". */
export function nutrientsText(n: Nutrients): string {
  return [kcalText(n.kcal), ...MACROS.map((m) => `${MACRO_LETTER[m]} ${intText(n[m])}`)].join(' · ');
}

/** "P 170 · C 260 · G 70 · 2.350 kcal". */
export function macroTargetText(t: MacroTarget): string {
  return [...MACROS.map((m) => `${MACRO_LETTER[m]} ${intText(t[m])}`), kcalText(macroKcal(t))].join(' · ');
}

/** "estimado" when any value comes from an estimate, else ''. */
export const estimateText = (estimate: boolean): string => (estimate ? 'estimado' : '');

/** "Hoje: 1.180 de 2.350 kcal · P 80/170 · C 140/260 · G 35/70" (without a target: "Hoje: 1.180 kcal · P 80 · C 140 · G 35"). */
export function daySummaryText(d: Pick<NutritionDay, 'eaten' | 'target'>): string {
  const t = d.target;
  const kcal = t ? `${intText(d.eaten.kcal)} de ${kcalText(t.kcal)}` : kcalText(d.eaten.kcal);
  return `Hoje: ${[kcal, ...MACROS.map((m) => progressText(m, d.eaten[m], t?.[m]))].join(' · ')}`;
}

/** "Desde 11/11: seg a sex P 170 · C 260 · G 70 · 2.350 kcal; sáb e dom …" (one group when every day is the same). */
export function targetHistoryText(t: Pick<NutritionTarget, 'from' | 'byWeekday'>): string {
  const g = targetGroups(t);
  const same = t.byWeekday.every((d) => MACROS.every((m) => d[m] === t.byWeekday[0]?.[m]));
  if (same && t.byWeekday[0]) return `Desde ${ddmm(t.from)}: ${macroTargetText(t.byWeekday[0])}`;
  const parts = [g.weekdays ? `seg a sex ${macroTargetText(g.weekdays)}` : '', g.weekend ? `sáb e dom ${macroTargetText(g.weekend)}` : ''];
  return `Desde ${ddmm(t.from)}: ${parts.filter(Boolean).join('; ')}`;
}

const PLURAL_IRREGULAR: Record<string, string> = { pão: 'pães' };

function pluralWord(w: string): string {
  const irregular = PLURAL_IRREGULAR[w.toLowerCase()];
  if (irregular) return irregular;
  if (/ão$/i.test(w)) return w.replace(/ão$/i, 'ões');
  if (/[aeiouáéíóúâêô]$/i.test(w)) return `${w}s`;
  if (/[rz]$/i.test(w)) return `${w}es`;
  if (/m$/i.test(w)) return w.replace(/m$/i, 'ns');
  return w;
}

/** "1 fatia", "2 fatias", "3 colheres de sopa" (the first word goes to the plural). */
export function unitCountText(n: number, unitName: string): string {
  if (n === 1) return `1 ${unitName}`;
  const [first = '', ...rest] = unitName.split(' ');
  return [intText(n), pluralWord(first), ...rest].join(' ');
}

/** A portion: "150 g (cru)", or "2 fatias · 50 g" when it is a whole number of the food's unit. */
export function portionText(grams: number, food: Pick<Food, 'basis' | 'unit'>): string {
  const g = gramsText(grams, food.basis);
  const u = food.unit;
  if (!u || u.grams <= 0) return g;
  const n = grams / u.grams;
  const whole = Math.round(n);
  return whole >= 1 && Math.abs(n - whole) < 1e-6 ? `${unitCountText(whole, u.name)} · ${g}` : g;
}

// ------------------------------------------------------------------ sentences of what is left or passed

export interface FoodSuggestion { foodId: ID; grams: number; inStock: boolean; text: string }
export interface NutritionNote {
  kind: 'falta' | 'passou';
  macro: Macro;
  grams: number;            // rounded, positive
  text: string;             // "Faltam 35 g de proteína." / "Passou 12 g da meta de gordura."
  suggestion?: FoodSuggestion;
}

/** Groups whose foods can close a missing macro. */
const MACRO_GROUPS: Record<Macro, readonly FoodGroup[]> = {
  protein: ['proteina', 'laticinio'], carbs: ['carboidrato', 'fruta'], fat: ['gordura'],
};

const LIKE_RANK: Record<FoodLike, number> = { gosto: 0, normal: 1, pouco: 2, nunca: 3 };

function byName(a: Food, b: Food): number {
  const x = normalize(a.name);
  const y = normalize(b.name);
  if (x !== y) return x < y ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Rounded up to the portion step: 5 g below 100 g, 10 g from 100 g on. */
function ceilToStep(g: number): number {
  const step = g < 100 ? 5 : 10;
  return Math.ceil(g / step - 1e-9) * step;
}

/** The end of a suggestion: whether what is left of today's stock (`left`: undefined = not in it) covers `grams`. */
function stockSentence(left: number | undefined, grams: number, basis: FoodBasis): string {
  if (left === undefined) return 'Não está no estoque de hoje.';
  if (left >= grams) return 'Está no estoque de hoje.';
  return Math.round(left) > 0 ? `No estoque de hoje sobram ${gramsText(left, basis)}.` : 'O estoque contado de hoje já entrou no plano.';
}

/**
 * A registered food (stock or not) that would close `deficit` grams of `macro`: the richest in that macro among its
 * groups (never 'nunca'), ties by preference and name. The sentence says whether today's stock still has it, after
 * the plan: `left` is the stock left per food (stockLeft; default: today's stock as counted). `inStock` = what is
 * left covers the grams.
 */
export function suggestFood(
  macro: Macro, deficit: number, foods: readonly Food[], pantry: readonly PantryItem[], day: DayKey, left?: ReadonlyMap<ID, number>,
): FoodSuggestion | undefined {
  const food = live(foods)
    .filter((f) => MACRO_GROUPS[macro].includes(f.group) && f.like !== 'nunca' && f.per100[macro] > 0)
    .sort((a, b) => b.per100[macro] - a.per100[macro] || LIKE_RANK[a.like] - LIKE_RANK[b.like] || byName(a, b))[0];
  if (!food || deficit <= 0) return undefined;
  const grams = ceilToStep((deficit * 100) / food.per100[macro]);
  const has = (left ?? stockLeft(pantry, [], day)).get(food.id);
  return {
    foodId: food.id, grams, inStock: has !== undefined && has >= grams,
    text: `Com mais ${gramsText(grams)} de ${food.name} (${food.basis}) chegaria. ${stockSentence(has, grams, food.basis)}`,
  };
}

/**
 * Sentences for each macro left (beyond the tolerance) after the plan, with a suggested food, or passed. `left` = the
 * stock left after the plan (stockLeft), so the suggestion never counts stock the plan already uses.
 */
export function nutritionNotes(input: {
  afterPlan: MacroTarget; foods: readonly Food[]; pantry: readonly PantryItem[]; day: DayKey; left?: ReadonlyMap<ID, number>;
}): NutritionNote[] {
  const out: NutritionNote[] = [];
  for (const macro of MACROS) {
    const left = input.afterPlan[macro];
    const grams = Math.round(Math.abs(left));
    if (left > PLAN_TOLERANCE[macro]) {
      const suggestion = suggestFood(macro, left, input.foods, input.pantry, input.day, input.left);
      out.push({
        kind: 'falta', macro, grams, text: `${grams === 1 ? 'Falta' : 'Faltam'} ${intText(grams)} g de ${MACRO_NAME[macro]}.`,
        ...(suggestion ? { suggestion } : {}),
      });
    } else if (left < -PLAN_TOLERANCE[macro]) {
      out.push({ kind: 'passou', macro, grams, text: `Passou ${intText(grams)} g da meta de ${MACRO_NAME[macro]}.` });
    }
  }
  return out;
}

// ------------------------------------------------------------------ the generator ("Montar o resto do dia", §5)

export interface PlanInput {
  day: DayKey;
  targets: readonly NutritionTarget[];
  // Any logs: the day's eaten ones count, and so do the planned ones kept in a meal that has something eaten; the
  // planned ones of meals with nothing eaten are the ones being replaced.
  logs: readonly FoodLog[];
  meals: readonly NutritionMeal[];  // switched on
  foods: readonly Food[];
  pantry: readonly PantryItem[];
  hunger: Hunger;
  afterTraining?: NutritionMeal;    // the meal right after training (pós-treino; the one before it, pré-treino)
}
export interface PlannedItem { meal: NutritionMeal; foodId: ID; grams: number }
export type PlanBlocked = 'sem-meta' | 'sem-estoque' | 'sem-refeicao';
export const PLAN_BLOCKED_TEXT: Record<PlanBlocked, string> = {
  'sem-meta': 'Defina as metas primeiro.',
  'sem-estoque': 'Confirme o estoque de hoje primeiro.',
  'sem-refeicao': 'As refeições de hoje já têm o que foi comido. Não sobrou refeição para montar.',
};
export type PlanOutcome =
  | { ok: false; reason: PlanBlocked; text: string }
  | {
    ok: true;
    meals: NutritionMeal[];   // the meals planned (in order; with hunger "pouca" a small one may have no item)
    items: PlannedItem[];     // in meal order, then protein, carbohydrate, vegetable, fruit, fat
    planned: Nutrients;
    afterPlan: MacroTarget;   // target − eaten − kept planned − planned (negative = passou)
    notes: NutritionNote[];
  };

/** The id of a planned item: one per day, meal and food, so two devices building the same plan before a sync converge. */
export const plannedLogId = (day: DayKey, meal: NutritionMeal, foodId: ID): ID => `plan-${day}-${meal}-${foodId}`;

/** Meals of `day` with nothing eaten: their planned items are the ones a new build replaces. */
export function mealsWithoutEaten(logs: readonly FoodLog[], day: DayKey): NutritionMeal[] {
  const eaten = new Set(live(logs).filter((l) => l.day === day && l.status === 'comido').map((l) => l.meal));
  return NUTRITION_MEALS.filter((m) => !eaten.has(m));
}

/** The rest of the day: meals switched on, with nothing eaten, after the last meal that has something eaten. */
export function remainingMeals(meals: readonly NutritionMeal[], logs: readonly FoodLog[], day: DayKey): NutritionMeal[] {
  const open = new Set(mealsWithoutEaten(logs, day));
  const last = NUTRITION_MEALS.reduce((n, m, i) => (open.has(m) ? n : i), -1);
  return NUTRITION_MEALS.filter((m, i) => i > last && meals.includes(m));
}

/** The part of `rest` the first of `meals` takes (weights 1 / 1,5; carbs × 1,3 for pré/pós-treino); negatives count as 0. */
export function mealShare(rest: MacroTarget, meals: readonly NutritionMeal[], training: TrainingMeals): MacroTarget {
  const first = meals[0];
  if (!first) return { protein: 0, carbs: 0, fat: 0 };
  const w = (m: NutritionMeal) => MEAL_WEIGHT[m];
  const wc = (m: NutritionMeal) => w(m) * (m === training.pre || m === training.post ? TRAINING_CARB_FACTOR : 1);
  const total = meals.reduce((s, m) => s + w(m), 0);
  const totalC = meals.reduce((s, m) => s + wc(m), 0);
  return {
    protein: (Math.max(0, rest.protein) * w(first)) / total,
    carbs: (Math.max(0, rest.carbs) * wc(first)) / totalC,
    fat: (Math.max(0, rest.fat) * w(first)) / total,
  };
}

/** One free item of the optimisation: its macros per 100 g and its upper bound in grams (Infinity = none). */
export interface PortionItem { per100: MacroTarget; upper: number }

/**
 * Grams for the items that minimise Σ penalty × (macro − goal)² (protein × 3, fat × 1,5, carbs × 1), with
 * 0 ≤ grams ≤ upper: projected coordinate descent from zero, at most PLAN_STEPS passes. Deterministic.
 */
export function optimizePortions(items: readonly PortionItem[], goal: MacroTarget): number[] {
  const grams = items.map(() => 0);
  const sum: MacroTarget = { protein: 0, carbs: 0, fat: 0 };
  for (let step = 0; step < PLAN_STEPS; step++) {
    let moved = 0;
    items.forEach((it, i) => {
      let num = 0;
      let den = 0;
      for (const k of MACROS) {
        const a = it.per100[k] / 100;
        num += PLAN_PENALTY[k] * a * (sum[k] - goal[k]);
        den += PLAN_PENALTY[k] * a * a;
      }
      if (den === 0) return;
      const next = Math.min(it.upper, Math.max(0, grams[i]! - num / den));
      const d = next - grams[i]!;
      if (d === 0) return;
      for (const k of MACROS) sum[k] += (d * it.per100[k]) / 100;
      grams[i] = next;
      moved = Math.max(moved, Math.abs(d));
    });
    if (moved < 1e-6) break;
  }
  return grams;
}

/**
 * A planned portion as shown: whole units for a food with a unit; else 5 g steps below 100 g and 10 g steps from
 * 100 g on. Never above `upper` (rounded down then).
 */
export function roundPortion(grams: number, upper: number, unit?: FoodUnit): number {
  if (unit && unit.grams > 0) {
    let n = Math.round(grams / unit.grams);
    while (n > 0 && n * unit.grams > upper + 1e-9) n -= 1;
    return n * unit.grams;
  }
  const step = grams < 100 ? 5 : 10;
  const r = Math.round(grams / step) * step;
  if (r <= upper + 1e-9) return r;
  const s = upper < 100 ? 5 : 10;
  return Math.floor(upper / s + 1e-9) * s;
}

interface PlanState {
  left: Map<ID, number>;       // stock left today (Infinity = "tem, sem contar")
  usedPouco: Set<ID>;          // 'pouco' foods already in a meal today
  prevProteins: Set<ID>;       // protein sources of the last meal with items
  rest: MacroTarget;           // target − committed (eaten, kept planned) − planned so far
  items: PlannedItem[];
}

const isProtein = (f: Food | undefined): boolean => f?.group === 'proteina' || f?.group === 'laticinio';

/**
 * The generator's grams per meal for `food`: its own maximum portion; without one, the group's default
 * (DEFAULT_MAX_PORTION) and, for a food with a unit, at most 4 units (one unit at least, even above the group's).
 */
export function maxPortionOf(food: Pick<Food, 'group' | 'unit' | 'maxPortion'>): number {
  if (food.maxPortion !== undefined) return food.maxPortion;
  const group = DEFAULT_MAX_PORTION[food.group] ?? DEFAULT_MAX_PORTION.outro;
  const unit = food.unit?.grams;
  return unit !== undefined && unit > 0 ? Math.min(MAX_UNITS_PER_MEAL * unit, Math.max(unit, group)) : group;
}

function upperOf(food: Food, state: PlanState): number {
  return Math.min(state.left.get(food.id) ?? 0, maxPortionOf(food));
}

/** The largest portion of `food` the bound allows: whole units for a food with a unit. */
function wholeUpper(food: Food, upper: number): number {
  const u = food.unit?.grams;
  return u !== undefined && u > 0 ? Math.floor(upper / u + 1e-9) * u : upper;
}

/**
 * A food the generator may put in this meal: not 'nunca', 'pouco' only once a day, not already in the meal, and in
 * stock with room for 10 g or more (whole units for a food with a unit: less than one unit left does not count).
 */
function usable(food: Food, state: PlanState, taken: ReadonlySet<ID>): boolean {
  if (food.like === 'nunca' || taken.has(food.id)) return false;
  if (food.like === 'pouco' && state.usedPouco.has(food.id)) return false;
  return wholeUpper(food, upperOf(food, state)) >= MIN_ITEM_GRAMS;
}

type Pick_ = (foods: readonly Food[], state: PlanState, taken: ReadonlySet<ID>) => Food | undefined;

/** Protein source: protein or dairy group, most protein per 100 g; preference breaks ties; not the previous meal's when another exists. */
const pickProtein: Pick_ = (foods, state, taken) => {
  const all = foods.filter((f) => isProtein(f) && f.per100.protein > 0 && usable(f, state, taken));
  const fresh = all.filter((f) => !state.prevProteins.has(f.id));
  return (fresh.length > 0 ? fresh : all)
    .sort((a, b) => b.per100.protein - a.per100.protein || LIKE_RANK[a.like] - LIKE_RANK[b.like] || byName(a, b))[0];
};

/** Carbohydrate source: carbohydrate or fruit group; gosto before normal, then most carbohydrate per 100 g. */
const pickCarb: Pick_ = (foods, state, taken) => foods
  .filter((f) => (f.group === 'carboidrato' || f.group === 'fruta') && f.per100.carbs > 0 && usable(f, state, taken))
  .sort((a, b) => LIKE_RANK[a.like] - LIKE_RANK[b.like] || b.per100.carbs - a.per100.carbs || byName(a, b))[0];

const pickOf = (group: FoodGroup): Pick_ => (foods, state, taken) => foods
  .filter((f) => f.group === group && usable(f, state, taken))
  .sort((a, b) => LIKE_RANK[a.like] - LIKE_RANK[b.like] || byName(a, b))[0];

/** Fat source: fat group; gosto before normal, then most fat per 100 g. */
const pickFat: Pick_ = (foods, state, taken) => foods
  .filter((f) => f.group === 'gordura' && f.per100.fat > 0 && usable(f, state, taken))
  .sort((a, b) => LIKE_RANK[a.like] - LIKE_RANK[b.like] || b.per100.fat - a.per100.fat || byName(a, b))[0];

interface Portion { food: Food; grams: number }

const macrosOfPortions = (ps: readonly Portion[]): MacroTarget => {
  const n = sumNutrients(ps.map((p) => nutrientsOf(p.food.per100, p.grams)));
  return { protein: n.protein, carbs: n.carbs, fat: n.fat };
};

/** Optimised grams (`raw`) and the rounded portions of the free items, given what the fixed items already bring. */
function solvePortions(free: readonly Food[], fixed: readonly Portion[], goal: MacroTarget, state: PlanState): { portions: Portion[]; raw: number[] } {
  const f = macrosOfPortions(fixed);
  const net = { protein: goal.protein - f.protein, carbs: goal.carbs - f.carbs, fat: goal.fat - f.fat };
  const raw = optimizePortions(free.map((food) => ({ per100: food.per100, upper: upperOf(food, state) })), net);
  return { raw, portions: free.map((food, i) => ({ food, grams: roundPortion(raw[i]!, upperOf(food, state), food.unit) })) };
}

/** A fixed portion (vegetable, extra fruit): `grams`, or what is left in stock, rounded down (whole units with `unit`). */
function fixedPortion(food: Food, state: PlanState, grams: number, unit?: FoodUnit): Portion | undefined {
  const upper = upperOf(food, state);
  const g = roundPortion(Math.min(grams, upper), upper, unit);
  return g >= MIN_ITEM_GRAMS ? { food, grams: g } : undefined;
}

/** The vegetable's fixed portion: 100 g, or the whole number of its units closest to 100 g (one at least). */
function vegetableGrams(veg: Food): number {
  const u = veg.unit?.grams;
  return u !== undefined && u > 0 ? u * Math.max(1, Math.round(VEGETABLE_GRAMS / u)) : VEGETABLE_GRAMS;
}

/**
 * One meal, in order: a protein source, a carbohydrate source, a vegetable (main meals; every meal with hunger
 * "muita", which also adds a fruit), and a fat source only when the fat still missing does not come from the rest.
 * Only foods whose "Bom para" includes the meal are considered. A protein or carbohydrate source whose best portion
 * cannot be served (it rounds below 10 g, i.e. less than one of its units) gives its place to the next candidate.
 */
function planMeal(meal: NutritionMeal, goal: MacroTarget, allFoods: readonly Food[], state: PlanState, hunger: Hunger): Portion[] {
  const foods = allFoods.filter((f) => goodFor(f, meal));
  const taken = new Set<ID>();
  const take = (f: Food | undefined): Food | undefined => { if (f) taken.add(f.id); return f; };
  let protein = take(pickProtein(foods, state, taken));
  let carb = take(pickCarb(foods, state, taken));
  const fixed: Portion[] = [];
  if (hunger === 'muita' || MAIN_MEALS.includes(meal)) {
    const veg = pickOf('verdura')(foods, state, taken);
    const p = veg && fixedPortion(veg, state, vegetableGrams(veg), veg.unit);
    if (p) { fixed.push(p); taken.add(p.food.id); }
  }
  if (hunger === 'muita' && carb?.group !== 'fruta') {
    const fruit = pickOf('fruta')(foods, state, taken);
    const p = fruit && fixedPortion(fruit, state, fruit.unit?.grams ?? FRUIT_GRAMS, fruit.unit);
    if (p) { fixed.push(p); taken.add(p.food.id); }
  }
  // Each pass either returns or swaps a source for one not tried yet (`taken` grows), so it ends.
  for (;;) {
    const mains = [protein, carb].filter((f): f is Food => f !== undefined);
    let { portions, raw } = solvePortions(mains, fixed, goal, state);
    if (goal.fat - macrosOfPortions([...portions, ...fixed]).fat > PLAN_TOLERANCE.fat) {
      const fat = pickFat(foods, state, taken);
      if (fat) ({ portions, raw } = solvePortions([...mains, fat], fixed, goal, state));
    }
    const lost = mains.find((_, i) => portions[i]!.grams < MIN_ITEM_GRAMS && raw[i]! >= MIN_ITEM_GRAMS);
    if (!lost) {
      return [...portions.slice(0, mains.length), ...fixed, ...portions.slice(mains.length)].filter((x) => x.grams >= MIN_ITEM_GRAMS);
    }
    if (lost === protein) protein = take(pickProtein(foods, state, taken));
    else carb = take(pickCarb(foods, state, taken));
  }
}

/** Plans `meals` in order; what is left or passed carries over to the next meal, and the last one closes the day. */
function planMeals(meals: readonly NutritionMeal[], foods: readonly Food[], start: PlanState, input: PlanInput): PlanState {
  const state: PlanState = {
    left: new Map(start.left), usedPouco: new Set(start.usedPouco), prevProteins: new Set(start.prevProteins),
    rest: { ...start.rest }, items: [],
  };
  const training = trainingMeals(input.meals, input.afterTraining);
  meals.forEach((meal, i) => {
    const goal = mealShare(state.rest, meals.slice(i), training);
    const portions = planMeal(meal, goal, foods, state, input.hunger);
    for (const { food, grams } of portions) {
      state.items.push({ meal, foodId: food.id, grams });
      const left = state.left.get(food.id) ?? 0;
      if (Number.isFinite(left)) state.left.set(food.id, Math.max(0, left - grams));
      if (food.like === 'pouco') state.usedPouco.add(food.id);
      const n = nutrientsOf(food.per100, grams);
      state.rest = { protein: state.rest.protein - n.protein, carbs: state.rest.carbs - n.carbs, fat: state.rest.fat - n.fat };
    }
    if (portions.length > 0) state.prevProteins = new Set(portions.filter((p) => isProtein(p.food)).map((p) => p.food.id));
  });
  return state;
}

const fits = (rest: MacroTarget): boolean => MACROS.every((m) => rest[m] <= PLAN_TOLERANCE[m]);

/**
 * The generator's starting point. What is committed today: the eaten items and the planned items kept in a meal that
 * has something eaten (a rebuild never replaces those). They lower the target left, their 'pouco' foods count as used,
 * the protein sources of the last meal with something eaten are not repeated, and the kept planned items take their
 * grams from today's stock (the eaten ones already did).
 */
function startState(input: PlanInput, foods: readonly Food[], target: MacroTarget): PlanState {
  const byId = new Map(foods.map((f) => [f.id, f]));
  const open = new Set(mealsWithoutEaten(input.logs, input.day));
  const today = live(input.logs).filter((l) => l.day === input.day);
  const eaten = today.filter((l) => l.status === 'comido');
  const kept = today.filter((l) => l.status === 'planejado' && !open.has(l.meal));
  const committed = [...eaten, ...kept];
  const t = totalsOf(committed);
  const left = new Map([...stockLeft(input.pantry, kept, input.day)].filter(([id]) => byId.has(id)));
  const lastMeal = eaten.reduce<NutritionMeal | undefined>((m, l) => (m === undefined || mealIndex(l.meal) > mealIndex(m) ? l.meal : m), undefined);
  return {
    left,
    usedPouco: new Set(committed.filter((l) => byId.get(l.foodId)?.like === 'pouco').map((l) => l.foodId)),
    prevProteins: new Set(committed.filter((l) => l.meal === lastMeal && isProtein(byId.get(l.foodId))).map((l) => l.foodId)),
    rest: { protein: target.protein - t.protein, carbs: target.carbs - t.carbs, fat: target.fat - t.fat },
    items: [],
  };
}

/**
 * "Montar o resto do dia" (§5): splits what is left of the day's target among the remaining meals and fills them from
 * today's confirmed stock, respecting stock, portion limits, preferences and "Bom para". Same input, same plan.
 */
export function planRestOfDay(input: PlanInput): PlanOutcome {
  const blocked = (reason: PlanBlocked): PlanOutcome => ({ ok: false, reason, text: PLAN_BLOCKED_TEXT[reason] });
  const target = targetFor(input.targets, input.day);
  if (!target) return blocked('sem-meta');
  const foods = live(input.foods).sort(byName);
  if (!pantryToday(input.pantry, input.day).some((p) => foods.some((f) => f.id === p.foodId))) return blocked('sem-estoque');
  const meals = remainingMeals(input.meals, input.logs, input.day);
  if (meals.length === 0) return blocked('sem-refeicao');

  const start = startState(input, foods, target);
  let state = planMeals(meals, foods, start, input);
  // With hunger "pouca" the smaller meals may stay empty, never the pré- or pós-treino one.
  const training = trainingMeals(input.meals, input.afterTraining);
  const big = meals.filter((m) => !SMALL_MEALS.includes(m) || m === training.pre || m === training.post);
  if (input.hunger === 'pouca' && big.length > 0 && big.length < meals.length) {
    const lighter = planMeals(big, foods, start, input);
    if (fits(lighter.rest)) state = lighter;
  }
  const planned = sumNutrients(state.items.map((it) => nutrientsOf(foods.find((f) => f.id === it.foodId)!.per100, it.grams)));
  return {
    ok: true, meals, items: state.items, planned, afterPlan: state.rest,
    notes: nutritionNotes({ afterPlan: state.rest, foods, pantry: input.pantry, day: input.day, left: state.left }),
  };
}
