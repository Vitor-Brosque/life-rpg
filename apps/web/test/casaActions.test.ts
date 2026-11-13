import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freezerStock } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { completeMission } from '../src/domain/missionActions';
import {
  addShoppingItem, copyPreviousWeek, eatPortion, ensurePrepMission, ensureRecipe, finishPrep, fixPortions,
  removeShoppingItem, saveRecipe, setMenuSlot, toggleShoppingItem, undoFreezerMove, undoPrep,
} from '../src/domain/mealActions';

const at = (d: number, h: number, m = 0): Date => new Date(2026, 10, d, h, m);
const WEEK = '2026-11-09';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(13, 10));
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

const stock = async () => freezerStock(await db.freezerMoves.toArray());

describe('recipes', () => {
  it('saveRecipe cleans the name, parses the ingredients and keeps names unique', async () => {
    const r = await saveRecipe({ name: '  Frango   com arroz ', ingredients: '- frango 1 kg\narroz\n' });
    expect(r).toMatchObject({ name: 'Frango com arroz', ingredients: ['frango 1 kg', 'arroz'], deleted: false });
    await expect(saveRecipe({ name: 'frango com ARRÓZ', ingredients: '' })).rejects.toThrow('Já existe uma receita com esse nome.');
    await expect(saveRecipe({ name: '   ', ingredients: '' })).rejects.toThrow('Dê um nome ao prato.');
    const edited = await saveRecipe({ id: r.id, name: 'Frango com arroz', ingredients: 'frango\narroz\nalho' });
    expect(edited.ingredients).toEqual(['frango', 'arroz', 'alho']);
  });

  it('ensureRecipe finds by name (accents and case ignored) or creates an empty one', async () => {
    const r = await saveRecipe({ name: 'Feijão', ingredients: 'feijão' });
    expect((await ensureRecipe(' feijao ')).id).toBe(r.id);
    expect(await ensureRecipe('Omelete')).toMatchObject({ name: 'Omelete', ingredients: [] });
    expect((await db.recipes.toArray()).length).toBe(2);
  });
});

describe('menu', () => {
  it('setMenuSlot writes the week record; copyPreviousWeek fills an empty week a week later', async () => {
    const menu = await setMenuSlot(WEEK, '2026-11-10', 'almoco', 'r1');
    expect(menu).toMatchObject({ id: 'menu-2026-11-09', week: WEEK, slots: [{ day: '2026-11-10', meal: 'almoco', recipeId: 'r1' }] });
    await expect(setMenuSlot(WEEK, '2026-11-16', 'almoco', 'r1')).rejects.toThrow();
    expect(await copyPreviousWeek('2026-11-16')).toBe(1);
    expect((await db.menus.get('menu-2026-11-16'))!.slots).toEqual([{ day: '2026-11-17', meal: 'almoco', recipeId: 'r1' }]);
    expect(await copyPreviousWeek('2026-11-16')).toBe(0);
    expect((await setMenuSlot(WEEK, '2026-11-10', 'almoco', null)).slots).toEqual([]);
  });
});

describe('shopping list', () => {
  it('ticks, adds and removes, one record per week', async () => {
    await toggleShoppingItem(WEEK, 'g:arroz');
    expect((await db.shoppingLists.get('shop-2026-11-09'))!.checked).toEqual(['g:arroz']);
    await toggleShoppingItem(WEEK, 'g:arroz');
    expect((await db.shoppingLists.get('shop-2026-11-09'))!.checked).toEqual([]);
    const item = await addShoppingItem(WEEK, '  detergente ');
    expect(item).toMatchObject({ text: 'detergente' });
    expect(await addShoppingItem(WEEK, 'Detergente')).toBeUndefined();
    expect(await addShoppingItem(WEEK, '   ')).toBeUndefined();
    await toggleShoppingItem(WEEK, `m:${item!.id}`);
    await removeShoppingItem(WEEK, item!.id);
    expect(await db.shoppingLists.get('shop-2026-11-09')).toMatchObject({ manual: [], checked: [] });
  });
});

describe('freezer and batch prep', () => {
  it('finishPrep adds portions and +10 XP once a day; eat, fix and undo move the count', async () => {
    const r = await finishPrep([{ recipeId: 'r1', portions: 8 }, { recipeId: 'r2', portions: 0 }, { recipeId: 'r1', portions: 2 }]);
    expect(r).toMatchObject({ day: '2026-11-13', portions: 10, xp: 10 });
    expect(r.moveIds).toHaveLength(1);
    expect(await db.xpEvents.get('xp-mealprep-2026-11-13')).toMatchObject({ amount: 10, reason: 'mealprep', areaId: 'area-ordem' });
    expect((await finishPrep([{ recipeId: 'r2', portions: 4 }])).xp).toBe(0);
    const eat = await eatPortion('r1', 'almoco');
    expect(eat.move).toMatchObject({ delta: -1, kind: 'eat', meal: 'almoco', day: '2026-11-13' });
    expect(eat).toMatchObject({ total: 13, low: false });
    expect((await eatPortion('r9')).move).toBeUndefined();
    const fix = await fixPortions('r1', 2);
    expect(fix).toMatchObject({ delta: -7, kind: 'fix' });
    expect(await fixPortions('r1', 2)).toBeUndefined();
    expect(await stock()).toEqual([{ recipeId: 'r2', portions: 4 }, { recipeId: 'r1', portions: 2 }]);
    await undoFreezerMove(fix!.id);
    expect(await stock()).toEqual([{ recipeId: 'r1', portions: 9 }, { recipeId: 'r2', portions: 4 }]);
    expect(await finishPrep([])).toMatchObject({ moveIds: [], portions: 0, xp: 0 });
  });

  it('two preps on one day: the XP stays while one stands and goes with the last undo', async () => {
    const a = await finishPrep([{ recipeId: 'r1', portions: 4 }]);
    const b = await finishPrep([{ recipeId: 'r2', portions: 4 }]);
    expect([a.xp, b.xp]).toEqual([10, 0]);
    await undoPrep(a);
    expect((await db.xpEvents.get('xp-mealprep-2026-11-13'))!.deleted).toBeFalsy();
    await undoPrep(b);
    expect((await db.xpEvents.get('xp-mealprep-2026-11-13'))!.deleted).toBe(true);
  });

  it('eating down to fewer than 3 portions reports the freezer as low', async () => {
    await finishPrep([{ recipeId: 'r1', portions: 3 }]);
    expect(await eatPortion('r1')).toMatchObject({ total: 2, low: true });
  });

  it('the week prep mission: created once while open, completed by finishPrep without its own XP, undone', async () => {
    const m = await ensurePrepMission(WEEK);
    expect(m).toMatchObject({ id: 'prep-2026-11-09', title: 'Preparo em lote', areaId: 'area-ordem', status: 'open', durationMin: 90 });
    expect((await ensurePrepMission(WEEK)).createdAt).toBe(m.createdAt);
    const r = await finishPrep([{ recipeId: 'r1', portions: 6 }]);
    expect(r.mission).toMatchObject({ id: 'prep-2026-11-09', status: 'open' });
    expect(await db.missions.get('prep-2026-11-09')).toMatchObject({ status: 'done', completedAt: at(13, 10).getTime() });
    expect(await db.xpEvents.get('xp-complete-prep-2026-11-09')).toBeUndefined();
    await undoPrep(r);
    const reopened = (await db.missions.get('prep-2026-11-09'))!;
    expect(reopened.status).toBe('open');
    expect(reopened).not.toHaveProperty('completedAt');
    expect((await db.xpEvents.get('xp-mealprep-2026-11-13'))!.deleted).toBe(true);
    expect(await stock()).toEqual([]);
    const events = (await db.events.where('missionId').equals('prep-2026-11-09').toArray()).map((e) => e.type);
    expect(events).toEqual(expect.arrayContaining(['created', 'completed', 'uncompleted']));
    await finishPrep([{ recipeId: 'r1', portions: 6 }]);
    expect((await ensurePrepMission(WEEK)).status).toBe('open');
  });

  it('a prep on the Monday completes the previous week\'s open prep mission (marked on Sunday)', async () => {
    vi.setSystemTime(at(15, 10));
    await ensurePrepMission(WEEK);
    vi.setSystemTime(at(16, 10));
    const r = await finishPrep([{ recipeId: 'r1', portions: 6 }]);
    expect(r.mission).toMatchObject({ id: 'prep-2026-11-09', status: 'open' });
    expect(await db.missions.get('prep-2026-11-09')).toMatchObject({ status: 'done' });
    expect(await db.missions.get('prep-2026-11-16')).toBeUndefined();
  });

  it('a prep mission completed by hand the same day leaves no second XP for the prep', async () => {
    await ensurePrepMission(WEEK);
    await completeMission('prep-2026-11-09');
    expect(await db.xpEvents.get('xp-complete-prep-2026-11-09')).toBeDefined();
    const r = await finishPrep([{ recipeId: 'r1', portions: 6 }]);
    expect(r.xp).toBe(0);
    expect(r.portions).toBe(6);
    expect(await db.xpEvents.get('xp-mealprep-2026-11-13')).toBeUndefined();
  });
});
