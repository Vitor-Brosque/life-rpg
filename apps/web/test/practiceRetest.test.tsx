import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PracticeSession } from '@life/shared';
import { PRACTICE_LIMITS } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import {
  addPracticeFeedback, compareRebuild, concludePractice, createPracticeSession, createRetest, deletePractice,
  setPracticeRating, startRebuild, updatePractice,
} from '../src/domain/practiceActions';
import { PracticeListScreen } from '../src/features/practice/PracticeListScreen';
import { PracticePanel } from '../src/features/practice/PracticePanel';
import { PracticeScreen } from '../src/features/practice/PracticeScreen';
import { ToastHost, useToast } from '../src/ui/Toast';

// P2 (reconstruir em outro dia) e P7 (pistas no histórico), ajustes da pesquisa.

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0)); // Friday 13/11
  await db.delete(); await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
});
afterEach(() => { vi.useRealTimers(); window.history.pushState({}, '', '/'); });

const SLOW = { timeout: 4000 };
const get = async (id: string) => (await db.practiceSessions.get(id))!;
const all = async () => (await db.practiceSessions.toArray()).filter((s) => !s.deleted);

const original = async (fields: Partial<PracticeSession> = {}) => {
  const s = await createPracticeSession({ title: 'Dedup', journeyId: 'j-x', missionId: 'm-x' });
  await updatePractice(s.id, { step: 'rebuild', problem: 'remover repetidas', inputs: 'lista', outputs: 'lista única', code: 'def dedup(xs): ...' });
  await db.practiceSessions.update(s.id, {
    basics: [{ id: 'b1', text: 'set', done: true }],
    plan: [{ id: 'p1', text: 'ler', done: true }, { id: 'p2', text: 'filtrar', done: true }],
    tests: [{ id: 't1', text: 'vazio → []', done: true }],
    feedback: [{ id: 'f1', at: 1, source: 'person', text: 'ok' }],
    errors: [{ id: 'e1', at: 1, what: 'x', why: 'y', fix: 'z' }],
    explanation: 'minhas palavras', nextAction: 'ligar', deckId: 'deck-x', ...fields,
  });
  await startRebuild(s.id);
  await compareRebuild(s.id);
  return get(s.id);
};

describe('createRetest', () => {
  it('copies the method, hides nothing it should not, and schedules the day', async () => {
    const o = await original();
    const r = await createRetest(o.id, 3);
    expect(r.id).not.toBe(o.id);
    expect(r).toMatchObject({
      title: 'Dedup · de novo', problem: 'remover repetidas', inputs: 'lista', outputs: 'lista única',
      language: 'python', code: 'def dedup(xs): ...', journeyId: 'j-x', missionId: 'm-x', deckId: 'deck-x',
      step: 'rebuild', status: 'open', retestOf: o.id, availableFrom: '2026-11-16', deleted: false,
    });
    expect(r.basics).toEqual(o.basics);
    expect(r.plan.map((p) => [p.text, p.done])).toEqual([['ler', false], ['filtrar', false]]);
    expect(r.tests.map((p) => [p.text, p.done])).toEqual([['vazio → []', false]]);
    expect(r.feedback).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.rebuild).toBeUndefined();
    expect(r.explanation).toBe('');
    expect(r.nextAction).toBeUndefined();
    expect(r.ratings).toEqual({});
    expect((await get(r.id)).retestOf).toBe(o.id);
  });

  it('1 week and 2 weeks; the title is cut to the limit', async () => {
    const o = await original();
    await db.practiceSessions.update(o.id, { title: 'T'.repeat(PRACTICE_LIMITS.title) });
    expect((await createRetest(o.id, 14)).availableFrom).toBe('2026-11-27');
    expect((await createRetest(o.id, 7)).title).toHaveLength(PRACTICE_LIMITS.title);
  });

  it('uses the logical day (before the day starts, it is still yesterday)', async () => {
    const o = await original();
    vi.setSystemTime(new Date(2026, 10, 14, 2, 0)); // 02:00 of 14/11, the logical day is still 13/11
    expect((await createRetest(o.id, 3)).availableFrom).toBe('2026-11-16');
  });

  it('one at a time: a double tap and a second call return the same open retest', async () => {
    const o = await original();
    const [a, b] = await Promise.all([createRetest(o.id, 3), createRetest(o.id, 7)]);
    expect(b.id).toBe(a.id);
    expect((await createRetest(o.id, 14)).id).toBe(a.id);
    expect((await all()).filter((s) => s.retestOf === o.id)).toHaveLength(1);
  });

  it('a closed or deleted retest frees the slot', async () => {
    const o = await original();
    const a = await createRetest(o.id, 3);
    await deletePractice(a.id);
    const b = await createRetest(o.id, 3);
    expect(b.id).not.toBe(a.id);
    await updatePractice(b.id, { code: 'x' });
    await setPracticeRating(b.id, 'delivered', 2);
    await setPracticeRating(b.id, 'understood', 2);
    await setPracticeRating(b.id, 'autonomous', 2);
    await concludePractice(b.id);
    expect((await createRetest(o.id, 3)).id).not.toBe(b.id);
  });

  it('throws for a missing session', async () => {
    await expect(createRetest('nope', 3)).rejects.toThrow();
  });
});

const openScreen = async (id: string) => {
  window.history.pushState({}, '', `/pratica/${id}`);
  render(<><PracticeScreen id={id} /><ToastHost /></>);
  return screen.findByRole('heading', { level: 2, name: 'Reconstruir sem consulta' }, SLOW);
};

describe('Reconstruir de novo (screen)', () => {
  it('offers the three delays after comparing; choosing one keeps focus and shows the date with "Abrir"', async () => {
    const user = userEvent.setup();
    const o = await original();
    const title = await openScreen(o.id);
    const group = await screen.findByRole('group', { name: 'Reconstruir de novo, sem consultar' }, SLOW);
    expect(within(group).getByText('Uma nova tentativa mais tarde mostra o que ficou.')).toBeInTheDocument();
    for (const n of ['Em 3 dias', 'Em 1 semana', 'Em 2 semanas']) expect(within(group).getByRole('button', { name: n })).toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: 'Em 1 semana' }));
    expect(await screen.findByText('Reconstrução marcada para 20/11.', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir' })).toHaveAttribute('href', expect.stringMatching(/^\/pratica\/.+/));
    expect(screen.queryByRole('button', { name: 'Em 3 dias' })).toBeNull();
    await waitFor(() => expect(title).toHaveFocus(), SLOW);
    expect(document.body).not.toHaveFocus();
    expect((await all()).filter((s) => s.retestOf === o.id)).toHaveLength(1);
  });

  it('shows the group only after comparing', async () => {
    const s = await createPracticeSession({ title: 'Dedup' });
    await updatePractice(s.id, { step: 'rebuild', code: 'x = 1' });
    await openScreen(s.id);
    await screen.findByRole('button', { name: 'Começar reconstrução' });
    expect(screen.queryByRole('group', { name: 'Reconstruir de novo, sem consultar' })).toBeNull();
  });

  it('a retest before its day opens on Reconstruir with a calm notice and the start button; the code stays hidden', async () => {
    const o = await original();
    const r = await createRetest(o.id, 3);
    await openScreen(r.id);
    expect(await screen.findByText('Marcada para 16/11. Pode começar antes, se quiser.', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Começar reconstrução' })).toBeEnabled();
    expect(screen.queryByText(/def dedup/)).toBeNull();
  });

  it('on the day the notice is gone', async () => {
    const o = await original();
    const r = await createRetest(o.id, 3);
    vi.setSystemTime(new Date(2026, 10, 16, 10, 0));
    await openScreen(r.id);
    await screen.findByRole('button', { name: 'Começar reconstrução' }, SLOW);
    expect(screen.queryByText(/Marcada para/)).toBeNull();
  });
});

describe('retest in the lists', () => {
  it('shows "Reconstrução · dd/mm" before the day and "Reconstrução · hoje" from the day on', async () => {
    const o = await original();
    await createRetest(o.id, 3);
    const { unmount } = render(<PracticePanel />);
    expect(await screen.findByText(/Reconstrução · 16\/11/, {}, SLOW)).toBeInTheDocument();
    unmount();
    vi.setSystemTime(new Date(2026, 10, 17, 10, 0));
    render(<PracticeListScreen />);
    expect(await screen.findByText(/Reconstrução · hoje/, {}, SLOW)).toBeInTheDocument();
  });
});

describe('Pistas no histórico (P7)', () => {
  const finished = async (title: string, hints: number, endedAt: number) => {
    const s = await createPracticeSession({ title });
    await updatePractice(s.id, { problem: 'p', code: 'c' });
    for (let i = 0; i < hints; i++) {
      await addPracticeFeedback(s.id, { source: 'ai', text: `pista ${i}` });
    }
    await db.practiceSessions.update(s.id, {
      feedback: (await get(s.id)).feedback.map((f) => ({ ...f, hint: { step: 'code', level: 1 } })),
    });
    await setPracticeRating(s.id, 'delivered', 2);
    await setPracticeRating(s.id, 'understood', 1);
    await setPracticeRating(s.id, 'autonomous', 0);
    await concludePractice(s.id);
    await db.practiceSessions.update(s.id, { endedAt });
    return s;
  };

  it('each closed row shows "Pistas: N" or "Pistas: nenhuma"; the history gets the sentence', async () => {
    await finished('Com pistas', 2, 1000);
    await finished('Sem pistas', 0, 2000);
    render(<PracticeListScreen />);
    const rows = await screen.findAllByRole('link', { name: /Sessão|Com pistas|Sem pistas/ }, SLOW);
    const row = (t: string) => rows.find((r) => r.textContent?.includes(t))!;
    expect(row('Com pistas')).toHaveTextContent('Pistas: 2');
    expect(row('Sem pistas')).toHaveTextContent('Pistas: nenhuma');
    expect(screen.getByText('Pista é parte do método; o que importa é o Autônomo nas reconstruções.')).toBeInTheDocument();
    expect(screen.getByText(/Pistas: 2 nas últimas 2 sessões/)).toBeInTheDocument();
  });
});
