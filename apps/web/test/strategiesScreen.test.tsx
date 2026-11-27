import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Strategy } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, patch, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { DiaryScreen } from '../src/features/diary/DiaryScreen';
import { StrategiesScreen } from '../src/features/diary/StrategiesScreen';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at, seedBlocks } from './blockFixture';

const TODAY = '2026-11-23';
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(23, 21));
  await db.delete();
  await db.open();
  await ensureSeed();
  await seedBlocks();
  useToast.getState().dismiss();
});
afterEach(() => { vi.useRealTimers(); });

const strategy = (p: Partial<Strategy> & Pick<Strategy, 'title'>): Promise<Strategy> => put('strategies', newRecord<Strategy>({
  source: 'ideia', startDay: '2026-11-16', reviewDay: '2026-11-30', status: 'testando', ...p,
}));
const renderScreen = () => render(<><StrategiesScreen /><ToastHost /></>);
const dialog = (name: string) => screen.findByRole('dialog', { name });
const toastSays = (text: string) => waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(text));
const counts = async () => [await db.strategies.count(), await db.outbox.count(), await db.weeks.count()];

describe('Estratégias', () => {
  it('empty: the sentence; opening and cancelling Nova estratégia writes nothing', async () => {
    const user = userEvent.setup();
    const before = await counts();
    renderScreen();
    expect(await screen.findByText(/^Nenhuma estratégia ainda\./)).toBeInTheDocument();
    expect(screen.getByText('O que você está testando, de onde veio e o que decidiu. A decisão de testar é sempre sua: nada chega de uma IA sozinho.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nova estratégia' }));
    const d = await dialog('Nova estratégia');
    expect(within(d).getByRole('button', { name: 'Começar a testar' })).toBeDisabled();
    expect(within(d).queryByLabelText('Qual conversa ou fonte? (opcional)')).not.toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await counts()).toEqual(before);
  });

  it('only a title: testing from today, decide in two weeks', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Nova estratégia' }));
    const d = await dialog('Nova estratégia');
    await user.type(within(d).getByLabelText('O que vai testar?'), 'Celular longe');
    expect(within(d).getByText('Decidir em 07/12.')).toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: 'Começar a testar' }));
    await toastSays('Estratégia em teste. Ela aparece no Agora.');
    const [s] = await db.strategies.toArray();
    expect(s).toMatchObject({ title: 'Celular longe', source: 'ideia', startDay: TODAY, reviewDay: '2026-12-07', status: 'testando' });
    const group = await screen.findByRole('region', { name: 'Testando' });
    expect(within(group).getByRole('button', { name: /Celular longe/ })).toHaveTextContent('Ideia minha · desde 23/11 · decidir em 07/12');
  });

  it('origin with its source note, a block link and four weeks', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Nova estratégia' }));
    const d = await dialog('Nova estratégia');
    await user.type(within(d).getByLabelText('O que vai testar?'), 'Celular em outro cômodo');
    await user.click(within(within(d).getByRole('group', { name: 'De onde veio?' })).getByRole('button', { name: 'Conversa de IA' }));
    await user.type(within(d).getByLabelText('Qual conversa ou fonte? (opcional)'), 'Claude, 15/11');
    await user.selectOptions(within(d).getByLabelText('Ligar a (opcional)'), 'block:b1');
    await user.click(within(within(d).getByRole('group', { name: 'Decidir em' })).getByRole('button', { name: '4 semanas' }));
    expect(within(d).getByText('Decidir em 21/12.')).toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: 'Começar a testar' }));
    await waitFor(async () => expect(await db.strategies.count()).toBe(1));
    expect((await db.strategies.toArray())[0]).toMatchObject({
      source: 'ia', sourceNote: 'Claude, 15/11', link: { kind: 'block', id: 'b1' }, reviewDay: '2026-12-21',
    });
    expect(await screen.findByText('Bloco: Tech')).toBeInTheDocument();
  });

  it('Hora de decidir comes first with its tag; Decidir depois; Manter with a note moves it to Mantidas', async () => {
    const user = userEvent.setup();
    await strategy({ title: 'Biblioteca', reviewDay: '2026-12-01' });
    await strategy({ title: 'Celular longe', reviewDay: '2026-11-20' });
    renderScreen();
    const group = await screen.findByRole('region', { name: 'Testando' });
    const items = within(group).getAllByRole('listitem').filter((li) => li.classList.contains('strategy-item'));
    expect(items.map((li) => within(li).getAllByRole('button')[0]!.textContent)).toEqual([
      expect.stringContaining('Celular longe'), expect.stringContaining('Biblioteca'),
    ]);
    expect(within(items[0]!).getByText('Hora de decidir')).toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: /Celular longe/ }));
    let d = await dialog('Estratégia');
    expect(within(d).getByText('Hora de decidir: manter, ajustar ou descartar. Decidir é opcional.')).toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: 'Decidir depois (+7 dias)' }));
    await toastSays('Combinado: decidir em 30/11.');
    await waitFor(async () => expect((await db.strategies.toArray()).find((s) => s.title === 'Celular longe')!.reviewDay).toBe('2026-11-30'));
    await user.click(await within(await screen.findByRole('region', { name: 'Testando' })).findByRole('button', { name: /Biblioteca/ }));
    d = await dialog('Estratégia');
    await user.click(within(within(d).getByRole('group', { name: 'Decisão (opcional)' })).getByRole('button', { name: 'Manter' }));
    await user.type(within(d).getByLabelText('Nota da decisão (opcional)'), 'Rendeu mais.');
    await user.click(within(d).getByRole('button', { name: 'Salvar' }));
    await toastSays('Decisão registrada.');
    expect((await db.strategies.toArray()).find((s) => s.title === 'Biblioteca')).toMatchObject({
      status: 'mantida', decidedDay: TODAY, decisionNote: 'Rendeu mais.',
    });
    const kept = await screen.findByRole('region', { name: 'Mantidas' });
    expect(within(kept).getByRole('button', { name: /Biblioteca/ })).toHaveTextContent('Ideia minha · desde 16/11 · mantida em 23/11');
  });

  it('Ajustar: the toast and the sheet offer "Testar a versão ajustada", a new test with the same fields', async () => {
    const user = userEvent.setup();
    await strategy({ title: 'Celular longe', source: 'ia', sourceNote: 'Claude', why: 'Menos escapes', link: { kind: 'block', id: 'b1' } });
    renderScreen();
    await user.click(await screen.findByRole('button', { name: /Celular longe/ }));
    const d = await dialog('Estratégia');
    await user.click(within(within(d).getByRole('group', { name: 'Decisão (opcional)' })).getByRole('button', { name: 'Ajustar' }));
    await user.click(within(d).getByRole('button', { name: 'Salvar' }));
    await toastSays('Decisão registrada.');
    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Testar a versão ajustada' }));
    const n = await dialog('Nova estratégia');
    expect(within(n).getByLabelText('O que vai testar?')).toHaveValue('Celular longe');
    expect(within(n).getByLabelText('Qual conversa ou fonte? (opcional)')).toHaveValue('Claude');
    expect(within(n).getByLabelText('Ligar a (opcional)')).toHaveValue('block:b1');
    await user.clear(within(n).getByLabelText('O que vai testar?'));
    await user.type(within(n).getByLabelText('O que vai testar?'), 'Celular na mochila');
    await user.click(within(n).getByRole('button', { name: 'Começar a testar' }));
    await waitFor(async () => expect(await db.strategies.count()).toBe(2));
    const all = await db.strategies.toArray();
    expect(all.find((s) => s.title === 'Celular longe')).toMatchObject({ status: 'ajustada', decidedDay: TODAY });
    expect(all.find((s) => s.title === 'Celular na mochila')).toMatchObject({ status: 'testando', startDay: TODAY, why: 'Menos escapes', source: 'ia' });
    await user.click(within(await screen.findByRole('region', { name: 'Ajustadas' })).getByRole('button', { name: /Celular longe/ }));
    expect(within(await dialog('Estratégia')).getByRole('button', { name: 'Testar a versão ajustada' })).toBeInTheDocument();
  });

  it('a field changed elsewhere while the sheet is open is kept by Salvar', async () => {
    const user = userEvent.setup();
    const s = await strategy({ title: 'Celular longe', why: 'Menos escapes' });
    renderScreen();
    await user.click(await screen.findByRole('button', { name: /Celular longe/ }));
    const d = await dialog('Estratégia');
    await patch<Strategy>('strategies', s.id, { why: 'Escrito no PC' });
    await user.type(within(d).getByLabelText('O que observar? (opcional)'), 'Escapes');
    await user.click(within(d).getByRole('button', { name: 'Salvar' }));
    await toastSays('Estratégia salva.');
    expect(await db.strategies.get(s.id)).toMatchObject({ why: 'Escrito no PC', observe: 'Escapes' });
  });

  it('Apagar → Apagadas recentemente → Restaurar → Apagar de vez, the focus never on <body>', async () => {
    const user = userEvent.setup();
    const s = await strategy({ title: 'Celular longe' });
    renderScreen();
    await user.click(await screen.findByRole('button', { name: /Celular longe/ }));
    await user.click(within(await dialog('Estratégia')).getByRole('button', { name: 'Apagar' }));
    await toastSays('Estratégia apagada. Ela fica em Apagadas recentemente.');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Testando' })).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Estratégias' })));
    await user.click(screen.getByText('Apagadas recentemente (1)'));
    await user.click(screen.getByRole('button', { name: 'Restaurar: Celular longe' }));
    expect(await screen.findByRole('region', { name: 'Testando' })).toBeInTheDocument();
    expect((await db.strategies.get(s.id))!.trashedAt).toBeUndefined();
    await user.click(screen.getByRole('button', { name: /Celular longe/ }));
    await user.click(within(await dialog('Estratégia')).getByRole('button', { name: 'Apagar' }));
    await user.click(await screen.findByText('Apagadas recentemente (1)'));
    await user.click(screen.getByRole('button', { name: 'Apagar de vez: Celular longe' }));
    expect(screen.getByText('Apagar de vez? Não dá para desfazer.')).toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: 'Confirmar apagar de vez: Celular longe' })).getByRole('button', { name: 'Apagar de vez' }));
    await waitFor(async () => expect(await db.strategies.get(s.id)).toMatchObject({ deleted: true, title: '' }));
    await waitFor(() => expect(screen.queryByText(/Apagadas recentemente/)).not.toBeInTheDocument());
    expect(document.activeElement).not.toBe(document.body);
  });

  it('the Diário bar links to Estratégias', async () => {
    render(<DiaryScreen />);
    expect(await screen.findByRole('link', { name: 'Estratégias' })).toHaveAttribute('href', '/diario/estrategias');
  });
});

describe('Estratégias: folha de edição e foco', () => {
  it('Decidir depois keeps what was typed in a text field and moves the review day', async () => {
    const user = userEvent.setup();
    await strategy({ title: 'Celular longe', reviewDay: '2026-11-20' });
    renderScreen();
    await user.click(await screen.findByRole('button', { name: /Celular longe/ }));
    const d = await dialog('Estratégia');
    await user.type(within(d).getByLabelText('O que observar? (opcional)'), 'escapes');
    await user.click(within(d).getByRole('button', { name: 'Decidir depois (+7 dias)' }));
    await toastSays('Combinado: decidir em 30/11.');
    await waitFor(async () => expect((await db.strategies.toArray())[0]).toMatchObject({
      observe: 'escapes', reviewDay: '2026-11-30', status: 'testando',
    }));
  });

  it('Decidir depois keeps a typed decision note without deciding', async () => {
    const user = userEvent.setup();
    await strategy({ title: 'Celular longe', reviewDay: '2026-11-20' });
    renderScreen();
    await user.click(await screen.findByRole('button', { name: /Celular longe/ }));
    const d = await dialog('Estratégia');
    await user.click(within(within(d).getByRole('group', { name: 'Decisão (opcional)' })).getByRole('button', { name: 'Manter' }));
    await user.type(within(d).getByLabelText('Nota da decisão (opcional)'), 'Parece bom.');
    await user.click(within(d).getByRole('button', { name: 'Decidir depois (+7 dias)' }));
    await toastSays('Combinado: decidir em 30/11.');
    await waitFor(async () => expect((await db.strategies.toArray())[0]).toMatchObject({
      status: 'testando', decisionNote: 'Parece bom.', reviewDay: '2026-11-30',
    }));
    expect((await db.strategies.toArray())[0]!.decidedDay).toBeUndefined();
  });

  it('"Testar a versão ajustada" inside the sheet keeps the edits of the first strategy', async () => {
    const user = userEvent.setup();
    await strategy({ title: 'Celular longe', status: 'ajustada', decidedDay: '2026-11-22' });
    renderScreen();
    await user.click(await screen.findByRole('button', { name: /Celular longe/ }));
    const d = await dialog('Estratégia');
    await user.type(within(d).getByLabelText('O que observar? (opcional)'), 'escapes');
    await user.click(within(d).getByRole('button', { name: 'Testar a versão ajustada' }));
    const n = await dialog('Nova estratégia');
    expect(within(n).getByLabelText('O que vai testar?')).toHaveValue('Celular longe');
    await waitFor(async () => expect((await db.strategies.toArray())[0]).toMatchObject({ observe: 'escapes', status: 'ajustada' }));
  });

  it('opening and cancelling the edit sheet writes nothing; Salvar with no change only closes', async () => {
    const user = userEvent.setup();
    await strategy({ title: 'Celular longe' });
    renderScreen();
    const before = await counts();
    await user.click(await screen.findByRole('button', { name: /Celular longe/ }));
    let d = await dialog('Estratégia');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await counts()).toEqual(before);
    await user.click(screen.getByRole('button', { name: /Celular longe/ }));
    d = await dialog('Estratégia');
    await user.click(within(d).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await counts()).toEqual(before);
    expect(screen.queryByRole('status')).not.toHaveTextContent('Estratégia salva.');
  });

  it('Descartar with a note', async () => {
    const user = userEvent.setup();
    await strategy({ title: 'Celular longe' });
    renderScreen();
    await user.click(await screen.findByRole('button', { name: /Celular longe/ }));
    const d = await dialog('Estratégia');
    await user.click(within(within(d).getByRole('group', { name: 'Decisão (opcional)' })).getByRole('button', { name: 'Descartar' }));
    await user.type(within(d).getByLabelText('Nota da decisão (opcional)'), 'Não ajudou.');
    await user.click(within(d).getByRole('button', { name: 'Salvar' }));
    await toastSays('Decisão registrada.');
    expect((await db.strategies.toArray())[0]).toMatchObject({ status: 'descartada', decidedDay: TODAY, decisionNote: 'Não ajudou.' });
  });

  it('Manter moves the row to another group: focus is not left on <body>', async () => {
    const user = userEvent.setup();
    await strategy({ title: 'Celular longe' });
    renderScreen();
    await user.click(await screen.findByRole('button', { name: /Celular longe/ }));
    const d = await dialog('Estratégia');
    await user.click(within(within(d).getByRole('group', { name: 'Decisão (opcional)' })).getByRole('button', { name: 'Manter' }));
    await user.click(within(d).getByRole('button', { name: 'Salvar' }));
    const kept = await screen.findByRole('region', { name: 'Mantidas' });
    await waitFor(() => expect(document.activeElement).toBe(within(kept).getByRole('button', { name: /Celular longe/ })));
  });

  it('the toast path "Testar a versão ajustada": after saving the new one focus is not on <body>', async () => {
    const user = userEvent.setup();
    await strategy({ title: 'Celular longe' });
    renderScreen();
    await user.click(await screen.findByRole('button', { name: /Celular longe/ }));
    const d = await dialog('Estratégia');
    await user.click(within(within(d).getByRole('group', { name: 'Decisão (opcional)' })).getByRole('button', { name: 'Ajustar' }));
    await user.click(within(d).getByRole('button', { name: 'Salvar' }));
    await toastSays('Decisão registrada.');
    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Testar a versão ajustada' }));
    const n = await dialog('Nova estratégia');
    await user.clear(within(n).getByLabelText('O que vai testar?'));
    await user.type(within(n).getByLabelText('O que vai testar?'), 'Celular na mochila');
    await user.click(within(n).getByRole('button', { name: 'Começar a testar' }));
    await waitFor(async () => expect(await db.strategies.count()).toBe(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });
});
