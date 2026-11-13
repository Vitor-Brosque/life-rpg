import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Stroke } from '@life/shared';
import { SKETCH_MAX_POINTS, SKETCH_MAX_STROKES } from '@life/shared';
import { FULL_MESSAGE, SketchPad, type SketchPadProps } from '../src/features/sketch/SketchPad';

// jsdom: no canvas (getContext → null in setup.ts), no layout (the view stays at zoom 1 with the
// world origin at the canvas corner), so client coordinates are world coordinates here.

const A: Stroke = { c: 0, w: 0, p: [0, 10, 100, 10] };
const B: Stroke = { c: 1, w: 1, p: [0, 200, 100, 200] };

function setup(initial: Stroke[] = [], onGestureChange?: (on: boolean) => void) {
  const onChange = vi.fn<(s: Stroke[]) => void>();
  render(<SketchPad label="Lousa" initial={initial} onChange={onChange} onGestureChange={onGestureChange} />);
  return { onChange, canvas: screen.getByRole('img', { name: /^Lousa:/ }) };
}

type P = [number, number];
const down = (el: Element, [x, y]: P, id = 1, pointerType = 'mouse', button = 0) =>
  fireEvent.pointerDown(el, { pointerId: id, pointerType, button, buttons: 1, clientX: x, clientY: y });
const move = (el: Element, [x, y]: P, id = 1, pointerType = 'mouse') =>
  fireEvent.pointerMove(el, { pointerId: id, pointerType, buttons: 1, clientX: x, clientY: y });
const up = (el: Element, [x, y]: P, id = 1, pointerType = 'mouse') =>
  fireEvent.pointerUp(el, { pointerId: id, pointerType, button: 0, clientX: x, clientY: y });
function stroke(el: Element, pts: P[], id = 1, pointerType = 'mouse') {
  down(el, pts[0]!, id, pointerType);
  for (const p of pts.slice(1)) move(el, p, id, pointerType);
  up(el, pts[pts.length - 1]!, id, pointerType);
}

describe('SketchPad', () => {
  it('draws a stroke: simplified, rounded, in the chosen ink and width', async () => {
    const user = userEvent.setup();
    const { onChange, canvas } = setup();
    await user.click(screen.getByRole('button', { name: 'Azul' }));
    await user.click(screen.getByRole('button', { name: 'Traço grosso' }));
    stroke(canvas, [[10, 10], [20, 10], [30, 12]]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith([{ c: 1, w: 1, p: [10, 10, 20, 10, 30, 12] }]);
    expect(screen.getByRole('img', { name: 'Lousa: 1 traço' })).toBeInTheDocument();
  });

  it('a tap leaves a dot', () => {
    const { onChange, canvas } = setup();
    stroke(canvas, [[5, 5]]);
    expect(onChange).toHaveBeenLastCalledWith([{ c: 0, w: 0, p: [5, 5] }]);
  });

  it('the eraser removes the whole stroke it touches', async () => {
    const user = userEvent.setup();
    const { onChange, canvas } = setup([A, B]);
    await user.click(screen.getByRole('button', { name: 'Borracha' }));
    stroke(canvas, [[50, 12]]);
    expect(onChange).toHaveBeenLastCalledWith([B]);
  });

  it('undo and redo, by button and by keyboard', async () => {
    const user = userEvent.setup();
    const { onChange, canvas } = setup();
    stroke(canvas, [[5, 5]]);
    const dot = onChange.mock.lastCall![0];
    await user.click(screen.getByRole('button', { name: 'Desfazer na lousa' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    await user.click(screen.getByRole('button', { name: 'Refazer na lousa' }));
    expect(onChange).toHaveBeenLastCalledWith(dot);
    const group = screen.getByRole('group', { name: 'Lousa' });
    fireEvent.keyDown(group, { key: 'z', ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith([]);
    fireEvent.keyDown(group, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(dot);
    fireEvent.keyDown(group, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(group, { key: 'y', ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith(dot);
  });

  it('Limpar clears in one step and offers to undo it', async () => {
    const user = userEvent.setup();
    const { onChange } = setup([A, B]);
    await user.click(screen.getByRole('button', { name: 'Limpar lousa' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Lousa limpa.');
    await user.click(within(status).getByRole('button', { name: 'Desfazer a limpeza' }));
    expect(onChange).toHaveBeenLastCalledWith([A, B]);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('a full lousa refuses a new stroke with a gentle message', () => {
    const full = Array.from({ length: SKETCH_MAX_STROKES }, (_, i): Stroke => ({ c: 0, w: 0, p: [i, 0] }));
    const { onChange, canvas } = setup(full);
    stroke(canvas, [[5, 5], [50, 50]]);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(FULL_MESSAGE);
  });

  it('two fingers pinch: the stroke just started is dropped and nothing is saved', () => {
    const gestures: boolean[] = [];
    const { onChange, canvas } = setup([], (on) => gestures.push(on));
    down(canvas, [10, 10], 1, 'touch');
    move(canvas, [12, 10], 1, 'touch');
    down(canvas, [100, 10], 2, 'touch');
    move(canvas, [150, 10], 2, 'touch');
    move(canvas, [14, 10], 1, 'touch');
    up(canvas, [150, 10], 2, 'touch');
    move(canvas, [40, 40], 1, 'touch'); // the finger left behind draws nothing
    up(canvas, [40, 40], 1, 'touch');
    expect(onChange).not.toHaveBeenCalled();
    expect(gestures).toEqual([true, false]);
  });

  it('a long stroke survives a late second finger', () => {
    const { onChange, canvas } = setup();
    down(canvas, [0, 0], 1, 'touch');
    for (let i = 1; i <= 10; i++) move(canvas, [i * 5, (i % 2) * 5], 1, 'touch');
    down(canvas, [200, 200], 2, 'touch');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.lastCall![0]).toHaveLength(1);
  });

  it('Mover pans without drawing; a right click does nothing', async () => {
    const user = userEvent.setup();
    const { onChange, canvas } = setup();
    down(canvas, [5, 5], 1, 'mouse', 2);
    up(canvas, [5, 5]);
    await user.click(screen.getByRole('button', { name: 'Mover' }));
    stroke(canvas, [[10, 10], [60, 60]]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a very long stroke is split at STROKE_MAX_POINTS and goes on from the same point', () => {
    const { onChange, canvas } = setup();
    stroke(canvas, Array.from({ length: 2101 }, (_, i): P => [i * 2, 0]));
    expect(onChange).toHaveBeenLastCalledWith([{ c: 0, w: 0, p: [0, 0, 3998, 0] }, { c: 0, w: 0, p: [3998, 0, 4200, 0] }]);
  });
  it('a stroke started near the points cap is cut to what fits, with the gentle message', () => {
    const nearly: Stroke = { c: 0, w: 0, p: Array.from({ length: (SKETCH_MAX_POINTS - 3) * 2 }, (_, i) => (i % 4 < 2 ? 0 : 7)) };
    const { onChange, canvas } = setup([nearly]);
    stroke(canvas, [[0, 100], [20, 130], [40, 100], [60, 130], [80, 100], [100, 130]]);
    const last = onChange.mock.lastCall![0];
    expect(last).toHaveLength(2);
    expect(last[1]!.p).toHaveLength(6);
    expect(screen.getByRole('status')).toHaveTextContent(FULL_MESSAGE);
  });

  it('a split stroke is one undo step and leaves no stray dot when the pointer lifts at once', async () => {
    const user = userEvent.setup();
    const { onChange, canvas } = setup();
    down(canvas, [0, 0]);
    for (let i = 1; i <= 1999; i++) move(canvas, [i * 2, 0]);
    up(canvas, [3998, 0]);
    expect(onChange.mock.lastCall![0]).toHaveLength(1);
    stroke(canvas, Array.from({ length: 2101 }, (_, i): P => [i * 2, 50]));
    expect(onChange.mock.lastCall![0]).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Desfazer na lousa' }));
    expect(onChange.mock.lastCall![0]).toHaveLength(1);
  });

  it('keys typed in a field inside actions are not shortcuts', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const props: SketchPadProps = { label: 'Lousa', initial: [], onChange, actions: <input aria-label="Nota" /> };
    render(<SketchPad {...props} />);
    const input = screen.getByRole('textbox', { name: 'Nota' });
    await user.type(input, '0+z');
    expect(input).toHaveValue('0+z');
    const ev = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('the focusable area has a name and arrow keys pan it', () => {
    const { onChange, canvas } = setup();
    const area = screen.getByRole('application', { name: /^Lousa: arraste para desenhar/ });
    fireEvent.keyDown(area, { key: 'ArrowRight' });
    fireEvent.keyDown(area, { key: 'ArrowDown', shiftKey: true });
    stroke(canvas, [[10, 10]]);
    expect(onChange).toHaveBeenLastCalledWith([{ c: 0, w: 0, p: [50, 170] }]);
  });

  it('keeps the status region in the tree when empty, and returns focus to the area after Limpar', async () => {
    const user = userEvent.setup();
    setup([A]);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    const area = screen.getByRole('application');
    await user.click(screen.getByRole('button', { name: 'Limpar lousa' }));
    expect(area).toHaveFocus();
  });

  it('unmounting mid-gesture reports the gesture as over', () => {
    const gestures: boolean[] = [];
    const onChange = vi.fn();
    const { unmount } = render(<SketchPad label="Lousa" initial={[]} onChange={onChange} onGestureChange={(on) => gestures.push(on)} />);
    down(screen.getByRole('img', { name: /^Lousa:/ }), [5, 5]);
    unmount();
    expect(gestures).toEqual([true, false]);
  });
});
