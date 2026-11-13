import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { createMission } from '../src/domain/actions';
import { saveDeck, saveNote } from '../src/domain/studyActions';
import { MissionSheet } from '../src/features/mission/MissionSheet';
import { ReviewSession } from '../src/features/study/ReviewSession';
import { useSession } from '../src/features/study/sessionStore';
import { ToastHost } from '../src/ui/Toast';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 12, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
  useSession.getState().reset();
  localStorage.clear();
  window.history.pushState({}, '', '/estudo/revisar');
});
afterEach(() => { vi.useRealTimers(); window.history.pushState({}, '', '/'); });

async function deck(n: number) {
  const d = await saveDeck({ name: 'Cálculo' });
  for (let i = 0; i < n; i++) {
    vi.setSystemTime(new Date(2026, 10, 12, 9, i));
    await saveNote({ deckId: d.id, type: 'basic', front: `pergunta ${i}`, back: `resposta ${i}` });
  }
  vi.setSystemTime(new Date(2026, 10, 12, 10, 0));
}
const tap = (el: Element, x: number) => {
  fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: x });
  fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: x });
};
const liveReviews = async () => (await db.reviews.toArray()).filter((r) => !r.deleted);

describe('"Desenhar antes" in the review session', () => {
  it('opens a pad (remembered), saves drew, and the drawing can become a lousa', async () => {
    const user = userEvent.setup();
    await deck(2);
    render(<><ReviewSession /><ToastHost /></>);
    await screen.findByText('pergunta 0');
    await user.click(screen.getByRole('button', { name: 'Desenhar antes' }));
    expect(screen.getByRole('button', { name: 'Desenhar antes' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('life-rpg.study.drawFirst')).toBe('1');
    tap(screen.getByRole('img', { name: 'Desenho da resposta: 0 traços' }), 20);
    expect(screen.getByRole('img', { name: 'Desenho da resposta: 1 traço' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar como lousa' })).toBeNull(); // only after revealing

    await user.click(screen.getByRole('button', { name: 'Mostrar resposta' }));
    expect(await screen.findByText('resposta 0')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Desenho da resposta: 1 traço' })).toBeInTheDocument(); // still there, editable
    await user.click(screen.getByRole('button', { name: 'Salvar como lousa' }));
    expect(await screen.findByText('Desenho salvo em Lousas.')).toBeInTheDocument();
    await waitFor(async () => expect((await db.sketches.toArray()).filter((s) => !s.deleted)).toHaveLength(1));
    const [saved] = await db.sketches.toArray();
    expect(saved).toMatchObject({ title: 'Revisão · pergunta 0', strokes: [{ c: 0, w: 0, p: [20, 20] }] });
    expect(screen.getByRole('button', { name: 'Salvo' })).toBeDisabled();
    tap(screen.getByRole('img', { name: 'Desenho da resposta: 1 traço' }), 60);
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(async () => expect((await db.sketches.get(saved!.id))!.strokes).toHaveLength(2));
    expect((await db.sketches.toArray()).filter((s) => !s.deleted)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /^Bom,/ }));
    await waitFor(async () => expect((await liveReviews())[0]).toMatchObject({ drew: true }));
    expect(await screen.findByText('pergunta 1')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Desenho da resposta: 0 traços' })).toBeInTheDocument(); // a fresh pad
  });

  it('a card revealed without a stroke has no drew flag', async () => {
    const user = userEvent.setup();
    localStorage.setItem('life-rpg.study.drawFirst', '1');
    await deck(1);
    render(<ReviewSession />);
    await screen.findByRole('img', { name: 'Desenho da resposta: 0 traços' });
    await user.click(screen.getByRole('button', { name: 'Mostrar resposta' }));
    await user.click(await screen.findByRole('button', { name: /^Bom,/ }));
    await waitFor(async () => expect(await liveReviews()).toHaveLength(1));
    expect((await liveReviews())[0]).not.toHaveProperty('drew');
  });

  it('with the focus on the drawing area, Space reveals and 3 rates', async () => {
    const user = userEvent.setup();
    localStorage.setItem('life-rpg.study.drawFirst', '1');
    await deck(1);
    render(<ReviewSession />);
    tap(await screen.findByRole('img', { name: 'Desenho da resposta: 0 traços' }), 10);
    expect(document.activeElement).toHaveClass('sketch__area');
    await user.keyboard(' ');
    expect(await screen.findByText('resposta 0')).toBeInTheDocument();
    await user.keyboard('3');
    await waitFor(async () => expect((await liveReviews()).map((r) => r.rating)).toEqual([3]));
  });
});

describe('"Lousa da missão" in the mission sheet', () => {
  it('creates the mission lousa and opens it, coming back to the current screen', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/planejar');
    const m = await createMission({ title: 'Diagrama do pipeline' });
    const onClose = vi.fn();
    render(<MissionSheet missionId={m.id} onClose={onClose} />);
    await user.click(await screen.findByRole('button', { name: 'Lousa da missão' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/lousa/sketch-m-${m.id}`));
    expect(window.location.search).toBe('?voltar=%2Fplanejar');
    expect(onClose).toHaveBeenCalled();
    expect(await db.sketches.get(`sketch-m-${m.id}`)).toMatchObject({ missionId: m.id, strokes: [] });
  });

  it('shows how many strokes the mission lousa has', async () => {
    const m = await createMission({ title: 'Diagrama' });
    await db.sketches.put({ id: `sketch-m-${m.id}`, createdAt: 1, updatedAt: 1, deleted: false, title: '', missionId: m.id, strokes: [{ c: 0, w: 0, p: [1, 1] }, { c: 0, w: 0, p: [2, 2] }] });
    render(<MissionSheet missionId={m.id} onClose={() => {}} />);
    expect(await screen.findByText('2 traços')).toBeInTheDocument();
  });
});
