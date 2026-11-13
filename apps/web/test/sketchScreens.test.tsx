import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stroke } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { createMission } from '../src/domain/actions';
import { createSketch, ensureMissionSketch, saveSketchStrokes } from '../src/domain/sketchActions';
import { useMissionSheet } from '../src/features/mission/MissionSheet';
import { SketchListScreen } from '../src/features/sketch/SketchListScreen';
import { SketchScreen } from '../src/features/sketch/SketchScreen';
import { SketchesPanel } from '../src/features/sketch/SketchesPanel';
import { ToastHost } from '../src/ui/Toast';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 12, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
  useMissionSheet.getState().close();
});
afterEach(() => { vi.useRealTimers(); window.history.pushState({}, '', '/'); });

const dot = (x: number): Stroke => ({ c: 0, w: 0, p: [x, x] });
const tap = (el: Element, x: number) => {
  fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: x });
  fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: x });
};
const live = async () => (await db.sketches.toArray()).filter((s) => !s.deleted);

describe('SketchScreen', () => {
  it('draws and saves every stroke at once', async () => {
    const s = await createSketch({ strokes: [dot(5)] });
    render(<SketchScreen id={s.id} />);
    tap(await screen.findByRole('img', { name: 'Lousa: 1 traço' }), 40);
    await waitFor(async () => expect((await db.sketches.get(s.id))!.strokes).toEqual([dot(5), dot(40)]));
    expect(screen.getByRole('img', { name: 'Lousa: 2 traços' })).toBeInTheDocument();
  });

  it('adopts a newer version written elsewhere while idle', async () => {
    const s = await createSketch({ strokes: [dot(5)] });
    render(<SketchScreen id={s.id} />);
    await screen.findByRole('img', { name: 'Lousa: 1 traço' });
    vi.setSystemTime(new Date(2026, 10, 12, 10, 5));
    await saveSketchStrokes(s.id, [dot(1), dot(2), dot(3)]); // as if pulled from the iPhone
    expect(await screen.findByRole('img', { name: 'Lousa: 3 traços' })).toBeInTheDocument();
  });

  it('renames on blur; Esc gives the edit up', async () => {
    const user = userEvent.setup();
    const s = await createSketch();
    render(<SketchScreen id={s.id} />);
    const input = await screen.findByRole('textbox', { name: 'Título da lousa' });
    expect(input).toHaveAttribute('placeholder', 'Lousa de 12/11');
    await user.type(input, 'Lista 3{Enter}');
    await waitFor(async () => expect((await db.sketches.get(s.id))!.title).toBe('Lista 3'));
    await user.type(input, ' rascunho{Escape}');
    await waitFor(() => expect(input).toHaveValue('Lista 3'));
    expect((await db.sketches.get(s.id))!.title).toBe('Lista 3');
  });

  it('Apagar goes back and offers Desfazer', async () => {
    const user = userEvent.setup();
    const s = await createSketch();
    window.history.pushState({}, '', `/lousa/${s.id}?voltar=%2Festudo`);
    render(<><SketchScreen id={s.id} /><ToastHost /></>);
    await user.click(await screen.findByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(window.location.pathname).toBe('/estudo'));
    expect(await live()).toHaveLength(0);
    await user.click(await screen.findByRole('button', { name: 'Desfazer' }));
    await waitFor(async () => expect(await live()).toHaveLength(1));
  });

  it('a mission lousa is named after the mission and opens its sheet', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Pipeline do Tech News' });
    const s = await ensureMissionSketch(m.id);
    render(<SketchScreen id={s.id} />);
    const input = await screen.findByRole('textbox', { name: 'Título da lousa' });
    await waitFor(() => expect(input).toHaveAttribute('placeholder', 'Lousa · Pipeline do Tech News'));
    await user.click(screen.getByRole('button', { name: 'Missão' }));
    expect(useMissionSheet.getState().openId).toBe(m.id);
  });

  it('an unknown id says so', async () => {
    render(<SketchScreen id="nope" />);
    expect(await screen.findByRole('heading', { name: 'Lousa não encontrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver lousas' })).toHaveAttribute('href', '/estudo/lousas');
  });
});

describe('lists', () => {
  it('lists standalone lousas and mission lousas with strokes, searches, and creates', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Diagrama' });
    await ensureMissionSketch('m-empty');
    const ms = await ensureMissionSketch(m.id);
    await saveSketchStrokes(ms.id, [dot(1), dot(2)]);
    await createSketch({ title: 'Derivadas' });
    render(<SketchListScreen />);
    expect(await screen.findByRole('link', { name: /Derivadas/ })).toHaveTextContent('vazia · agora');
    expect(screen.getByRole('link', { name: /Lousa · Diagrama/ })).toHaveTextContent('Missão · 2 traços');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    await user.type(screen.getByRole('searchbox', { name: 'Buscar' }), 'derivada');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Nova lousa' }));
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/lousa\//));
    expect(window.location.search).toBe('?voltar=%2Festudo%2Flousas');
    expect(await live()).toHaveLength(4);
  });

  it('the Estudo panel shows 3, then "Ver todas"; empty it explains', async () => {
    const { unmount } = render(<SketchesPanel />);
    expect(await screen.findByText('Um espaço livre para contas, fórmulas e diagramas.')).toBeInTheDocument();
    unmount();
    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(new Date(2026, 10, 12, 10, i));
      await createSketch({ title: `L${i}` });
    }
    render(<SketchesPanel />);
    expect(await screen.findByRole('link', { name: /L3/ })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent?.slice(0, 2))).toEqual(['L3', 'L2', 'L1']);
    expect(screen.getByRole('link', { name: 'Ver todas' })).toHaveAttribute('href', '/estudo/lousas');
  });
});
