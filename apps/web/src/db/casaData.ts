import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DayKey, FreezerMove, MealNow, Menu, Recipe, ShoppingList } from '@life/shared';
import { mealNow, menuId, shoppingListId, weekKey } from '@life/shared';
import { db } from './db';
import { useNow, useSettings, useToday } from './hooks';

// Live data of the Casa tab, its screens and the Agora's meal row (Marco 4).

/** Every recipe, soft-deleted included (menus resolve names through them); undefined while loading. */
export function useAllRecipes(): Recipe[] | undefined {
  return useLiveQuery(() => db.recipes.toArray());
}

/** The week's menu: undefined while loading, null when the week has none. */
export function useMenu(week: DayKey | undefined): Menu | null | undefined {
  return useLiveQuery(async () => {
    if (!week) return undefined;
    const m = await db.menus.get(menuId(week));
    return m && !m.deleted ? m : null;
  }, [week]);
}

/** The week's shopping list record: undefined while loading, null when nothing was ticked or added. */
export function useShoppingList(week: DayKey | undefined): ShoppingList | null | undefined {
  return useLiveQuery(async () => {
    if (!week) return undefined;
    const l = await db.shoppingLists.get(shoppingListId(week));
    return l && !l.deleted ? l : null;
  }, [week]);
}

/** Live freezer moves; undefined while loading. */
export function useFreezerMoves(): FreezerMove[] | undefined {
  return useLiveQuery(async () => (await db.freezerMoves.toArray()).filter((m) => !m.deleted));
}

/** The planned dish of the current meal (see `mealNow`); undefined when there is none or while loading. */
export function useMealNow(): MealNow | undefined {
  const settings = useSettings();
  const today = useToday();
  const now = useNow();
  const menu = useMenu(today ? weekKey(today) : undefined);
  const recipes = useAllRecipes();
  const moves = useFreezerMoves();
  return useMemo(() => {
    if (!settings || menu === undefined || !recipes || !moves) return undefined;
    return mealNow({ now, dayStartHour: settings.dayStartHour, menu: menu ?? undefined, recipes, moves });
  }, [settings, menu, recipes, moves, now]);
}
