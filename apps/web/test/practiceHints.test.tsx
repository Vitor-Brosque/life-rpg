import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HintRequest, PracticeFeedback, PracticeSession } from '@life/shared';
import { db } from '../src/db/db';
import { patch, softDelete } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { addAiHint } from '../src/domain/aiActions';
import { createPracticeSession, updatePractice } from '../src/domain/practiceActions';
import { PracticeScreen } from '../src/features/practice/PracticeScreen';
import { ToastHost } from '../src/ui/Toast';
import { enableAi, fail, mockFetch, ok, resetAi } from './aiFixture';

beforeEach(async () => {
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  resetAi();
});
afterEach(() => { resetAi(); window.history.pushState({}, '', '/'); });

const item = (text: string) => ({ id: text, text, done: false });

async function openSession(over: Partial<PracticeSession> = {}): Promise<string> {
  const s = await createPracticeSession({ title: 'Remover notícias repetidas' });
  await patch<PracticeSession>('practiceSessions', s.id, {
    problem: 'Tirar URLs repetidas', plan: [item('normalizar URL')], code: 'def f(xs):\n    return xs',
    step: 'plan', ...over,
  });
  window.history.pushState({}, '', `/pratica/${s.id}`);
  render(<><PracticeScreen id={s.id} /><ToastHost /></>);
  return s.id;
}
const panel = () => screen.findByRole('region', { name: /Pistas graduais/ });
const noPanel = () => screen.queryByRole('region', { name: /Pistas graduais/ });
const feedbackOf = async (id: string) => (await db.practiceSessions.get(id))!.feedback;
/** The step heading (h2) is on screen: the session loaded. */
const loaded = () => screen.findAllByRole('heading', { level: 2 });

describe('HintPanel visibility', () => {
  it('nothing without AI, or with the aid off', async () => {
    await openSession();
    await loaded();
    expect(noPanel()).toBeNull();
  });

  it('nothing when only another aid is on', async () => {
    await enableAi({ cards: true });
    await openSession();
    await loaded();
    expect(noPanel()).toBeNull();
  });

  it('nothing on Fechar', async () => {
    await enableAi({ hints: true });
    await openSession({ step: 'close' });
    await loaded();
    expect(noPanel()).toBeNull();
  });

  it('nothing on Feedback', async () => {
    await enableAi({ hints: true });
    await openSession({ step: 'feedback' });
    await loaded();
    expect(noPanel()).toBeNull();
  });

  it('paused during a rebuild on Implementar', async () => {
    await enableAi({ hints: true });
    await openSession({ step: 'code', rebuild: { code: '', startedAt: 1 } });
    const p = await panel();
    expect(within(p).getByText('As pistas deste passo ficam pausadas enquanto você reconstrói sem consultar.')).toBeInTheDocument();
    expect(within(p).queryByRole('button')).toBeNull();
    expect(within(p).queryByText('O que é enviado')).toBeNull();
  });
});

describe('asking hints', () => {
  it('1, 2 and 3 in order, each stored as AI feedback', async () => {
    await enableAi({ hints: true });
    const { requests } = mockFetch((r) => ok({ text: `Resposta ${(r.body as HintRequest).level}` }));
    const id = await openSession();
    const p = await panel();

    await userEvent.click(within(p).getByRole('button', { name: 'Pedir pista 1 · pergunta' }));
    await within(p).findByText('Resposta 1');
    expect(requests[0]).toMatchObject({ url: '/api/ai/hint', method: 'POST' });
    expect(requests[0]!.body).toMatchObject({ step: 'plan', level: 1, problem: 'Tirar URLs repetidas', code: '', previous: [] });
    expect(await feedbackOf(id)).toEqual([
      expect.objectContaining({ source: 'ai', text: 'Resposta 1', hint: { step: 'plan', level: 1 } }),
    ]);
    expect(within(p).getByText('Pista 1 · pergunta')).toBeInTheDocument();

    await userEvent.click(await within(p).findByRole('button', { name: 'Pedir pista 2 · direção' }));
    await within(p).findByText('Resposta 2');
    expect(requests[1]!.body).toMatchObject({ level: 2, previous: [{ level: 1, text: 'Resposta 1' }] });

    await userEvent.click(await within(p).findByRole('button', { name: 'Pedir pista 3 · próximo passo' }));
    await within(p).findByText('Resposta 3');
    expect(await within(p).findByText(/As três pistas deste passo já vieram/)).toBeInTheDocument();
    expect(within(p).queryByRole('button', { name: /Pedir pista/ })).toBeNull();
    expect(await feedbackOf(id)).toHaveLength(3);
    // The button that was used is gone: focus is not left on <body>.
    await waitFor(() => expect(document.activeElement).toBe(within(p).getByRole('heading', { name: /Pistas graduais/ })));
  });

  it('waits with a disabled "Pensando…" button and a status', async () => {
    await enableAi({ hints: true });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mockFetch(async () => { await gate; return ok({ text: 'Veio' }); });
    await openSession();
    const p = await panel();
    await userEvent.click(within(p).getByRole('button', { name: 'Pedir pista 1 · pergunta' }));
    expect(await within(p).findByRole('button', { name: 'Pensando…' })).toBeDisabled();
    expect(within(p).getByRole('status')).toHaveTextContent('Pedindo a pista 1…');
    release();
    await within(p).findByText('Veio');
    expect(within(p).getByRole('status')).toHaveTextContent('');
  });

  it('asking does not move the step, nextAction or XP', async () => {
    await enableAi({ hints: true });
    mockFetch(() => ok({ text: 'ok' }));
    const id = await openSession();
    const before = await db.practiceSessions.get(id);
    const xp = await db.xpEvents.count();
    await userEvent.click(within(await panel()).getByRole('button', { name: 'Pedir pista 1 · pergunta' }));
    await waitFor(async () => expect(await feedbackOf(id)).toHaveLength(1));
    const after = (await db.practiceSessions.get(id))!;
    expect(after.step).toBe(before!.step);
    expect(after.nextAction).toBe(before!.nextAction);
    expect(await db.xpEvents.count()).toBe(xp);
  });

  it('the code step sends the implementation', async () => {
    await enableAi({ hints: true });
    const { requests } = mockFetch(() => ok({ text: 'ok' }));
    await openSession({ step: 'code' });
    await userEvent.click(within(await panel()).getByRole('button', { name: 'Pedir pista 1 · pergunta' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect((requests[0]!.body as HintRequest).code).toBe('def f(xs):\n    return xs');
  });

  it('"O que é enviado" shows the request, without errors or feedback', async () => {
    await enableAi({ hints: true });
    await openSession({
      errors: [{ id: 'e', at: 1, what: 'o loop parou cedo', why: '', fix: '' }],
      feedback: [{ id: 'f', at: 1, source: 'person', text: 'Fulano sugeriu set' }],
    });
    const p = await panel();
    await userEvent.click(within(p).getByText('O que é enviado'));
    const pre = p.querySelector('pre')!;
    expect(pre.textContent).toContain('## Problema\nTirar URLs repetidas');
    expect(pre.textContent).toContain('Dê agora a pista 1 (pergunta) sobre o passo "Decompor".');
    expect(pre.textContent).not.toContain('o loop parou cedo');
    expect(pre.textContent).not.toContain('Fulano');
  });

  it('says a hint never hands over the full solution', async () => {
    await enableAi({ hints: true });
    await openSession();
    expect(await within(await panel()).findByText(/Nenhuma entrega a solução/)).toBeInTheDocument();
  });

  it('an error is one kind sentence and stores nothing; it goes away on asking again', async () => {
    await enableAi({ hints: true });
    let n = 0;
    mockFetch(() => (n++ === 0 ? fail(429, 'daily_limit') : ok({ text: 'Agora foi' })));
    const id = await openSession();
    const p = await panel();
    await userEvent.click(within(p).getByRole('button', { name: 'Pedir pista 1 · pergunta' }));
    expect(await within(p).findByRole('alert')).toHaveTextContent(
      'Os pedidos de hoje acabaram. Amanhã tem mais, e o app segue funcionando sem a IA.');
    expect(await feedbackOf(id)).toEqual([]);
    await userEvent.click(within(p).getByRole('button', { name: 'Pedir pista 1 · pergunta' }));
    await within(p).findByText('Agora foi');
    expect(within(p).queryByRole('alert')).toBeNull();
  });

  it('the error goes away when the step changes', async () => {
    await enableAi({ hints: true });
    mockFetch(() => fail(429, 'daily_limit'));
    await openSession();
    const p = await panel();
    await userEvent.click(within(p).getByRole('button', { name: 'Pedir pista 1 · pergunta' }));
    await within(p).findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: /^Próximo:/ }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('with Feedback full the hint shows but is not stored', async () => {
    await enableAi({ hints: true });
    mockFetch(() => ok({ text: 'Pista que não coube' }));
    const full: PracticeFeedback[] = Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, at: i, source: 'person', text: `t${i}` }));
    const id = await openSession({ feedback: full });
    const p = await panel();
    await userEvent.click(within(p).getByRole('button', { name: 'Pedir pista 1 · pergunta' }));
    await within(p).findByText('Pista que não coube');
    expect(within(p).getByText('O Feedback desta sessão está cheio (20 entradas); esta pista não foi guardada.')).toBeInTheDocument();
    expect(await feedbackOf(id)).toHaveLength(20);
  });

  it('the Feedback step labels AI hints', async () => {
    await enableAi({ hints: true });
    await openSession({
      step: 'feedback',
      feedback: [{ id: 'h', at: Date.now(), source: 'ai', text: 'Olhe a URL.', hint: { step: 'plan', level: 2 } }],
    });
    expect(await screen.findByText(/IA · Pista 2 · Decompor/)).toBeInTheDocument();
  });
});

describe('addAiHint', () => {
  it('appends over the stored copy, keeping other edits', async () => {
    const s = await createPracticeSession({ title: 'x' });
    await updatePractice(s.id, { problem: 'novo problema' });
    expect(await addAiHint(s.id, { step: 'plan', level: 1, text: '  dica  ' })).toBe('saved');
    const stored = (await db.practiceSessions.get(s.id))!;
    expect(stored.problem).toBe('novo problema');
    expect(stored.feedback).toEqual([expect.objectContaining({ source: 'ai', text: 'dica', hint: { step: 'plan', level: 1 } })]);
  });

  it('clips the text to the Feedback limit', async () => {
    const s = await createPracticeSession({ title: 'x' });
    await addAiHint(s.id, { step: 'plan', level: 1, text: 'a'.repeat(1500) });
    expect((await feedbackOf(s.id))[0]!.text).toHaveLength(1000);
  });

  it('is "missing" for an unknown or deleted session', async () => {
    expect(await addAiHint('nope', { step: 'plan', level: 1, text: 'x' })).toBe('missing');
    const s = await createPracticeSession({ title: 'x' });
    await softDelete('practiceSessions', s.id);
    expect(await addAiHint(s.id, { step: 'plan', level: 1, text: 'x' })).toBe('missing');
  });
});
