import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { finishPrep, saveRecipe, setMenuSlot, toggleShoppingItem } from '../src/domain/mealActions';
import { useMissionSheet } from '../src/features/mission/MissionSheet';
import { PlanScreen } from '../src/features/plan/PlanScreen';
import { ToastHost, useToast } from '../src/ui/Toast';

const at = (d: number, h: number, m = 0): Date => new Date(2026, 10, d, h, m);
const WEEK = '2026-11-09';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(13, 15));
  localStorage.clear();
  await db.delete(); await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
  useMissionSheet.setState({ openId: undefined });
});
afterEach(() => { vi.useRealTimers(); });

function renderCasa() {
  const { hook } = memoryLocation({ path: '/planejar?aba=casa' });
  return render(<Router hook={hook}><PlanScreen /><ToastHost /></Router>);
}
const toastText = () => screen.getByRole('status');
const section = (name: string) => screen.findByRole('region', { name });

describe('Planejar → Casa', () => {
  it('?aba=casa opens the tab on this week; the arrows change the week', async () => {
    const user = userEvent.setup();
    renderCasa();
    expect(await screen.findByRole('tab', { name: 'Casa', selected: true })).toBeInTheDocument();
    expect(await screen.findByText('Esta semana · 09–15/11')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Próxima semana' }));
    expect(screen.getByText('Próxima semana · 16–22/11')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Semana anterior' }));
    await user.click(screen.getByRole('button', { name: 'Semana anterior' }));
    expect(screen.getByText('Semana de 02–08/11')).toBeInTheDocument();
  });

  it('on the weekend it opens on next week', async () => {
    vi.setSystemTime(at(14, 10));
    renderCasa();
    expect(await screen.findByText('Próxima semana · 16–22/11')).toBeInTheDocument();
  });

  it('picks dishes: creates by name, reuses a recipe, Enter creates, and clears a meal', async () => {
    const user = userEvent.setup();
    renderCasa();
    await user.click(await screen.findByRole('button', { name: 'Escolher almoço de seg 09/11' }));
    let sheet = await screen.findByRole('dialog', { name: 'Almoço de seg 09/11' });
    await user.type(within(sheet).getByLabelText('Prato'), 'Frango com arroz');
    await user.click(within(sheet).getByRole('button', { name: 'Criar “Frango com arroz”' }));
    expect(await screen.findByRole('button', { name: 'Almoço de seg 09/11: Frango com arroz' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Focus never falls back to <body> after the dish is placed.
    await waitFor(() => expect(document.activeElement).not.toBe(document.body), { timeout: 3000 });

    await user.click(screen.getByRole('button', { name: 'Escolher jantar de ter 10/11' }));
    sheet = await screen.findByRole('dialog', { name: 'Jantar de ter 10/11' });
    await user.type(within(sheet).getByLabelText('Prato'), 'frango');
    await user.click(within(sheet).getByRole('button', { name: 'Frango com arroz' }));
    expect(await screen.findByRole('button', { name: 'Jantar de ter 10/11: Frango com arroz' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Escolher almoço de qua 11/11' }));
    sheet = await screen.findByRole('dialog', { name: 'Almoço de qua 11/11' });
    await user.type(within(sheet).getByLabelText('Prato'), 'Omelete{Enter}');
    expect(await screen.findByRole('button', { name: 'Almoço de qua 11/11: Omelete' })).toBeInTheDocument();
    expect((await db.recipes.toArray()).map((r) => r.name).sort()).toEqual(['Frango com arroz', 'Omelete']);

    await user.click(screen.getByRole('button', { name: 'Almoço de seg 09/11: Frango com arroz' }));
    sheet = await screen.findByRole('dialog', { name: 'Almoço de seg 09/11' });
    await user.click(within(sheet).getByRole('button', { name: 'Tirar do cardápio' }));
    expect(await screen.findByRole('button', { name: 'Escolher almoço de seg 09/11' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).not.toBe(document.body), { timeout: 3000 });
    expect(screen.getByRole('link', { name: 'Receitas (2)' })).toHaveAttribute('href', '/casa/receitas');
  });

  it('"Repetir a semana anterior" copies last week into an empty week', async () => {
    const user = userEvent.setup();
    const r = await saveRecipe({ name: 'Frango com arroz', ingredients: '' });
    await setMenuSlot('2026-11-02', '2026-11-03', 'almoco', r.id);
    renderCasa();
    await user.click(await screen.findByRole('button', { name: 'Repetir a semana anterior' }));
    await waitFor(() => expect(toastText()).toHaveTextContent('Cardápio copiado: 1 refeição.'));
    expect(await screen.findByRole('button', { name: 'Almoço de ter 10/11: Frango com arroz' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).not.toBe(document.body), { timeout: 3000 });
  });

  it('summarises the shopping list and links to it', async () => {
    const r = await saveRecipe({ name: 'Frango com arroz', ingredients: 'frango\narroz' });
    await setMenuSlot(WEEK, '2026-11-10', 'almoco', r.id);
    await toggleShoppingItem(WEEK, 'g:arroz');
    renderCasa();
    const compras = await section('Compras');
    expect(await within(compras).findByText('2 itens · 1 no carrinho')).toBeInTheDocument();
    expect(within(compras).getByRole('link', { name: 'Abrir lista de compras' })).toHaveAttribute('href', '/casa/compras?semana=2026-11-09');
  });
});

describe('Casa → freezer e preparo', () => {
  it('prep sheet: a typed 45 shows 30 on blur, and adding the last dish focuses its portions field', async () => {
    const user = userEvent.setup();
    const r = await saveRecipe({ name: 'Frango com arroz', ingredients: 'frango' });
    await saveRecipe({ name: 'Omelete', ingredients: 'ovos' });
    await setMenuSlot(WEEK, '2026-11-10', 'almoco', r.id);
    renderCasa();
    const freezer = await section('Freezer');
    await user.click(await within(freezer).findByRole('button', { name: 'Preparo em lote' }));
    const sheet = await screen.findByRole('dialog', { name: 'Preparo em lote' });
    const field = within(sheet).getByLabelText('Porções de Frango com arroz');
    expect(field).toHaveAttribute('type', 'number');
    await user.clear(field);
    await user.type(field, '45');
    await user.tab();
    expect(field).toHaveValue(30);
    await user.selectOptions(within(sheet).getByLabelText('Adicionar outro prato'), 'Omelete');
    await waitFor(() => expect(within(sheet).getByLabelText('Porções de Omelete')).toHaveFocus());
  });

  it('registers a batch prep, eats one, adjusts and suggests a prep when low', async () => {
    const user = userEvent.setup();
    const r = await saveRecipe({ name: 'Frango com arroz', ingredients: 'frango' });
    await saveRecipe({ name: 'Omelete', ingredients: 'ovos' });
    await setMenuSlot(WEEK, '2026-11-10', 'almoco', r.id);
    await setMenuSlot(WEEK, '2026-11-11', 'almoco', r.id);
    renderCasa();
    const freezer = await section('Freezer');
    expect(await within(freezer).findByText('Freezer vazio. Depois de um preparo em lote, as porções aparecem aqui.')).toBeInTheDocument();

    await user.click(within(freezer).getByRole('button', { name: 'Preparo em lote' }));
    const sheet = await screen.findByRole('dialog', { name: 'Preparo em lote' });
    expect(within(sheet).getByText('2 no cardápio · 0 no freezer')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Terminei o preparo' })).toBeDisabled();
    await user.click(within(sheet).getByRole('button', { name: 'Mais uma porção de Frango com arroz' }));
    await user.click(within(sheet).getByRole('button', { name: 'Mais uma porção de Frango com arroz' }));
    expect(within(sheet).getByLabelText('Porções de Frango com arroz')).toHaveValue(2);
    await user.clear(within(sheet).getByLabelText('Porções de Frango com arroz'));
    await user.type(within(sheet).getByLabelText('Porções de Frango com arroz'), '8');
    await user.selectOptions(within(sheet).getByLabelText('Adicionar outro prato'), 'Omelete');
    expect(within(sheet).getByText('0 no freezer')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Terminei o preparo' }));
    await waitFor(() => expect(toastText()).toHaveTextContent('Preparo registrado: +8 marmitas · +10 XP'));
    expect(await within(freezer).findByText('8 marmitas')).toBeInTheDocument();

    await user.click(within(freezer).getByRole('button', { name: 'Comi uma: Frango com arroz' }));
    await waitFor(() => expect(toastText()).toHaveTextContent('Bom proveito. No freezer: 7 marmitas.'));

    await user.click(within(freezer).getByRole('button', { name: 'Ajustar porções: Frango com arroz' }));
    const fix = await screen.findByRole('dialog', { name: 'Ajustar: Frango com arroz' });
    await waitFor(() => expect(within(fix).getByLabelText('Porções no freezer')).toHaveValue(7));
    await user.clear(within(fix).getByLabelText('Porções no freezer'));
    await user.type(within(fix).getByLabelText('Porções no freezer'), '2');
    await user.click(within(fix).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(toastText()).toHaveTextContent('Freezer ajustado.'));

    expect(await within(freezer).findByText('Restam 2 marmitas. Que tal marcar um preparo em lote?')).toBeInTheDocument();
    await user.click(within(freezer).getByRole('button', { name: 'Marcar preparo' }));
    await waitFor(() => expect(useMissionSheet.getState().openId).toBe('prep-2026-11-09'));
    expect(await within(freezer).findByText('Preparo marcado, ainda sem dia.')).toBeInTheDocument();
    expect(within(freezer).getByRole('button', { name: 'Ver missão' })).toBeInTheDocument();
  });

  it('a freezer that was never filled by a prep does not suggest anything', async () => {
    const r = await saveRecipe({ name: 'Sopa', ingredients: '' });
    await finishPrep([]);
    await db.freezerMoves.put({ id: 'f1', createdAt: 1, updatedAt: 1, deleted: false, at: 1, day: '2026-11-13', recipeId: r.id, delta: 1, kind: 'fix' });
    renderCasa();
    const freezer = await section('Freezer');
    expect(await within(freezer).findByText('1 marmita')).toBeInTheDocument();
    expect(within(freezer).queryByRole('button', { name: 'Marcar preparo' })).not.toBeInTheDocument();
  });

  it('eating the last portion of a dish keeps focus inside the page', async () => {
    const user = userEvent.setup();
    const r = await saveRecipe({ name: 'Sopa', ingredients: '' });
    await finishPrep([{ recipeId: r.id, portions: 1 }]);
    renderCasa();
    const freezer = await section('Freezer');
    await user.click(await within(freezer).findByRole('button', { name: 'Comi uma: Sopa' }));
    await waitFor(() => expect(within(freezer).queryByRole('button', { name: 'Comi uma: Sopa' })).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).not.toBe(document.body), { timeout: 3000 });
  });
});
