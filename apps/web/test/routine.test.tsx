import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { planFromData, readDayPlanData } from '../src/db/dayPlan';
import { ensureSeed } from '../src/db/seed';
import { PlanScreen } from '../src/features/plan/PlanScreen';
import { WeekView } from '../src/features/plan/WeekView';
import { RoutineScreen } from '../src/features/routine/RoutineScreen';
import { shownOrder } from '../src/features/routine/routineShared';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at, seedBlocks } from './blockFixture';

// Planejar → Rotina (spec §7): guided setup, the block editor, and the blocks in the Semana view.

beforeEach(async () => {
  // Only Date is faked: fake-indexeddb needs the real setImmediate/setTimeout.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 10, 20)); // Wednesday
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const live = async () => (await db.blocks.toArray()).filter((b) => !b.deleted && !b.archived);
const orderOf = async () => (await live()).sort((a, b) => a.order - b.order).map((b) => b.name);
/** The card button of a block (its accessible name starts with the block name). */
const card = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name},`) });

/**
 * jsdom has no layout: give each block card a 64 px slot so the keyboard drag of @dnd-kit can
 * find the card below the dragged one.
 */
function mockCardRects() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const li = this.closest('li.block-card');
    const i = li?.parentElement ? [...li.parentElement.children].indexOf(li) : -1;
    const top = i < 0 ? 0 : i * 64;
    const height = i < 0 ? 0 : 56;
    return { x: 0, y: top, top, left: 0, width: i < 0 ? 0 : 320, height, right: i < 0 ? 0 : 320, bottom: top + height, toJSON: () => ({}) } as DOMRect;
  });
}

describe('routine setup', () => {
  it('previews the routine shifted to 10:30, flags the class overlap and creates everything once', async () => {
    const user = userEvent.setup();
    render(<RoutineScreen />);
    const time = await screen.findByLabelText('A que horas você costuma começar o dia?');
    expect(time).toHaveValue('08:00');
    fireEvent.change(time, { target: { value: '10:30' } });

    const preview = await screen.findByRole('list', { name: 'Prévia da rotina' });
    const row = (name: string) => within(preview).getByText(name).closest('li')!;
    await waitFor(() => expect(row('Bloco 1 · Tech News')).toHaveTextContent('11:00'));
    expect(row('Início do dia')).toHaveTextContent('10:30');
    expect(row('Complementos')).toHaveTextContent('20:00');
    expect(row('Desaceleração')).toHaveTextContent('22:45');
    expect(screen.getByText('Complementos não cabe antes da aula — encurte ou mova')).toBeInTheDocument();
    expect(screen.getByText('O dia passa a terminar à meia-noite para caber a Desaceleração.')).toBeInTheDocument();
    expect(screen.getByText(/compromisso Aula/)).toBeInTheDocument();

    await user.dblClick(screen.getByRole('button', { name: 'Criar rotina' }));
    await waitFor(async () => expect(await live()).toHaveLength(7));
    expect(await screen.findByRole('tab', { name: 'qua', selected: true })).toBeInTheDocument();

    const aula = (await db.commitments.toArray()).filter((c) => !c.deleted && c.title === 'Aula');
    expect(aula).toHaveLength(1);
    expect(aula[0]).toMatchObject({ start: '19:30', end: '22:30', weekdays: [1, 2, 3, 4, 5] });
    expect((await db.areas.toArray()).filter((a) => !a.deleted && a.name === 'Faculdade')).toHaveLength(1);
    expect((await db.journeys.toArray()).filter((j) => !j.deleted && j.title === 'Tech News')).toHaveLength(1);
    expect((await db.settings.get('settings'))?.dayEndHour).toBe(0);
    expect((await live()).find((b) => b.name === 'Bloco 1 · Tech News')?.targetStart).toBe('11:00');
  });

  it('"Começar sem rotina" leaves an empty routine that can still get the suggested one', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<RoutineScreen />);
    await user.click(await screen.findByRole('button', { name: 'Começar sem rotina' }));
    expect(await screen.findByRole('button', { name: 'Criar rotina sugerida' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Novo bloco' })).toBeInTheDocument();
    expect(screen.queryByLabelText('A que horas você costuma começar o dia?')).not.toBeInTheDocument();
    unmount();
    render(<RoutineScreen />);
    await user.click(await screen.findByRole('button', { name: 'Criar rotina sugerida' }));
    expect(await screen.findByLabelText('A que horas você costuma começar o dia?')).toBeInTheDocument();
  });

  it('is the third Planejar tab', async () => {
    const user = userEvent.setup();
    render(<PlanScreen />);
    await user.click(await screen.findByRole('tab', { name: 'Rotina' }));
    expect(await screen.findByLabelText('A que horas você costuma começar o dia?')).toBeInTheDocument();
  });
});

describe('routine editor', () => {
  it('lists the blocks of the selected weekday, today first selected', async () => {
    await seedBlocks();
    const user = userEvent.setup();
    render(<RoutineScreen />);
    expect(await screen.findByRole('tab', { name: 'qua', selected: true })).toBeInTheDocument();
    const tech = await card('Tech');
    expect(tech).toHaveTextContent('09:00');
    expect(tech).toHaveTextContent('3h · mín 45 min');
    expect(await card('Facul')).toHaveTextContent('1h30 · mín 30 min');
    expect(await card('Facul')).toHaveTextContent('protegido');
    expect(await card('Treino')).toHaveTextContent('Corpo');
    await user.click(screen.getByRole('tab', { name: 'sáb' }));
    expect(await screen.findByText(/Nenhum bloco no sábado/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Tech,/ })).not.toBeInTheDocument();
  });

  it('rejects a minimum version longer than the duration (or under 5 min)', async () => {
    await seedBlocks();
    const user = userEvent.setup();
    render(<RoutineScreen />);
    await user.click(await card('Tech'));
    const dialog = await screen.findByRole('dialog', { name: 'Editar bloco' });
    const min = within(dialog).getByLabelText('Versão mínima (min)');
    const save = within(dialog).getByRole('button', { name: 'Salvar' });
    expect(min).toHaveValue(45);

    fireEvent.change(min, { target: { value: '200' } });
    expect(within(dialog).getByText('A versão mínima não pode passar da duração (3h).')).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.click(save);
    fireEvent.change(min, { target: { value: '4' } });
    expect(within(dialog).getByText('A versão mínima precisa ter pelo menos 5 min.')).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(min, { target: { value: '45' } });
    fireEvent.change(within(dialog).getByLabelText('Duração (min)'), { target: { value: '30' } });
    expect(within(dialog).getByText('A versão mínima não pode passar da duração (30 min).')).toBeInTheDocument();
    expect(save).toBeDisabled();
    expect((await db.blocks.get('b1'))?.minimumMin).toBe(45);

    fireEvent.change(within(dialog).getByLabelText('Duração (min)'), { target: { value: '150' } });
    fireEvent.change(min, { target: { value: '60' } });
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(async () => expect(await db.blocks.get('b1')).toMatchObject({ durationMin: 150, minimumMin: 60 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('"Novo bloco" creates a block placed in order by its time, with a checklist for routine blocks', async () => {
    await seedBlocks();
    const user = userEvent.setup();
    render(<RoutineScreen />);
    await user.click(await screen.findByRole('button', { name: 'Novo bloco' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo bloco' });
    expect(within(dialog).getByRole('button', { name: 'Salvar' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Nome'), 'Leitura');
    fireEvent.change(within(dialog).getByLabelText('Início'), { target: { value: '12:00' } });
    await user.click(within(dialog).getByRole('button', { name: /rotina/ }));
    await user.type(within(dialog).getByLabelText('Novo passo'), 'Alongar{Enter}');
    expect(within(dialog).getByText('Alongar')).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Ligação'), 'Estudo');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(async () => expect((await live()).some((b) => b.name === 'Leitura')).toBe(true));
    const leitura = (await live()).find((b) => b.name === 'Leitura')!;
    expect(leitura).toMatchObject({
      targetStart: '12:00', weekdays: [1, 2, 3, 4, 5], kind: 'routine', areaId: 'area-intelecto',
      durationMin: 60, minimumMin: 15, protected: false,
    });
    expect(leitura.checklist.map((c) => c.text)).toEqual(['Alongar']);
    await waitFor(async () => expect(await orderOf()).toEqual(['Tech', 'Leitura', 'Treino', 'Facul', 'Tecnico', 'Compl']));
  });

  it('says above the list that the order is shared by every day with these blocks', async () => {
    await seedBlocks();
    render(<RoutineScreen />);
    const panel = await screen.findByRole('tabpanel');
    expect(within(panel).getByText('A ordem vale para todos os dias que têm estes blocos.')).toBeInTheDocument();
  });

  it('keeps the dropped order on screen until the saved order matches it', () => {
    const dropped = ['b2', 'b1', 'b3'];
    // The live query still has the old order (or a half-written one): the drop stays.
    expect(shownOrder(['b1', 'b2', 'b3'], dropped)).toEqual(dropped);
    expect(shownOrder(['b2', 'b1', 'b3'], dropped)).toEqual(dropped);
    // A block added or removed meanwhile: the saved list wins.
    expect(shownOrder(['b1', 'b2', 'b3', 'b4'], dropped)).toEqual(['b1', 'b2', 'b3', 'b4']);
    expect(shownOrder(['b1', 'b2', 'b3'], undefined)).toEqual(['b1', 'b2', 'b3']);
  });

  it('dragging a card reorders the blocks and the order persists', async () => {
    await seedBlocks();
    mockCardRects();
    const user = userEvent.setup();
    const { unmount } = render(<RoutineScreen />);
    const handle = await screen.findByRole('button', { name: 'Reordenar Tech' });
    await card('Compl');
    handle.focus();
    await user.keyboard('[Space]');
    await user.keyboard('[ArrowDown]');
    await user.keyboard('[Space]');
    await waitFor(async () => expect(await orderOf()).toEqual(['Treino', 'Tech', 'Facul', 'Tecnico', 'Compl']));
    unmount();
    render(<RoutineScreen />);
    await card('Compl');
    const names = screen.getAllByRole('button', { name: /^(Tech|Treino|Facul|Tecnico|Compl),/ })
      .map((b) => b.getAttribute('aria-label')!.split(',')[0]);
    expect(names).toEqual(['Treino', 'Tech', 'Facul', 'Tecnico', 'Compl']);
  });

  it('"Copiar este dia para…" adds the chosen weekdays to the day’s blocks', async () => {
    await seedBlocks();
    const user = userEvent.setup();
    render(<><RoutineScreen /><ToastHost /></>);
    await user.click(await screen.findByRole('tab', { name: 'seg' }));
    await card('Tech');
    await user.click(screen.getByRole('button', { name: 'Copiar este dia para…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Copiar segunda para…' });
    const copy = within(dialog).getByRole('button', { name: 'Copiar' });
    expect(copy).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'sábado' }));
    await user.click(copy);
    await waitFor(async () => {
      for (const b of await live()) expect(b.weekdays).toEqual([1, 2, 3, 4, 5, 6]);
    });
    await user.click(screen.getByRole('tab', { name: 'sáb' }));
    expect(await card('Tech')).toBeInTheDocument();
  });

  it('"Arquivar" (after confirming) removes the block from the routine and from the Agora plan', async () => {
    await seedBlocks();
    const user = userEvent.setup();
    render(<RoutineScreen />);
    await user.click(await card('Compl'));
    const dialog = await screen.findByRole('dialog', { name: 'Editar bloco' });
    await user.click(within(dialog).getByRole('button', { name: 'Arquivar bloco' }));
    expect((await db.blocks.get('b5'))?.archived).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Sim, arquivar' }));
    await waitFor(async () => expect((await db.blocks.get('b5'))?.archived).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Compl,/ })).not.toBeInTheDocument());
    const plan = planFromData((await readDayPlanData('2026-11-11'))!, Date.now());
    expect(plan.map((o) => o.block.id)).toEqual(['b1', 'b2', 'b3', 'b4']);
  });
});

describe('WeekView blocks', () => {
  it('lists the planned blocks of a weekday and "Dia livre" on Saturday', async () => {
    await seedBlocks();
    const user = userEvent.setup();
    render(<WeekView />);
    const today = await screen.findByRole('region', { name: 'qua 11/11' });
    const tech = await within(today).findByText('Tech');
    expect(tech.closest('li')).toHaveTextContent('09:00');
    expect(within(today).getByText('Compl').closest('li')).toHaveTextContent('18:00');
    expect(within(today).getByText('Aula')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /sáb 14\/11/ }));
    const saturday = await screen.findByRole('region', { name: 'sáb 14/11' });
    expect(await within(saturday).findByText('Dia livre')).toBeInTheDocument();
    expect(within(saturday).queryByText('Tech')).not.toBeInTheDocument();
  });

  it('mutes a block that does not fit its day', async () => {
    // A long commitment on Thursday leaves no room for the 18:00 block before the class.
    await seedBlocks();
    await db.commitments.put({
      id: 'c-long', createdAt: 1, updatedAt: 1, deleted: false, title: 'Consulta', date: '2026-11-12',
      start: '17:30', end: '19:00', remind: false,
    });
    const user = userEvent.setup();
    render(<WeekView />);
    await user.click(await screen.findByRole('button', { name: /qui 12\/11/ }));
    const thursday = await screen.findByRole('region', { name: 'qui 12/11' });
    const compl = (await within(thursday).findByText('Compl')).closest('li')!;
    expect(compl).toHaveClass('day-block--skipped');
    expect(compl).toHaveTextContent('não cabe');
  });
});
