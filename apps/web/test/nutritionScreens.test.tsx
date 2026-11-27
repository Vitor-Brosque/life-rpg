import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Food, FoodInput, FoodLog, MacroTarget, NutritionMeal, NutritionTarget, PantryItem } from '@life/shared';
import { NO_FAT_NOTE, PLAN_TOLERANCE, WEIGH_IN_NOTE, logSnapshot, nutritionDay, nutritionTargetId, weekTargets } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { confirmPantry, getNutritionBuild, logEaten, saveFood, saveTargets, setMealOn } from '../src/domain/nutritionActions';
import { CorpoScreen } from '../src/features/corpo/CorpoScreen';
import { FoodsScreen } from '../src/features/nutrition/FoodsScreen';
import { NutritionScreen } from '../src/features/nutrition/NutritionScreen';
import { NutritionTargetsScreen } from '../src/features/nutrition/NutritionTargetsScreen';
import { ToastHost, useToast } from '../src/ui/Toast';

// Every food and number here is invented. Today is Wednesday 2026-11-25 (day start 04:00).

const at = (d: number, h: number, m = 0): Date => new Date(2026, 10, d, h, m);
const DAY = '2026-11-25';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(25, 10));
  await db.delete(); await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
});
afterEach(() => { vi.useRealTimers(); });

function renderAt(path: string, ui: React.ReactNode) {
  const { hook, history } = memoryLocation({ path, record: true });
  const view = render(<Router hook={hook}>{ui}<ToastHost /></Router>);
  return { ...view, history };
}

const input = (name: string, group: FoodInput['group'], p: [number, number, number, number], extra: Partial<FoodInput> = {}): FoodInput => ({
  name, group, per100: { kcal: p[0], protein: p[1], carbs: p[2], fat: p[3] }, basis: 'pronto', source: 'tabela', like: 'normal', ...extra,
});
const TARGET: MacroTarget = { protein: 160, carbs: 250, fat: 60 }; // 2.180 kcal
const setTarget = () => saveTargets(weekTargets(TARGET, TARGET));
const arroz = () => saveFood(input('Arroz branco', 'carboidrato', [130, 2.7, 28, 0.3]));

async function planned(meal: NutritionMeal, food: Food, grams: number, order = 0): Promise<FoodLog> {
  return put('foodLogs', newRecord<FoodLog>({ day: DAY, meal, ...logSnapshot(food), grams, status: 'planejado', order }));
}
const liveLogs = async (): Promise<FoodLog[]> => (await db.foodLogs.toArray()).filter((l) => !l.deleted);
const region = (name: string) => screen.getByRole('region', { name });

describe('Corpo → Nutrição (summary)', () => {
  it('without a target: "Definir metas" and "Abrir nutrição"', async () => {
    renderAt('/corpo', <CorpoScreen />);
    expect(await screen.findByRole('link', { name: 'Definir metas' })).toHaveAttribute('href', '/corpo/nutricao/metas');
    expect(screen.getByRole('link', { name: 'Abrir nutrição' })).toHaveAttribute('href', '/corpo/nutricao');
    expect(screen.queryByText(/^Hoje:/)).not.toBeInTheDocument();
  });

  it('with a target: today\'s summary and no "Definir metas"', async () => {
    await setTarget();
    const rice = await arroz();
    await logEaten({ meal: 'almoco', foodId: rice.id, grams: 150 });
    renderAt('/corpo', <CorpoScreen />);
    expect(await screen.findByText('Hoje: 195 de 2.180 kcal · P 4/160 · C 42/250 · G 0/60')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Definir metas' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir nutrição' })).toBeInTheDocument();
  });
});

describe('/corpo/nutricao: the diary', () => {
  it('logs eaten food from the picker (comma grams): totals and the counted stock follow', async () => {
    const user = userEvent.setup();
    await setTarget();
    const rice = await arroz();
    await saveFood(input('Feijão', 'carboidrato', [76, 4.8, 13.6, 0.5]));
    await confirmPantry(rice.id, 500);
    renderAt('/corpo/nutricao', <NutritionScreen />);
    expect(await screen.findByRole('progressbar', { name: 'Calorias: 0 de 2.180 kcal' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adicionar o que comi no Almoço' }));
    const sheet = await screen.findByRole('dialog', { name: 'O que comi: Almoço' });
    const options = within(sheet).getAllByRole('button', { name: /^(Arroz branco|Feijão)/ });
    expect(options.map((b) => b.textContent)).toEqual(['Arroz brancotem hoje', 'Feijão']); // today's stock first
    await user.type(within(sheet).getByLabelText('Alimento: buscar pelo nome'), 'arr');
    await user.click(within(sheet).getByRole('button', { name: /^Arroz branco/ }));
    const grams = within(sheet).getByLabelText('Gramas de Arroz branco no Almoço');
    expect(grams).toHaveFocus();
    await user.type(grams, '150,5');
    expect(within(sheet).getByText('196 kcal · P 4 · C 42 · G 0')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByText('Registrado: Arroz branco no Almoço.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('progressbar', { name: 'Calorias: 196 de 2.180 kcal' })).toBeInTheDocument();
    expect(within(region('Almoço')).getByRole('button', { name: /^Corrigir gramas de Arroz branco no Almoço/ })).toBeInTheDocument();
    expect(within(region('Estoque de hoje')).getByText('Tem hoje · 350 g')).toBeInTheDocument();
    expect((await db.pantry.get(`pantry-${rice.id}`))!.grams).toBe(349.5);
    expect((await liveLogs())[0]).toMatchObject({ meal: 'almoco', grams: 150.5, status: 'comido' });
  });

  it('refuses empty or invalid grams with the sentence in the field', async () => {
    const user = userEvent.setup();
    await arroz();
    renderAt('/corpo/nutricao', <NutritionScreen />);
    await user.click(await screen.findByRole('button', { name: 'Adicionar o que comi na Ceia' }));
    const sheet = await screen.findByRole('dialog', { name: 'O que comi: Ceia' });
    await user.click(within(sheet).getByRole('button', { name: /^Arroz branco/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Registrar' }));
    expect(within(sheet).getByText('Informe as gramas.')).toBeInTheDocument();
    await user.type(within(sheet).getByLabelText('Gramas de Arroz branco na Ceia'), '1,2,3');
    await user.click(within(sheet).getByRole('button', { name: 'Registrar' }));
    expect(within(sheet).getByText('Use um número (aceita vírgula).')).toBeInTheDocument();
    expect(await db.foodLogs.count()).toBe(0);
  });

  it('unit buttons fill the grams of a food with a unit', async () => {
    const user = userEvent.setup();
    await saveFood(input('Pão de forma', 'carboidrato', [250, 9, 47, 3.5], { unit: { name: 'fatia', grams: 25 } }));
    renderAt('/corpo/nutricao', <NutritionScreen />);
    await user.click(await screen.findByRole('button', { name: 'Adicionar o que comi no Café da manhã' }));
    const sheet = await screen.findByRole('dialog', { name: 'O que comi: Café da manhã' });
    await user.click(within(sheet).getByRole('button', { name: /^Pão de forma/ }));
    await user.click(within(sheet).getByRole('button', { name: '2 fatias' }));
    expect(within(sheet).getByLabelText('Gramas de Pão de forma no Café da manhã')).toHaveValue('50');
    await user.click(within(sheet).getByRole('button', { name: 'Registrar' }));
    await waitFor(async () => expect((await liveLogs())[0]).toMatchObject({ meal: 'cafe', grams: 50 }));
  });

  it('a planned item: "Comi" with the grams changed first, and "Tirar" with Desfazer', async () => {
    const user = userEvent.setup();
    await setTarget();
    const rice = await arroz();
    const chicken = await saveFood(input('Peito de frango', 'proteina', [165, 31, 0, 3.6]));
    const riceLog = await planned('almoco', rice, 150);
    const chickenLog = await planned('jantar', chicken, 120);
    renderAt('/corpo/nutricao', <NutritionScreen />);
    const grams = await screen.findByLabelText('Gramas de Arroz branco no Almoço');
    expect(grams).toHaveValue('150');
    expect(within(region('Almoço')).getByText('Sugestão: 150 g · 195 kcal · P 4 · C 42 · G 0')).toBeInTheDocument();
    await user.clear(grams);
    await user.type(grams, '120');
    await user.click(screen.getByRole('button', { name: 'Comi Arroz branco no Almoço' }));
    await waitFor(async () => expect(await db.foodLogs.get(riceLog.id)).toMatchObject({ status: 'comido', grams: 120 }));
    expect(await within(region('Almoço')).findByRole('button', { name: /^Corrigir gramas de Arroz branco no Almoço/ })).toBeInTheDocument();
    expect(within(region('Almoço')).queryByRole('button', { name: 'Comi Arroz branco no Almoço' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tirar Peito de frango do Jantar' }));
    await waitFor(() => expect(screen.queryByLabelText('Gramas de Peito de frango no Jantar')).not.toBeInTheDocument());
    expect((await db.foodLogs.get(chickenLog.id))!.deleted).toBe(true);
    expect(screen.getByText('Item tirado do plano.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(await screen.findByLabelText('Gramas de Peito de frango no Jantar')).toBeInTheDocument();
  });

  it('an eaten item: tap to correct the grams; "Apagar" with Desfazer gives the stock back and takes it again', async () => {
    const user = userEvent.setup();
    const rice = await arroz();
    await confirmPantry(rice.id, 500);
    const log = await logEaten({ meal: 'almoco', foodId: rice.id, grams: 150 });
    renderAt('/corpo/nutricao', <NutritionScreen />);
    await user.click(await screen.findByRole('button', { name: /^Corrigir gramas de Arroz branco no Almoço/ }));
    const field = screen.getByLabelText('Gramas comidas de Arroz branco no Almoço');
    expect(field).toHaveValue('150');
    await user.clear(field);
    await user.type(field, '200');
    await user.click(screen.getByRole('button', { name: 'Salvar gramas de Arroz branco no Almoço' }));
    await waitFor(async () => expect((await db.foodLogs.get(log.id))!.grams).toBe(200));
    expect(await screen.findByRole('button', { name: /^Corrigir gramas de Arroz branco no Almoço/ })).toHaveFocus();
    expect((await db.pantry.get(`pantry-${rice.id}`))!.grams).toBe(300);

    await user.click(screen.getByRole('button', { name: 'Apagar Arroz branco do Almoço' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Corrigir gramas de Arroz branco no Almoço/ })).not.toBeInTheDocument());
    expect(screen.getByText('Item apagado.')).toBeInTheDocument();
    expect((await db.pantry.get(`pantry-${rice.id}`))!.grams).toBe(500);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Almoço' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(await screen.findByRole('button', { name: /^Corrigir gramas de Arroz branco no Almoço/ })).toBeInTheDocument();
    await waitFor(async () => expect((await db.pantry.get(`pantry-${rice.id}`))!.grams).toBe(300));
  });
});

describe('/corpo/nutricao: montar o resto do dia', () => {
  async function stockedDay() {
    const f = {
      frango: await saveFood(input('Peito de frango', 'proteina', [165, 31, 0, 3.6], { like: 'gosto', meals: ['almoco', 'jantar'] })),
      arroz: await saveFood(input('Arroz branco', 'carboidrato', [130, 2.7, 28, 0.3], { like: 'gosto', meals: ['almoco', 'jantar'] })),
      ovo: await saveFood(input('Ovo cozido', 'proteina', [155, 13, 1.1, 10.6], { unit: { name: 'ovo', grams: 50 } })),
      iogurte: await saveFood(input('Iogurte natural', 'laticinio', [61, 3.5, 4.7, 3.3])),
      pao: await saveFood(input('Pão de forma', 'carboidrato', [250, 9, 47, 3.5], { unit: { name: 'fatia', grams: 25 } })),
      banana: await saveFood(input('Banana', 'fruta', [89, 1.1, 23, 0.3], { unit: { name: 'unidade', grams: 80 } })),
      brocolis: await saveFood(input('Brócolis', 'verdura', [35, 2.4, 7, 0.4])),
      azeite: await saveFood(input('Azeite', 'gordura', [884, 0, 0, 100])),
    };
    for (const food of Object.values(f)) await confirmPantry(food.id);
    return f;
  }

  it('builds from the sheet: respects "Bom para", never touches eaten items, shows the plan and the training tags', async () => {
    const user = userEvent.setup();
    await setTarget();
    const f = await stockedDay();
    const eaten = await logEaten({ meal: 'cafe', foodId: f.pao.id, grams: 50 });
    renderAt('/corpo/nutricao', <NutritionScreen />);
    await user.click(await screen.findByRole('button', { name: 'Montar o resto do dia' }));
    const sheet = await screen.findByRole('dialog', { name: 'Montar o resto do dia' });
    expect(within(sheet).getByText('Refeições que faltam: Lanche da manhã, Almoço, Café da tarde, Jantar, Ceia.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByRole('button', { name: 'Sem treino' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(sheet).getByRole('button', { name: 'Treino hoje antes de Jantar' }));
    expect(within(sheet).getByText(/^Pré-treino: Café da tarde · pós-treino: Jantar\./)).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Montar' }));
    expect(await screen.findByText('Resto do dia montado.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const logs = await liveLogs();
    const plan = logs.filter((l) => l.status === 'planejado');
    expect(plan.length).toBeGreaterThan(0);
    for (const l of plan.filter((x) => x.foodId === f.frango.id || x.foodId === f.arroz.id)) expect(['almoco', 'jantar']).toContain(l.meal);
    expect(plan.some((l) => l.meal === 'almoco' && l.foodId === f.frango.id)).toBe(true);
    expect(plan.some((l) => l.meal === 'lanche')).toBe(true);
    expect(plan.some((l) => l.meal === 'cafe')).toBe(false);
    expect(await db.foodLogs.get(eaten.id)).toMatchObject({ status: 'comido', grams: 50, deleted: false, meal: 'cafe' });
    expect(await getNutritionBuild()).toEqual({ day: DAY, hunger: 'normal', afterTraining: 'jantar' });

    const result = await screen.findByRole('region', { name: 'Plano do resto do dia' });
    expect(within(result).getByText(/^Planejado: [\d.]+ kcal · P \d+ · C \d+ · G \d+$/)).toBeInTheDocument();
    // what the line shows is the generator's result: within the tolerance for protein and carbohydrates
    const after = nutritionDay({ day: DAY, targets: await db.nutritionTargets.toArray(), logs }).afterPlan!;
    expect(Math.abs(after.protein)).toBeLessThanOrEqual(PLAN_TOLERANCE.protein);
    expect(Math.abs(after.carbs)).toBeLessThanOrEqual(PLAN_TOLERANCE.carbs);
    expect(within(result).getByText(/^Depois do plano: /)).toBeInTheDocument();
    expect(within(result).queryByText(/da meta de (proteína|carboidratos)/)).not.toBeInTheDocument();
    expect(within(region('Café da tarde')).getByText('pré-treino')).toBeInTheDocument();
    expect(within(region('Jantar')).getByText('pós-treino')).toBeInTheDocument();
    expect(within(region('Almoço')).getByLabelText('Gramas de Peito de frango no Almoço')).toBeInTheDocument();
    expect(within(region('Lanche da manhã')).queryByLabelText(/Peito de frango|Arroz branco/)).not.toBeInTheDocument();

    // building again keeps the eaten item and the last choices
    await user.click(screen.getByRole('button', { name: 'Montar o resto do dia' }));
    const again = await screen.findByRole('dialog', { name: 'Montar o resto do dia' });
    expect(within(again).getByRole('button', { name: 'Treino hoje antes de Jantar' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(again).getByRole('button', { name: 'Muita' }));
    await user.click(within(again).getByRole('button', { name: 'Montar' }));
    await waitFor(async () => expect((await getNutritionBuild())!.hunger).toBe('muita'));
    expect(await db.foodLogs.get(eaten.id)).toMatchObject({ status: 'comido', grams: 50, deleted: false });
  });

  it('training before the first meal of the day can be chosen: breakfast becomes pós-treino', async () => {
    const user = userEvent.setup();
    await setTarget();
    await stockedDay();
    renderAt('/corpo/nutricao', <NutritionScreen />);
    await user.click(await screen.findByRole('button', { name: 'Montar o resto do dia' }));
    const sheet = await screen.findByRole('dialog', { name: 'Montar o resto do dia' });
    await user.click(within(sheet).getByRole('button', { name: 'Treino hoje antes de Café da manhã' }));
    expect(within(sheet).getByText('Pós-treino: Café da manhã. As que ainda faltam recebem mais carboidrato.')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Montar' }));
    expect(await within(region('Café da manhã')).findByText('pós-treino')).toBeInTheDocument();
    expect(screen.queryByText('pré-treino')).not.toBeInTheDocument();
    expect(await getNutritionBuild()).toEqual({ day: DAY, hunger: 'normal', afterTraining: 'cafe' });
  });

  it('a build that plans nothing says so and shows what is missing (the old plan is gone)', async () => {
    const user = userEvent.setup();
    await setTarget();
    // every food is good only for breakfast, and breakfast was eaten
    const yogurt = await saveFood(input('Iogurte natural', 'laticinio', [61, 3.5, 4.7, 3.3], { meals: ['cafe'] }));
    const bread = await saveFood(input('Pão de forma', 'carboidrato', [250, 9, 47, 3.5], { meals: ['cafe'] }));
    for (const f of [yogurt, bread]) await confirmPantry(f.id);
    await logEaten({ meal: 'cafe', foodId: bread.id, grams: 50 });
    const old = await planned('jantar', yogurt, 170);
    renderAt('/corpo/nutricao', <NutritionScreen />);
    await user.click(await screen.findByRole('button', { name: 'Montar o resto do dia' }));
    const sheet = await screen.findByRole('dialog', { name: 'Montar o resto do dia' });
    await user.click(within(sheet).getByRole('button', { name: 'Montar' }));
    expect(await screen.findByText('Nada do estoque coube nas refeições que faltam.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await db.foodLogs.get(old.id))!.deleted).toBe(true);
    const result = await screen.findByRole('region', { name: 'Plano do resto do dia' });
    expect(within(result).getByText('Planejado: 0 kcal · P 0 · C 0 · G 0')).toBeInTheDocument();
    expect(within(result).getByText(/^Faltam \d+ g de proteína\./)).toBeInTheDocument();
    expect(within(result).getByText(/^Faltam \d+ g de carboidratos\./)).toBeInTheDocument();
  });

  it('a planned item is compact: name, suggestion, then the grams (no visible label), "Comi" and "Tirar" in one row', async () => {
    await setTarget();
    const rice = await saveFood(input('Arroz branco cozido', 'carboidrato', [130, 2.7, 28, 0.3]));
    await planned('almoco', rice, 150);
    renderAt('/corpo/nutricao', <NutritionScreen />);
    const grams = await screen.findByRole('textbox', { name: 'Gramas de Arroz branco cozido no Almoço' });
    const item = grams.closest('li')!;
    expect(item.querySelector('.nutri-item__name')).toHaveTextContent('Arroz branco cozido');
    expect(item.querySelector('.nutri-item__meta')).toHaveTextContent('Sugestão: 150 g · 195 kcal · P 4 · C 42 · G 0');
    const row = grams.closest('form')!;
    expect(row).toHaveClass('nutri-item__form--row');
    expect(within(row).getByRole('button', { name: 'Comi Arroz branco cozido no Almoço' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Tirar Arroz branco cozido do Almoço' })).toBeInTheDocument();
    // the label is there for screen readers only
    expect(row.querySelector('label')).toHaveClass('visually-hidden');
    expect(row.querySelector('.field__label')).toBeNull();
  });

  it('without stock confirmed today it explains and leads to the stock', async () => {
    const user = userEvent.setup();
    await setTarget();
    const rice = await arroz();
    await put('pantry', newRecord<PantryItem>({ id: `pantry-${rice.id}`, foodId: rice.id, confirmedDay: '2026-11-24', grams: 300 }));
    renderAt('/corpo/nutricao', <NutritionScreen />);
    await user.click(await screen.findByRole('button', { name: 'Montar o resto do dia' }));
    const sheet = await screen.findByRole('dialog', { name: 'Montar o resto do dia' });
    expect(within(sheet).getByText('Confirme o estoque de hoje primeiro.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Montar' })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Ir para o estoque de hoje' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Estoque de hoje' })).toHaveFocus());
    expect(await db.foodLogs.count()).toBe(0);
  });

  it('without a target: the screens work, no "falta", and the build leads to Metas', async () => {
    const user = userEvent.setup();
    const rice = await arroz();
    await logEaten({ meal: 'almoco', foodId: rice.id, grams: 100 });
    renderAt('/corpo/nutricao', <NutritionScreen />);
    expect(await within(await screen.findByRole('region', { name: 'Hoje' })).findByText('Comido: 130 kcal · P 3 · C 28 · G 0')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/falta \d/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Montar o resto do dia' }));
    const sheet = await screen.findByRole('dialog', { name: 'Montar o resto do dia' });
    expect(within(sheet).getByText('Defina as metas primeiro.')).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Definir metas' })).toHaveAttribute('href', '/corpo/nutricao/metas');
  });

  it('with no food yet, it explains and links to "Novo alimento"', async () => {
    const user = userEvent.setup();
    renderAt('/corpo/nutricao', <NutritionScreen />);
    expect(await within(await screen.findByRole('region', { name: 'Estoque de hoje' })).findByRole('link', { name: 'Novo alimento' }))
      .toHaveAttribute('href', '/corpo/nutricao/alimentos?novo=alimento');
    await user.click(screen.getByRole('button', { name: 'Adicionar o que comi no Jantar' }));
    const sheet = await screen.findByRole('dialog', { name: 'O que comi: Jantar' });
    expect(within(sheet).getByText(/Nenhum alimento cadastrado ainda/)).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Novo alimento' })).toHaveAttribute('href', '/corpo/nutricao/alimentos?novo=alimento');
  });
});

describe('/corpo/nutricao: estoque de hoje', () => {
  it('yesterday\'s item shows "Tinha em" and "Confirmar" (with optional grams); "Adicionar ao estoque" uses the picker', async () => {
    const user = userEvent.setup();
    const rice = await arroz();
    const beans = await saveFood(input('Feijão', 'carboidrato', [76, 4.8, 13.6, 0.5], { basis: 'cru' }));
    await put('pantry', newRecord<PantryItem>({ id: `pantry-${rice.id}`, foodId: rice.id, confirmedDay: '2026-11-24', grams: 300 }));
    renderAt('/corpo/nutricao', <NutritionScreen />);
    const stock = await screen.findByRole('region', { name: 'Estoque de hoje' });
    expect(await within(stock).findByText('Tinha em 24/11')).toBeInTheDocument();
    await user.type(within(stock).getByLabelText('Gramas de Arroz branco no estoque'), '250');
    await user.click(within(stock).getByRole('button', { name: 'Confirmar Arroz branco: tem hoje' }));
    expect(await within(stock).findByText('Tem hoje · 250 g')).toBeInTheDocument();
    expect(await db.pantry.get(`pantry-${rice.id}`)).toMatchObject({ confirmedDay: DAY, grams: 250 });

    await user.click(within(stock).getByRole('button', { name: 'Adicionar ao estoque' }));
    const sheet = await screen.findByRole('dialog', { name: 'Adicionar ao estoque' });
    await user.click(within(sheet).getByRole('button', { name: /^Feijão/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Adicionar' }));
    expect(await screen.findByText('Feijão está no estoque de hoje.')).toBeInTheDocument();
    expect(await within(stock).findByText('Tem hoje')).toBeInTheDocument();
    expect(await db.pantry.get(`pantry-${beans.id}`)).toMatchObject({ confirmedDay: DAY });
    expect(await db.pantry.get(`pantry-${beans.id}`)).not.toHaveProperty('grams');

    await user.click(within(stock).getByRole('button', { name: 'Corrigir gramas de Feijão no estoque' }));
    await user.type(within(stock).getByLabelText('Gramas de Feijão no estoque'), '400');
    await user.click(within(stock).getByRole('button', { name: 'Salvar gramas de Feijão no estoque' }));
    expect(await within(stock).findByText('Tem hoje · 400 g (cru)')).toBeInTheDocument();

    // the screen writes thousands with a dot; typing them back the same way keeps the number
    await user.click(within(stock).getByRole('button', { name: 'Corrigir gramas de Feijão no estoque' }));
    const field = within(stock).getByLabelText('Gramas de Feijão no estoque');
    await user.clear(field);
    await user.type(field, '1.500');
    await user.click(within(stock).getByRole('button', { name: 'Salvar gramas de Feijão no estoque' }));
    expect(await within(stock).findByText('Tem hoje · 1.500 g (cru)')).toBeInTheDocument();
    expect((await db.pantry.get(`pantry-${beans.id}`))!.grams).toBe(1500);

    await user.click(within(stock).getByRole('button', { name: 'Tirar Feijão do estoque' }));
    await waitFor(() => expect(within(stock).queryByText('Feijão')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(await within(stock).findByText('Tem hoje · 1.500 g (cru)')).toBeInTheDocument();
  });
});

describe('/corpo/nutricao/alimentos', () => {
  it('the food form shows each problem in its field and saves nothing; then saves with "Bom para"', async () => {
    const user = userEvent.setup();
    renderAt('/corpo/nutricao/alimentos', <FoodsScreen />);
    expect(await screen.findByText(/Nenhum alimento ainda/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Novo alimento' }));
    const sheet = await screen.findByRole('dialog', { name: 'Novo alimento' });
    await user.type(within(sheet).getByLabelText('Calorias (kcal)'), '950');
    await user.type(within(sheet).getByLabelText('Proteína (g)'), '120');
    await user.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    expect(within(sheet).getByText('Dê um nome.')).toBeInTheDocument();
    expect(within(sheet).getByText('No máximo 900 kcal por 100 g.')).toBeInTheDocument();
    expect(within(sheet).getByText('No máximo 100 g por 100 g.')).toBeInTheDocument();
    expect(within(sheet).getAllByText('Preencha este campo.')).toHaveLength(2); // carbs and fat
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Confira os campos marcados.');
    expect(within(sheet).getByLabelText('Calorias (kcal)')).toHaveAttribute('aria-invalid', 'true');
    expect(await db.foods.count()).toBe(0);

    await user.type(within(sheet).getByLabelText('Nome'), 'Iogurte grego');
    for (const [label, v] of [['Calorias (kcal)', '120'], ['Proteína (g)', '10,5'], ['Carboidratos (g)', '4'], ['Gorduras (g)', '7']] as const) {
      await user.clear(within(sheet).getByLabelText(label));
      await user.type(within(sheet).getByLabelText(label), v);
    }
    expect(within(sheet).queryByText('Dê um nome.')).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Laticínio' }));
    await user.click(within(sheet).getByRole('button', { name: 'Bom para Café da manhã' }));
    await user.click(within(sheet).getByRole('button', { name: 'Bom para Ceia' }));
    expect(within(sheet).getByRole('button', { name: 'Bom para Ceia' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Alimento cadastrado.')).toBeInTheDocument();
    const [food] = await db.foods.toArray();
    expect(food).toMatchObject({ name: 'Iogurte grego', group: 'laticinio', per100: { kcal: 120, protein: 10.5, carbs: 4, fat: 7 }, meals: ['cafe', 'ceia'] });
    const row = await screen.findByRole('button', { name: /^Iogurte grego/ });
    expect(row).toHaveTextContent('Bom para: Café da manhã, Ceia');
    expect(row).toHaveTextContent('Por 100 g: 120 kcal · P 11 · C 4 · G 7');
  });

  it('warns (without blocking) when kcal do not match the macros; editing clears "Bom para"; deleting keeps the diary', async () => {
    const user = userEvent.setup();
    const food = await saveFood(input('Granola', 'carboidrato', [400, 10, 60, 12], { meals: ['cafe'] }));
    const log = await logEaten({ meal: 'cafe', foodId: food.id, grams: 40 });
    renderAt('/corpo/nutricao/alimentos', <FoodsScreen />);
    await user.click(await screen.findByRole('button', { name: /^Granola/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Editar alimento' });
    await user.clear(within(sheet).getByLabelText('Calorias (kcal)'));
    await user.type(within(sheet).getByLabelText('Calorias (kcal)'), '200');
    expect(within(sheet).getByText('As calorias não batem com os macros: pela soma dariam 388 kcal. Confira os valores.')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Bom para Café da manhã' }));
    await user.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Alimento salvo.')).toBeInTheDocument();
    const saved = (await db.foods.get(food.id))!;
    expect(saved.per100.kcal).toBe(200);
    expect(saved).not.toHaveProperty('meals');

    await user.click(await screen.findByRole('button', { name: /^Granola/ }));
    const again = await screen.findByRole('dialog', { name: 'Editar alimento' });
    expect(within(again).getByText(/Apagar não muda o diário/)).toBeInTheDocument();
    await user.click(within(again).getByRole('button', { name: 'Apagar alimento' }));
    expect(await screen.findByText('Alimento apagado. O diário não muda.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Granola/ })).not.toBeInTheDocument());
    expect(await db.foodLogs.get(log.id)).toMatchObject({ name: 'Granola', per100: { kcal: 400 }, deleted: false });
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(await screen.findByRole('button', { name: /^Granola/ })).toBeInTheDocument();
  });

  it('the recipe form computes the values per 100 g, notes the missing cooking fat and validates', async () => {
    const user = userEvent.setup();
    await saveFood(input('Aveia', 'carboidrato', [380, 14, 66, 7]));
    await saveFood(input('Leite', 'laticinio', [60, 3, 5, 3]));
    renderAt('/corpo/nutricao/alimentos', <FoodsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Nova receita' }));
    const sheet = await screen.findByRole('dialog', { name: 'Nova receita' });
    await user.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    expect(within(sheet).getByText('Dê um nome.')).toBeInTheDocument();
    expect(within(sheet).getByText('Inclua pelo menos um ingrediente.')).toBeInTheDocument();
    expect(within(sheet).getByText('Informe o rendimento final em gramas.')).toBeInTheDocument();
    expect(await db.foods.count()).toBe(2);

    await user.type(within(sheet).getByLabelText('Nome'), 'Mingau');
    await user.click(within(sheet).getByRole('button', { name: 'Adicionar ingrediente' }));
    await user.click(within(sheet).getByRole('button', { name: /^Aveia/ }));
    expect(within(sheet).getByLabelText('Gramas de Aveia na receita')).toHaveFocus();
    await user.type(within(sheet).getByLabelText('Gramas de Aveia na receita'), '50');
    await user.click(within(sheet).getByRole('button', { name: 'Adicionar ingrediente' }));
    await user.click(within(sheet).getByRole('button', { name: /^Leite/ }));
    await user.type(within(sheet).getByLabelText('Gramas de Leite na receita'), '200');
    await user.type(within(sheet).getByLabelText('Rendimento final (g, pesado depois de pronto)'), '250');
    expect(within(sheet).getByText('Por 100 g (calculado): 124 kcal · P 5 · C 17 · G 4')).toBeInTheDocument();
    expect(within(sheet).getByText(NO_FAT_NOTE)).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Bom para Café da manhã' }));
    await user.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Receita cadastrada.')).toBeInTheDocument();
    const recipe = (await db.foods.toArray()).find((f) => f.name === 'Mingau')!;
    expect(recipe).toMatchObject({ basis: 'pronto', meals: ['cafe'], recipe: { yieldGrams: 250 } });
    expect(recipe.per100.kcal).toBeCloseTo(124, 6);
    expect(recipe.recipe!.ingredients.map((i) => i.grams)).toEqual([50, 200]);
    const row = await screen.findByRole('button', { name: /^Mingau/ });
    expect(row).toHaveTextContent('receita');
  });

  it('"?novo=alimento" opens the form right away', async () => {
    renderAt('/corpo/nutricao/alimentos?novo=alimento', <FoodsScreen />);
    expect(await screen.findByRole('dialog', { name: 'Novo alimento' })).toBeInTheDocument();
  });
});

describe('/corpo/nutricao/metas', () => {
  it('saves the targets from today with the computed kcal, keeping the history', async () => {
    const user = userEvent.setup();
    await put('nutritionTargets', newRecord<NutritionTarget>({
      id: nutritionTargetId('2026-11-11'), from: '2026-11-11', byWeekday: weekTargets({ protein: 150, carbs: 240, fat: 65 }, { protein: 150, carbs: 240, fat: 65 }),
    }));
    renderAt('/corpo/nutricao/metas', <NutritionTargetsScreen />);
    const wdProtein = await screen.findByLabelText('Proteína (g), segunda a sexta');
    expect(wdProtein).toHaveValue('150');
    expect(screen.getAllByText('Calorias: 2.145 kcal')).toHaveLength(2);
    const fill = async (label: string, v: string) => { await user.clear(screen.getByLabelText(label)); if (v) await user.type(screen.getByLabelText(label), v); };
    await fill('Proteína (g), segunda a sexta', '160');
    await fill('Carboidratos (g), segunda a sexta', '250');
    await fill('Gorduras (g), segunda a sexta', '60');
    expect(screen.getByText('Calorias: 2.180 kcal')).toBeInTheDocument();
    await fill('Proteína (g), sábado e domingo', '');
    expect(screen.getByText('Calorias: —')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar metas' }));
    expect(screen.getByText('Preencha este campo.')).toBeInTheDocument();
    expect(await db.nutritionTargets.count()).toBe(1);
    await fill('Proteína (g), sábado e domingo', '140');
    await fill('Carboidratos (g), sábado e domingo', '200');
    await fill('Gorduras (g), sábado e domingo', '70');
    expect(screen.getByText('Calorias: 1.990 kcal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar metas' }));
    expect(await screen.findByText('Metas salvas. Valem a partir de hoje.')).toBeInTheDocument();
    const history = await screen.findByRole('list', { name: 'Histórico das metas' });
    await waitFor(() => expect(within(history).getAllByRole('listitem')).toHaveLength(2));
    expect(within(history).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Desde 25/11: seg a sex P 160 · C 250 · G 60 · 2.180 kcal; sáb e dom P 140 · C 200 · G 70 · 1.990 kcal',
      'Desde 11/11: P 150 · C 240 · G 65 · 2.145 kcal',
    ]);
    expect((await db.nutritionTargets.get(nutritionTargetId(DAY)))!.byWeekday[0]).toEqual({ protein: 140, carbs: 200, fat: 70 });
  });

  it('targets that arrive after the screen opened (first sync) fill the untouched form; typed values are kept', async () => {
    const user = userEvent.setup();
    renderAt('/corpo/nutricao/metas', <NutritionTargetsScreen />);
    const wdProtein = await screen.findByLabelText('Proteína (g), segunda a sexta');
    expect(wdProtein).toHaveValue('');
    expect(screen.getAllByText('Calorias: —')).toHaveLength(2);
    // the first pull brings the target saved on another device
    const synced = await put('nutritionTargets', newRecord<NutritionTarget>({
      id: nutritionTargetId('2026-11-11'), from: '2026-11-11', byWeekday: weekTargets({ protein: 150, carbs: 240, fat: 65 }, { protein: 150, carbs: 240, fat: 65 }),
    }));
    await waitFor(() => expect(screen.getByLabelText('Proteína (g), segunda a sexta')).toHaveValue('150'));
    expect(screen.getAllByText('Calorias: 2.145 kcal')).toHaveLength(2);
    // once something is typed, a newer version of the record does not overwrite it
    await user.clear(screen.getByLabelText('Proteína (g), sábado e domingo'));
    await user.type(screen.getByLabelText('Proteína (g), sábado e domingo'), '140');
    await put('nutritionTargets', { ...synced, byWeekday: weekTargets({ protein: 155, carbs: 240, fat: 65 }, { protein: 155, carbs: 240, fat: 65 }) });
    await waitFor(async () => expect(within(await screen.findByRole('list', { name: 'Histórico das metas' })).getByText(/P 155/)).toBeInTheDocument());
    expect(screen.getByLabelText('Proteína (g), sábado e domingo')).toHaveValue('140');
    expect(screen.getByLabelText('Proteína (g), segunda a sexta')).toHaveValue('150');
  });

  it('switches meals on and off; the last one stays on', async () => {
    const user = userEvent.setup();
    renderAt('/corpo/nutricao/metas', <NutritionTargetsScreen />);
    const meals = await screen.findByRole('group', { name: 'Refeições ligadas' });
    const ceia = within(meals).getByRole('button', { name: 'Ceia' });
    expect(ceia).toHaveAttribute('aria-pressed', 'true');
    await user.click(ceia);
    await waitFor(() => expect(within(meals).getByRole('button', { name: 'Ceia' })).toHaveAttribute('aria-pressed', 'false'));
    expect((await db.settings.get('settings'))!.nutrition!.meals).toEqual(['cafe', 'lanche', 'almoco', 'tarde', 'jantar']);
    for (const m of ['cafe', 'lanche', 'tarde', 'jantar'] as const) await setMealOn(m, false);
    await waitFor(() => expect(within(meals).getByRole('button', { name: 'Café da manhã' })).toHaveAttribute('aria-pressed', 'false'));
    await user.click(within(meals).getByRole('button', { name: 'Almoço' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Deixe pelo menos uma refeição ligada.');
    expect((await db.settings.get('settings'))!.nutrition!.meals).toEqual(['almoco']);
  });

  it('the meals switched off leave the Nutrição screen', async () => {
    await setMealOn('lanche', false);
    await setMealOn('ceia', false);
    renderAt('/corpo/nutricao', <NutritionScreen />);
    expect(await screen.findByRole('heading', { name: 'Almoço' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Lanche da manhã' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ceia' })).not.toBeInTheDocument();
  });

  it('registers weigh-ins (never changing the targets), lists them with the average and the note, and deletes with Desfazer', async () => {
    const user = userEvent.setup();
    await setTarget();
    renderAt('/corpo/nutricao/metas', <NutritionTargetsScreen />);
    expect(await screen.findByText(WEIGH_IN_NOTE)).toBeInTheDocument();
    const kg = screen.getByLabelText('Peso (kg)');
    await user.type(kg, '25');
    await user.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(screen.getByText('Peso entre 30 e 300 kg.')).toBeInTheDocument();
    await user.clear(kg);
    await user.type(kg, '72,4');
    await user.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByText('Pesagem registrada.')).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Últimas pesagens' });
    expect(within(list).getByText('25/11 · 72,4 kg')).toBeInTheDocument();
    expect(screen.getByText('72,4 kg em 25/11')).toBeInTheDocument();
    expect(screen.getByText('Média de 1 dia com pesagem')).toBeInTheDocument();
    expect(kg).toHaveValue('');
    const targets = await db.nutritionTargets.toArray();
    expect(targets).toHaveLength(1);
    expect(targets[0]!.byWeekday[3]).toEqual(TARGET);

    await user.click(within(list).getByRole('button', { name: 'Apagar a pesagem de 25/11, 72,4 kg' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Últimas pesagens' })).not.toBeInTheDocument());
    expect(screen.getByText(WEIGH_IN_NOTE)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(await screen.findByText('25/11 · 72,4 kg')).toBeInTheDocument();
  });
});
