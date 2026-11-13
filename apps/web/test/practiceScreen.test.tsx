import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Journey } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { newRecord, put } from '../src/db/repo';
import { createMission } from '../src/domain/actions';
import { createPracticeSession, editPracticeList, startRebuild, updatePractice } from '../src/domain/practiceActions';
import { useMissionSheet } from '../src/features/mission/MissionSheet';
import { PauseSheet } from '../src/features/practice/PauseSheet';
import { PracticeScreen } from '../src/features/practice/PracticeScreen';
import { normalizePractice } from '@life/shared';
import { ToastHost, useToast } from '../src/ui/Toast';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
  useMissionSheet.getState().close();
  useToast.getState().dismiss();
});
afterEach(() => { vi.useRealTimers(); window.history.pushState({}, '', '/'); });

const get = async (id: string) => (await db.practiceSessions.get(id))!;
const renderAt = (id: string, voltar = '/estudo/praticas') => {
  window.history.pushState({}, '', `/pratica/${id}?voltar=${encodeURIComponent(voltar)}`);
  return render(<><PracticeScreen id={id} /><ToastHost /></>);
};
const stepHeading = (name: string) => screen.findByRole('heading', { level: 2, name });

describe('PracticeScreen', () => {
  it('opens at the stored step, with nine steps and the filled marks', async () => {
    const s = await createPracticeSession({ title: 'Dedup' });
    await updatePractice(s.id, { problem: 'remover repetidas', step: 'plan' });
    renderAt(s.id);
    await stepHeading('Decompor');
    const nav = screen.getByRole('navigation', { name: 'Passos da sessão' });
    expect(within(nav).getAllByRole('button')).toHaveLength(9);
    expect(within(nav).getByRole('button', { name: 'Passo 1: Problema, preenchido' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Passo 3: Decompor' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('textbox', { name: 'Título da sessão' })).toHaveValue('Dedup');
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeInTheDocument();
  });

  it('texts save; Próximo, Ctrl+Enter, the strip and Anterior move and store the step', async () => {
    const user = userEvent.setup();
    const s = await createPracticeSession({ title: 'Dedup' });
    renderAt(s.id);
    await stepHeading('Problema');
    await user.type(screen.getByLabelText('Qual é o problema?'), 'remover notícias repetidas');
    await user.type(screen.getByLabelText('Entradas'), 'JSON da API');
    await user.tab();
    await waitFor(async () => expect(await get(s.id)).toMatchObject({ problem: 'remover notícias repetidas', inputs: 'JSON da API' }));
    await user.click(screen.getByRole('button', { name: 'Próximo: Fundamentos' }));
    expect(await stepHeading('Fundamentos')).toHaveFocus();
    await waitFor(async () => expect((await get(s.id)).step).toBe('basics'));
    fireEvent.keyDown(screen.getByRole('heading', { level: 2, name: 'Fundamentos' }), { key: 'Enter', ctrlKey: true });
    await stepHeading('Decompor');
    await user.click(screen.getByRole('button', { name: /^Passo 6: Testar/ }));
    await stepHeading('Testar');
    await user.click(screen.getByRole('button', { name: 'Anterior: Implementar' }));
    await stepHeading('Implementar');
    await waitFor(async () => expect((await get(s.id)).step).toBe('code'));
  });

  it('lists edit in place; the plan becomes a checklist in Implementar', async () => {
    const user = userEvent.setup();
    const s = await createPracticeSession({ title: 'Dedup' });
    await updatePractice(s.id, { step: 'plan' });
    renderAt(s.id);
    await stepHeading('Decompor');
    expect(screen.getByText('Para desenhar o fluxo, use a Lousa, no topo.')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Novo passo' }), 'normalizar URL{Enter}gravar{Enter}');
    await waitFor(async () => expect((await get(s.id)).plan.map((p) => p.text)).toEqual(['normalizar URL', 'gravar']));
    await user.click(screen.getByRole('button', { name: /^Passo 5: Implementar/ }));
    await user.click(await screen.findByRole('checkbox', { name: 'Feito: normalizar URL' }));
    await waitFor(async () => expect((await get(s.id)).plan[0]!.done).toBe(true));
  });

  it('Implementar: language and code save; without steps it points to Decompor', async () => {
    const user = userEvent.setup();
    const s = await createPracticeSession({ title: 'Dedup' });
    await updatePractice(s.id, { step: 'code' });
    renderAt(s.id);
    await stepHeading('Implementar');
    expect(screen.getByText(/Sem passos ainda\. Decompor ajuda a saber por onde começar\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'SQL' }));
    await waitFor(async () => expect((await get(s.id)).language).toBe('sql'));
    await user.type(screen.getByLabelText('Sua implementação'), 'SELECT 1;');
    await user.keyboard('{Escape}'); // Esc leaves the code editor (blur saves)
    await waitFor(async () => expect((await get(s.id)).code).toBe('SELECT 1;'));
    await user.click(screen.getByRole('button', { name: 'Ir para Decompor' }));
    await stepHeading('Decompor');
  });

  it('during an uncompared rebuild the implementation hides; Mostrar mesmo assim records the peek', async () => {
    const user = userEvent.setup();
    const s = await createPracticeSession({ title: 'Dedup' });
    await updatePractice(s.id, { code: 'def f(): pass', step: 'code' });
    await startRebuild(s.id);
    renderAt(s.id);
    await stepHeading('Implementar');
    expect(screen.getByText('Implementação escondida enquanto você reconstrói.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sua implementação')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Mostrar mesmo assim' }));
    expect(await screen.findByLabelText('Sua implementação')).toHaveValue('def f(): pass');
    expect((await get(s.id)).rebuild!.peeked).toBe(true);
  });

  it('Testar: cases with "Passou"', async () => {
    const user = userEvent.setup();
    const s = await createPracticeSession({ title: 'Dedup' });
    await updatePractice(s.id, { step: 'test' });
    renderAt(s.id);
    await stepHeading('Testar');
    await user.type(screen.getByRole('textbox', { name: 'Novo caso' }), 'lista vazia → nada gravado{Enter}');
    await user.click(await screen.findByRole('checkbox', { name: 'Passou: lista vazia → nada gravado' }));
    await waitFor(async () => expect((await get(s.id)).tests).toEqual([expect.objectContaining({ text: 'lista vazia → nada gravado', done: true })]));
  });

  it('Pausar: the suggestion, the note saved, back to voltar; reopening shows "Onde você parou"', async () => {
    const user = userEvent.setup();
    const s = await createPracticeSession({ title: 'Dedup' });
    await updatePractice(s.id, { problem: 'p' });
    await editPracticeList(s.id, 'plan', () => [{ id: 'a', text: 'normalizar URL', done: false }]);
    const { unmount } = renderAt(s.id, '/');
    await user.click(await screen.findByRole('button', { name: 'Pausar' }));
    const field = await screen.findByRole('textbox', { name: 'Onde parou? Qual a primeira ação da próxima vez?' });
    expect(field).toHaveValue('Continuar: normalizar URL');
    await user.clear(field);
    await user.type(field, 'testar com 2 fontes{Enter}');
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect((await get(s.id)).nextAction).toBe('testar com 2 fontes');
    unmount();
    renderAt(s.id);
    expect(await screen.findByRole('note', { name: 'Onde você parou' })).toHaveTextContent('testar com 2 fontes');
  });

  it('Lousa opens the session lousa with the way back', async () => {
    const user = userEvent.setup();
    const s = await createPracticeSession({ title: 'Dedup' });
    renderAt(s.id);
    await user.click(await screen.findByRole('button', { name: 'Lousa' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/lousa/sketch-p-${s.id}`));
    expect(new URLSearchParams(window.location.search).get('voltar')).toBe(`/pratica/${s.id}?voltar=%2Festudo%2Fpraticas`);
    expect(await db.sketches.get(`sketch-p-${s.id}`)).toMatchObject({ practiceId: s.id, title: 'Lousa · Dedup' });
  });

  it('the mission opens its sheet; a renamed title saves, a blanked one comes back', async () => {
    const user = userEvent.setup();
    await put('journeys', newRecord<Journey>({ id: 'j-tech', title: 'Tech News', status: 'active', order: 0 }));
    const m = await createMission({ title: 'Segunda fonte', journeyId: 'j-tech' });
    const s = await createPracticeSession({ title: 'Dedup', journeyId: 'j-tech', missionId: m.id });
    renderAt(s.id);
    await user.click(await screen.findByRole('button', { name: 'Missão: Segunda fonte' }));
    expect(useMissionSheet.getState().openId).toBe(m.id);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Missão: Segunda fonte' }).parentElement)
      .toHaveTextContent('Tech News · Missão: Segunda fonte'));
    const title = screen.getByRole('textbox', { name: 'Título da sessão' });
    await user.clear(title);
    await user.tab();
    expect(title).toHaveValue('Dedup');
    await user.type(title, ' por URL{Enter}');
    await waitFor(async () => expect((await get(s.id)).title).toBe('Dedup por URL'));
  });

  it('Apagar sessão goes back and offers Desfazer; an unknown id says so', async () => {
    const user = userEvent.setup();
    const s = await createPracticeSession({ title: 'Dedup' });
    const { unmount } = renderAt(s.id, '/estudo');
    await user.click(await screen.findByRole('button', { name: 'Apagar sessão' }));
    await waitFor(() => expect(window.location.pathname).toBe('/estudo'));
    expect((await get(s.id)).deleted).toBe(true);
    await user.click(await screen.findByRole('button', { name: 'Desfazer' }));
    await waitFor(async () => expect((await get(s.id)).deleted).toBe(false));
    unmount();
    render(<PracticeScreen id="nope" />);
    expect(await screen.findByRole('heading', { name: 'Sessão não encontrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver sessões' })).toHaveAttribute('href', '/estudo/praticas');
  });
});

describe('PracticeScreen details', () => {
  it('a step edited and left with Ctrl+Enter (no blur) is still saved', async () => {
    const s = await createPracticeSession({ title: 'Dedup' });
    await updatePractice(s.id, { step: 'plan' });
    await editPracticeList(s.id, 'plan', () => [{ id: 'a', text: 'Passo 1', done: false }]);
    renderAt(s.id);
    await stepHeading('Decompor');
    const input = await screen.findByRole('textbox', { name: 'Passo 1' });
    fireEvent.change(input, { target: { value: 'Passo 1 revisado' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    await stepHeading('Decisões');
    await waitFor(async () => expect((await get(s.id)).plan).toEqual([expect.objectContaining({ id: 'a', text: 'Passo 1 revisado' })]));
  });

  it('the current step is scrolled into view in the strip', async () => {
    const user = userEvent.setup();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      const s = await createPracticeSession({ title: 'Dedup' });
      renderAt(s.id);
      await stepHeading('Problema');
      scroll.mockClear();
      await user.click(screen.getByRole('button', { name: /^Passo 6: Testar/ }));
      await stepHeading('Testar');
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

describe('PauseSheet prefill', () => {
  it('follows the stored note until the user types', async () => {
    const user = userEvent.setup();
    const base = normalizePractice(await createPracticeSession({ title: 'Dedup' }));
    const label = 'Onde parou? Qual a primeira ação da próxima vez?';
    const { rerender } = render(<PauseSheet open session={base} onClose={() => {}} onPaused={() => {}} />);
    const field = await screen.findByRole('textbox', { name: label });
    rerender(<PauseSheet open session={{ ...base, nextAction: 'ligar a segunda fonte' }} onClose={() => {}} onPaused={() => {}} />);
    expect(field).toHaveValue('ligar a segunda fonte');
    await user.type(field, '!');
    rerender(<PauseSheet open session={{ ...base, nextAction: 'outra' }} onClose={() => {}} onPaused={() => {}} />);
    expect(field).toHaveValue('ligar a segunda fonte!');
  });
});

