import { describe, expect, it } from 'vitest';
import type { FreezerMove, MenuSlot, Recipe } from '../src/types';
import {
  currentMeal, dishCounts, freezerLow, freezerStock, freezerTotal, ingredientKey, mealNow, mealprepXpId, menuId,
  parseIngredients, planningWeek, prepHints, prepMissionId, rawPortions, setSlot, shiftSlots, shoppingListId, shoppingRows, slotOf,
  weekDays,
} from '../src/meals';

const at = (d: number, h: number, m = 0): number => new Date(2026, 10, d, h, m).getTime();
const base = { createdAt: 1, updatedAt: 1, deleted: false };
const recipe = (id: string, name: string, ingredients: string[] = [], deleted = false): Recipe =>
  ({ ...base, id, name, ingredients, deleted });
const move = (recipeId: string, delta: number, kind: FreezerMove['kind'], p: Partial<FreezerMove> = {}): FreezerMove =>
  ({ ...base, id: `${recipeId}${delta}${kind}${p.day ?? ''}`, at: 1, day: '2026-11-13', recipeId, delta, kind, ...p });

describe('ids and text', () => {
  it('deterministic ids and the days of a week', () => {
    expect(menuId('2026-11-09')).toBe('menu-2026-11-09');
    expect(shoppingListId('2026-11-09')).toBe('shop-2026-11-09');
    expect(prepMissionId('2026-11-09')).toBe('prep-2026-11-09');
    expect(mealprepXpId('2026-11-13')).toBe('xp-mealprep-2026-11-13');
    expect(weekDays('2026-11-09')).toEqual([
      '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15',
    ]);
  });
  it('planningWeek: this week on workdays, next week on the weekend', () => {
    expect(planningWeek('2026-11-09')).toBe('2026-11-09');
    expect(planningWeek('2026-11-13')).toBe('2026-11-09');
    expect(planningWeek('2026-11-14')).toBe('2026-11-16');
    expect(planningWeek('2026-11-15')).toBe('2026-11-16');
  });
  it('ingredientKey ignores accents, case and extra spaces', () => {
    expect(ingredientKey('  Feijão   Preto ')).toBe('feijao preto');
  });
  it('parseIngredients: one per line, markers off, blanks and repeats out', () => {
    expect(parseIngredients('- frango 1 kg\n\n* Arroz\r\n1. feijão\n• cebola\narroz\n2 ovos\n   '))
      .toEqual(['frango 1 kg', 'Arroz', 'feijão', 'cebola', '2 ovos']);
    expect(parseIngredients('x'.repeat(100))[0]).toHaveLength(80);
    expect(parseIngredients(Array.from({ length: 45 }, (_, i) => `item ${i}`).join('\n'))).toHaveLength(40);
  });
});

describe('menu slots', () => {
  it('setSlot sets, replaces and clears, sorted by day then meal', () => {
    let slots: MenuSlot[] = [];
    slots = setSlot(slots, '2026-11-10', 'jantar', 'r2');
    slots = setSlot(slots, '2026-11-10', 'almoco', 'r1');
    slots = setSlot(slots, '2026-11-09', 'jantar', 'r3');
    expect(slots).toEqual([
      { day: '2026-11-09', meal: 'jantar', recipeId: 'r3' },
      { day: '2026-11-10', meal: 'almoco', recipeId: 'r1' },
      { day: '2026-11-10', meal: 'jantar', recipeId: 'r2' },
    ]);
    expect(slotOf({ slots: setSlot(slots, '2026-11-10', 'almoco', 'r4') }, '2026-11-10', 'almoco')?.recipeId).toBe('r4');
    expect(setSlot(slots, '2026-11-10', 'almoco', null)).toHaveLength(2);
    expect(slotOf(undefined, '2026-11-10', 'almoco')).toBeUndefined();
  });
  it('shiftSlots moves a week ahead', () => {
    expect(shiftSlots([{ day: '2026-11-09', meal: 'almoco', recipeId: 'r1' }], 7))
      .toEqual([{ day: '2026-11-16', meal: 'almoco', recipeId: 'r1' }]);
  });
});

const R = [
  recipe('r1', 'Frango com arroz', ['frango 1 kg', 'arroz', 'cebola']),
  recipe('r2', 'Strogonoff', ['frango 1 kg', 'Cebola', 'creme de leite']),
  recipe('r3', 'Sopa', ['abóbora'], true),
  recipe('r4', 'Arroz doce', ['leite']),
];
const slot = (day: number, meal: MenuSlot['meal'], recipeId: string): MenuSlot =>
  ({ day: `2026-11-${String(day).padStart(2, '0')}`, meal, recipeId });

describe('dishCounts and shoppingRows', () => {
  it('counts meals per dish: most used first, then by name; unknown ids skipped, deleted kept', () => {
    const menu = { slots: [slot(9, 'almoco', 'r1'), slot(10, 'almoco', 'r1'), slot(11, 'almoco', 'r1'),
      slot(9, 'jantar', 'r2'), slot(10, 'jantar', 'r3'), slot(11, 'jantar', 'r3'), slot(12, 'jantar', 'r4'),
      slot(13, 'jantar', 'gone')] };
    expect(dishCounts(menu, R)).toEqual([
      { recipeId: 'r1', name: 'Frango com arroz', count: 3 },
      { recipeId: 'r3', name: 'Sopa', count: 2 },
      { recipeId: 'r4', name: 'Arroz doce', count: 1 },
      { recipeId: 'r2', name: 'Strogonoff', count: 1 },
    ]);
  });
  it('merges ingredients once per dish, alphabetical, manual after, checked at the end', () => {
    const rows = shoppingRows({
      menu: { slots: [slot(9, 'almoco', 'r1'), slot(10, 'almoco', 'r1'), slot(9, 'jantar', 'r2')] },
      recipes: R,
      list: { manual: [{ id: 'a', text: 'detergente' }], checked: ['g:arroz', 'm:a'] },
    });
    expect(rows.map((r) => [r.key, r.text, r.checked])).toEqual([
      ['g:cebola', 'cebola', false],
      ['g:creme de leite', 'creme de leite', false],
      ['g:frango 1 kg', 'frango 1 kg', false],
      ['g:arroz', 'arroz', true],
      ['m:a', 'detergente', true],
    ]);
    expect(rows[0]!.from).toEqual(['Frango com arroz', 'Strogonoff']);
    expect(rows[4]).toMatchObject({ manualId: 'a', from: [] });
    expect(shoppingRows({ recipes: R })).toEqual([]);
  });
});

describe('freezer', () => {
  const moves = [
    move('r1', 8, 'prep'), move('r1', -1, 'eat'), move('r2', 3, 'prep'), move('r2', -3, 'eat'),
    move('r3', 2, 'prep'), move('r3', -2, 'eat', { deleted: true }), move('r4', -1, 'fix'),
  ];
  it('stock per dish from the live moves, only positive, most first', () => {
    const stock = freezerStock(moves);
    expect(stock).toEqual([{ recipeId: 'r1', portions: 7 }, { recipeId: 'r3', portions: 2 }]);
    expect(freezerTotal(stock)).toBe(9);
    expect(rawPortions(moves, 'r4')).toBe(-1);
    expect(rawPortions(moves, 'r3')).toBe(2);
  });
  it('low below 3 portions, only after a batch prep happened', () => {
    const prepped = [move('r1', 4, 'prep'), move('r1', -2, 'eat')];
    expect(freezerLow(freezerStock(prepped), prepped)).toBe(true);
    const fixed = [move('r1', 2, 'fix')];
    expect(freezerLow(freezerStock(fixed), fixed)).toBe(false);
    const three = [move('r1', 3, 'prep')];
    expect(freezerLow(freezerStock(three), three)).toBe(false);
    expect(freezerLow([], [])).toBe(false);
  });
  it('prepHints: planned meals and frozen portions per dish of the week', () => {
    const menu = { slots: [slot(9, 'almoco', 'r1'), slot(10, 'almoco', 'r1'), slot(9, 'jantar', 'r2')] };
    expect(prepHints(menu, R, freezerStock(moves))).toEqual([
      { recipeId: 'r1', name: 'Frango com arroz', planned: 2, inFreezer: 7 },
      { recipeId: 'r2', name: 'Strogonoff', planned: 1, inFreezer: 0 },
    ]);
  });
});

describe('meal of now', () => {
  it('currentMeal: lunch 10–16, dinner from 17 until the day starts', () => {
    expect(currentMeal(at(13, 9, 59), 4)).toBeUndefined();
    expect(currentMeal(at(13, 10), 4)).toBe('almoco');
    expect(currentMeal(at(13, 15, 59), 4)).toBe('almoco');
    expect(currentMeal(at(13, 16), 4)).toBeUndefined();
    expect(currentMeal(at(13, 17), 4)).toBe('jantar');
    expect(currentMeal(at(14, 3, 59), 4)).toBe('jantar');
    expect(currentMeal(at(14, 4), 4)).toBeUndefined();
  });
  it('mealNow: the planned dish, its portions and whether it was eaten', () => {
    const menu = { slots: [slot(13, 'almoco', 'r1'), slot(13, 'jantar', 'r2')] };
    const frozen = [move('r1', 4, 'prep')];
    expect(mealNow({ now: at(13, 12), dayStartHour: 4, menu, recipes: R, moves: frozen })).toEqual({
      day: '2026-11-13', meal: 'almoco', recipeId: 'r1', name: 'Frango com arroz', portions: 4, eaten: false,
    });
    const ate = [...frozen, move('r1', -1, 'eat', { meal: 'almoco' })];
    expect(mealNow({ now: at(13, 12), dayStartHour: 4, menu, recipes: R, moves: ate })).toMatchObject({ portions: 3, eaten: true });
    expect(mealNow({ now: at(14, 1), dayStartHour: 4, menu, recipes: R, moves: ate }))
      .toMatchObject({ day: '2026-11-13', meal: 'jantar', recipeId: 'r2', portions: 0, eaten: false });
    expect(mealNow({ now: at(13, 16, 30), dayStartHour: 4, menu, recipes: R, moves: ate })).toBeUndefined();
    expect(mealNow({ now: at(14, 12), dayStartHour: 4, menu, recipes: R, moves: ate })).toBeUndefined();
  });
});
