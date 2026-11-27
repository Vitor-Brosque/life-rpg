import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DayKey, Food, FoodLog, NutritionBuild, NutritionDay, NutritionSettings, NutritionTarget, PantryItem, WeighIn } from '@life/shared';
import { NUTRITION_BUILD_KEY, dayLogs, nutritionDay, nutritionSettingsOf, normalize } from '@life/shared';
import { db } from './db';
import { useSettings } from './hooks';

// Live data of the Nutrição screens (spec 2026-11-25-nutricao-design.md). Every hook returns undefined while loading.

/** Live foods and recipes, by name (any case or accent). */
export function useFoods(): Food[] | undefined {
  return useLiveQuery(async () => (await db.foods.toArray()).filter((f) => !f.deleted)
    .sort((a, b) => (normalize(a.name) < normalize(b.name) ? -1 : normalize(a.name) > normalize(b.name) ? 1 : a.id < b.id ? -1 : 1)));
}

/** Live target records, newest `from` first (the history). */
export function useNutritionTargets(): NutritionTarget[] | undefined {
  return useLiveQuery(async () => (await db.nutritionTargets.orderBy('from').reverse().toArray()).filter((t) => !t.deleted));
}

/**
 * The live logs of `day`, by meal, then order inside the meal; undefined without a day. (useLiveQuery keeps the last
 * result while a new day's query runs: an empty list for "no day yet" would show as "Nada registrado" for a moment.)
 */
export function useFoodLogs(day?: DayKey): FoodLog[] | undefined {
  return useLiveQuery(async () => (day ? dayLogs(await db.foodLogs.where('day').equals(day).toArray(), day) : undefined), [day]);
}

/** Every live stock item (today's and older ones, which show "Tinha em … · Confirmar"). */
export function usePantry(): PantryItem[] | undefined {
  return useLiveQuery(async () => (await db.pantry.toArray()).filter((p) => !p.deleted));
}

/** Live weigh-ins, newest first. */
export function useWeighIns(): WeighIn[] | undefined {
  return useLiveQuery(async () => (await db.weighIns.toArray()).filter((w) => !w.deleted)
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.createdAt - a.createdAt)));
}

/** `settings.nutrition` with defaults (every meal on). */
export function useNutritionSettings(): NutritionSettings | undefined {
  const settings = useSettings();
  return useMemo(() => (settings ? nutritionSettingsOf(settings) : undefined), [settings]);
}

/**
 * This device's last "Montar o resto do dia" (local meta, never synced): `null` when there is none, undefined while
 * loading. It drives the pré/pós-treino tags and whether the plan's result shows.
 */
export function useNutritionBuild(): NutritionBuild | null | undefined {
  return useLiveQuery(async () => ((await db.meta.get(NUTRITION_BUILD_KEY))?.value as NutritionBuild | undefined) ?? null);
}

/** The top of the Nutrição screen for `day`: target, eaten, planned, what is left (and after the plan). */
export function useNutritionDay(day?: DayKey): NutritionDay | undefined {
  const targets = useNutritionTargets();
  const logs = useFoodLogs(day);
  return useMemo(
    () => (day && targets && logs ? nutritionDay({ day, targets, logs }) : undefined),
    [day, targets, logs],
  );
}
