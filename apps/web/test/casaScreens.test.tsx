import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { saveRecipe, setMenuSlot } from '../src/domain/mealActions';
import { RecipesScreen } from '../src/features/casa/RecipesScreen';
import { ShoppingScreen } from '../src/features/casa/ShoppingScreen';
import { ToastHost, useToast } from '../src/ui/Toast';

const at = (d: number, h: number, m = 0): Date => new Date(2026, 10, d, h, m);
const WEEK = '2026-11-09';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(13, 15));
  await db.delete(); await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
});
afterEach(() => { vi.useRealTimers(); });

function renderAt(path: string, ui: React.ReactNode) {
  const { hook } = memoryLocation({ path });
  return render(<Router hook={hook}>{ui}<ToastHost /></Router>);
}
const toastText = () => screen.getByRole('status');

describe('Receitas', () => {
  it('creates, refuses a repeated name, searches, deletes and brings back', async () => {
    const user = userEvent.setup();
    renderAt('/casa/receitas', <RecipesScreen />);
    expect(await screen.findByText('Nenhuma receita ainda. Ao escolher um prato no cardápio, ele aparece aqui.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '‹ Casa' })).toHaveAttribute('href', '/planejar?aba=casa');

    await user.click(screen.getByRole('button', { name: 'Nova receita' }));
    let sheet = await screen.findByRole('dialog', { name: 'Nova receita' });
    await user.type(within(sheet).getByLabelText('Nome do prato'), 'Frango com arroz');
    await user.type(within(sheet).getByLabelText('Ingredientes (um por linha)'), 'frango 1 kg{Enter}arroz');
    await user.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    const list = await screen.findByRole('list', { name: 'Receitas' });
    expect(within(list).getByRole('button', { name: /Frango com arroz/ })).toHaveTextContent('2 ingredientes');

    await user.click(screen.getByRole('button', { name: 'Nova receita' }));
    sheet = await screen.findByRole('dialog', { name: 'Nova receita' });
    await user.type(within(sheet).getByLabelText('Nome do prato'), 'frango com ARROZ');
    await user.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Já existe uma receita com esse nome.');
    await user.keyboard('{Escape}');

    await user.type(screen.getByRole('searchbox', { name: 'Buscar receita' }), 'xyz');
    expect(await screen.findByText('Nada encontrado.')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Buscar receita' }));

    await user.click(await screen.findByRole('button', { name: /Frango com arroz/ }));
    sheet = await screen.findByRole('dialog', { name: 'Editar receita' });
    expect(within(sheet).getByLabelText('Ingredientes (um por linha)')).toHaveValue('frango 1 kg\narroz');
    await user.click(within(sheet).getByRole('button', { name: 'Apagar receita' }));
    await waitFor(() => expect(toastText()).toHaveTextContent('Receita apagada.'));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Receitas' })).not.toBeInTheDocument());
    await user.click(within(toastText()).getByRole('button', { name: 'Desfazer' }));
    expect(await screen.findByRole('button', { name: /Frango com arroz/ })).toBeInTheDocument();
  });

  it('undo of a delete whose name was taken meanwhile does not crash nor duplicate', async () => {
    const user = userEvent.setup();
    const old = await saveRecipe({ name: 'Sopa', ingredients: 'caldo' });
    renderAt('/casa/receitas', <RecipesScreen />);
    await user.click(await screen.findByRole('button', { name: /Sopa/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Editar receita' });
    await user.click(within(sheet).getByRole('button', { name: 'Apagar receita' }));
    await waitFor(() => expect(toastText()).toHaveTextContent('Receita apagada.'));
    await saveRecipe({ name: 'sopa', ingredients: '' });
    await user.click(within(toastText()).getByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(toastText()).toHaveTextContent('Já existe uma receita com esse nome'));
    expect((await db.recipes.get(old.id))!.deleted).toBe(true);
    expect(await screen.findAllByRole('button', { name: /sopa/i })).toHaveLength(1);
  });

  it('keeps keyboard focus off <body> after deleting a recipe', async () => {
    const user = userEvent.setup();
    await saveRecipe({ name: 'Sopa', ingredients: '' });
    renderAt('/casa/receitas', <RecipesScreen />);
    await user.click(await screen.findByRole('button', { name: /Sopa/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Editar receita' });
    await user.click(within(sheet).getByRole('button', { name: 'Apagar receita' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });
});

describe('Lista de compras', () => {
  async function seedMenu(): Promise<void> {
    const r = await saveRecipe({ name: 'Frango com arroz', ingredients: 'frango 1 kg\narroz' });
    const o = await saveRecipe({ name: 'Omelete', ingredients: '' });
    await setMenuSlot(WEEK, '2026-11-10', 'almoco', r.id);
    await setMenuSlot(WEEK, '2026-11-11', 'almoco', r.id);
    await setMenuSlot(WEEK, '2026-11-10', 'jantar', o.id);
  }

  it('lists the week ingredients, ticks into "No carrinho", adds and removes an item', async () => {
    const user = userEvent.setup();
    await seedMenu();
    renderAt(`/casa/compras?semana=${WEEK}`, <ShoppingScreen />);
    expect(await screen.findByText('Esta semana · 09–15/11')).toBeInTheDocument();
    expect(screen.getByText('Pratos da semana: Frango com arroz ×2 · Omelete ×1')).toBeInTheDocument();
    expect(screen.getByText(/Sem ingredientes: Omelete\. Complete em/)).toBeInTheDocument();
    const todo = screen.getByRole('list', { name: 'Para comprar' });
    expect(within(todo).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['arroz', 'frango 1 kg']);

    await user.click(within(todo).getByRole('checkbox', { name: 'arroz' }));
    expect(await screen.findByRole('heading', { name: 'No carrinho (1)' })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'No carrinho' })).getByRole('checkbox', { name: 'arroz' })).toBeChecked();
    expect((await db.shoppingLists.get('shop-2026-11-09'))!.checked).toEqual(['g:arroz']);

    await user.type(screen.getByRole('textbox', { name: 'Novo item' }), 'detergente{Enter}');
    expect(await screen.findByRole('checkbox', { name: 'detergente' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Novo item' })).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Remover detergente' }));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'detergente' })).not.toBeInTheDocument());
  });

  it('a week that is not a Monday falls back to the Casa week; an empty week explains itself', async () => {
    renderAt('/casa/compras?semana=2026-11-10', <ShoppingScreen />);
    expect(await screen.findByText('Esta semana · 09–15/11')).toBeInTheDocument();
    expect(screen.getByText('A lista nasce do cardápio da semana. Escolha os pratos em Planejar → Casa ou adicione itens aqui.'))
      .toBeInTheDocument();
  });

  it('ticking keeps focus on the moved checkbox and removing keeps it off <body>', async () => {
    const user = userEvent.setup();
    await seedMenu();
    renderAt(`/casa/compras?semana=${WEEK}`, <ShoppingScreen />);
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    await user.click(await screen.findByRole('checkbox', { name: 'arroz' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'arroz' })).toHaveFocus());
    await waitFor(() => expect(focus).toHaveBeenCalledWith({ preventScroll: true }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'arroz' })).toHaveFocus());
    focus.mockRestore();
    expect(screen.getByRole('textbox', { name: 'Novo item' })).toHaveAttribute('type', 'text');
    await user.type(screen.getByRole('textbox', { name: 'Novo item' }), 'detergente{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Remover detergente' }));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'detergente' })).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });

  it('limits a manual item to the allowed length', async () => {
    const user = userEvent.setup();
    renderAt(`/casa/compras?semana=${WEEK}`, <ShoppingScreen />);
    const input = await screen.findByRole('textbox', { name: 'Novo item' });
    await user.click(input);
    await user.paste('x'.repeat(200));
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('checkbox', { name: 'x'.repeat(80) })).toBeInTheDocument();
  });
});
