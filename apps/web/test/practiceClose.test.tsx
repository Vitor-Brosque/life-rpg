import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PracticePatch } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { createPracticeSession, startRebuild, updatePractice } from '../src/domain/practiceActions';
import { PHRASES } from '../src/features/companion/phrases';
import { useCompanion } from '../src/features/companion/store';
import { PracticeScreen } from '../src/features/practice/PracticeScreen';
import { ToastHost, useToast } from '../src/ui/Toast';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
  useCompanion.getState().clear();
});
afterEach(() => { vi.useRealTimers(); window.history.pushState({}, '', '/'); });

const get = async (id: string) => (await db.practiceSessions.get(id))!;
const practiceXp = async () => (await db.xpEvents.toArray()).filter((x) => !x.deleted && x.reason === 'practice');
const TITLE = { feedback: 'Feedback', rebuild: 'Reconstruir sem consulta', close: 'Fechar' } as const;
const openAt = async (step: keyof typeof TITLE, fields: PracticePatch = {}) => {
  const s = await createPracticeSession({ title: 'Dedup' });
  await updatePractice(s.id, { step, ...fields });
  window.history.pushState({}, '', `/pratica/${s.id}`);
  render(<><PracticeScreen id={s.id} /><ToastHost /></>);
  await screen.findByRole('heading', { level: 2, name: TITLE[step] });
  return s;
};
const group = (name: RegExp) => screen.getByRole('group', { name });

describe('Feedback', () => {
  it('adds with its source, lists and removes', async () => {
    const user = userEvent.setup();
    const s = await openAt('feedback');
    const add = screen.getByRole('button', { name: 'Adicionar feedback' });
    expect(add).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'IA' }));
    await user.type(screen.getByLabelText('O que disseram?'), 'use um set para as URLs');
    await user.click(add);
    expect(await screen.findByText('use um set para as URLs')).toBeInTheDocument();
    expect(screen.getByText('IA · agora')).toBeInTheDocument();
    expect(screen.getByLabelText('O que disseram?')).toHaveValue('');
    expect((await get(s.id)).feedback).toEqual([expect.objectContaining({ source: 'ai', text: 'use um set para as URLs' })]);
    await user.click(screen.getByRole('button', { name: 'Remover feedback: use um set para as URLs' }));
    await waitFor(async () => expect((await get(s.id)).feedback).toEqual([]));
  });
});

describe('Reconstruir', () => {
  it('without code points to Implementar; then start, compare side by side (+5) and redo', async () => {
    const user = userEvent.setup();
    const s = await openAt('rebuild');
    expect(screen.getByText('Implemente primeiro; depois reconstrua sem consultar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir para Implementar' })).toBeInTheDocument();
    await updatePractice(s.id, { code: 'def dedup(xs):\n    return list(set(xs))' });
    await user.click(await screen.findByRole('button', { name: 'Começar reconstrução' }));
    const editor = await screen.findByLabelText('Reconstrução');
    expect(screen.queryByText(/return list\(set/)).toBeNull();
    await user.type(editor, 'def dedup(xs):');
    await user.click(screen.getByRole('button', { name: 'Comparar com a implementação' }));
    expect(await screen.findByText('Reconstrução comparada · +5 XP')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sua reconstrução' })).toHaveTextContent('def dedup(xs):');
    expect(screen.getByRole('region', { name: 'Implementação' })).toHaveTextContent('return list(set(xs))');
    expect(screen.getByText('1 linha na reconstrução, 2 na implementação. O que faltou? Registre como erro para virar card.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reconstrução')).toBeNull();
    expect((await get(s.id)).rebuild).toMatchObject({ code: 'def dedup(xs):', comparedAt: expect.any(Number) });
    expect((await practiceXp()).map((x) => x.amount)).toEqual([5]);
    await user.click(screen.getByRole('button', { name: 'Refazer reconstrução' }));
    expect(screen.getByText('Apagar a reconstrução atual e começar de novo?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sim, refazer' }));
    expect(await screen.findByLabelText('Reconstrução')).toHaveValue('');
  });
});

describe('Fechar', () => {
  it('ratings save at once; the alert; Encerrar (+10) and Reabrir without a second award', async () => {
    const user = userEvent.setup();
    const s = await openAt('close', { problem: 'remover repetidas', code: 'x = 1' });
    expect(screen.getByText('Reconstrução: não feita nesta sessão.')).toBeInTheDocument();
    expect(screen.getByText('Os três ficam separados e não valem XP: servem para você ver a tendência com honestidade.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Encerrar sessão' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Escolha uma opção em cada indicador.');
    await user.click(within(group(/^Entregue/)).getByRole('radio', { name: 'Parcial' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await user.type(screen.getByLabelText('Explique em 2 frases o que você fez e por que funciona'), 'Uso um set. Ele ignora repetidas.');
    await user.click(within(group(/^Compreendido/)).getByRole('radio', { name: 'Em parte' }));
    await user.click(within(group(/^Autônomo/)).getByRole('radio', { name: 'Não' }));
    await waitFor(async () => expect((await get(s.id)).ratings).toEqual({ delivered: 1, understood: 1, autonomous: 0 }));
    await waitFor(async () => expect((await get(s.id)).explanation).toBe('Uso um set. Ele ignora repetidas.'));
    await user.type(screen.getByLabelText('Primeira ação da próxima sessão (opcional)'), 'ligar a segunda fonte');
    await user.click(screen.getByRole('button', { name: 'Encerrar sessão' }));
    expect(await screen.findByText('Sessão encerrada · +10 XP')).toBeInTheDocument();
    await waitFor(() => expect(PHRASES.practiceDone).toContain(useCompanion.getState().message));
    expect(await screen.findByText('Sessão encerrada em 13/11.')).toBeInTheDocument();
    await waitFor(async () => expect(await get(s.id)).toMatchObject({ status: 'done', nextAction: 'ligar a segunda fonte' }));
    expect(screen.getByText('Encerrada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Reabrir sessão' }));
    await user.click(await screen.findByRole('button', { name: 'Encerrar sessão' }));
    expect(await screen.findByText('Sessão encerrada')).toBeInTheDocument();
    expect(await practiceXp()).toHaveLength(1);
  });

  it('shows what the rebuild recorded', async () => {
    const s = await openAt('close', { code: 'a\nb' });
    await startRebuild(s.id);
    expect(await screen.findByText('Reconstrução: começada, ainda sem comparar.')).toBeInTheDocument();
  });
});
