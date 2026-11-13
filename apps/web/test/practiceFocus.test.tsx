import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PracticePatch } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { createPracticeSession, setPracticeRating, startRebuild, updatePractice } from '../src/domain/practiceActions';
import { PracticeScreen } from '../src/features/practice/PracticeScreen';
import { ToastHost, useToast } from '../src/ui/Toast';

// Focus must not fall back to <body> when the button that was used goes away or is replaced.

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
});
afterEach(() => { vi.useRealTimers(); window.history.pushState({}, '', '/'); });

const TITLE = { feedback: 'Feedback', rebuild: 'Reconstruir sem consulta', close: 'Fechar' } as const;
const openAt = async (step: keyof typeof TITLE, fields: PracticePatch = {}, prepare?: (id: string) => Promise<void>) => {
  const s = await createPracticeSession({ title: 'Dedup' });
  await updatePractice(s.id, { step, ...fields });
  await prepare?.(s.id);
  window.history.pushState({}, '', `/pratica/${s.id}`);
  render(<><PracticeScreen id={s.id} /><ToastHost /></>);
  return { s, title: await screen.findByRole('heading', { level: 2, name: TITLE[step] }) };
};
const SLOW = { timeout: 4000 };

describe('focus in the practice steps', () => {
  it('"Começar reconstrução" moves focus to the step title', async () => {
    const user = userEvent.setup();
    const { title } = await openAt('rebuild', { code: 'x = 1' });
    await user.click(screen.getByRole('button', { name: 'Começar reconstrução' }));
    await screen.findByLabelText('Reconstrução');
    await waitFor(() => expect(title).toHaveFocus(), SLOW);
  });

  it('"Comparar" moves focus to the step title', async () => {
    const user = userEvent.setup();
    const { title } = await openAt('rebuild', { code: 'x = 1' }, async (id) => { await startRebuild(id); });
    await user.type(await screen.findByLabelText('Reconstrução'), 'x = 1');
    await user.click(screen.getByRole('button', { name: 'Comparar com a implementação' }));
    await screen.findByRole('region', { name: 'Sua reconstrução' }, SLOW);
    await waitFor(() => expect(title).toHaveFocus(), SLOW);
  });

  it('"Refazer" opens the confirmation on "Cancelar"; "Cancelar" and "Sim, refazer" end on the title', async () => {
    const user = userEvent.setup();
    const { title } = await openAt('rebuild', { code: 'x = 1' }, async (id) => {
      await startRebuild(id);
      await updatePractice(id, { rebuild: { code: 'x', startedAt: 1, comparedAt: 2 } });
    });
    await user.click(await screen.findByRole('button', { name: 'Refazer reconstrução' }, SLOW));
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(title).toHaveFocus(), SLOW);
    await user.click(screen.getByRole('button', { name: 'Refazer reconstrução' }));
    await user.click(screen.getByRole('button', { name: 'Sim, refazer' }));
    await screen.findByLabelText('Reconstrução');
    await waitFor(() => expect(title).toHaveFocus(), SLOW);
  });

  it('"Encerrar sessão" and "Reabrir sessão" move focus to the step title', async () => {
    const user = userEvent.setup();
    const { title } = await openAt('close', { code: 'x = 1' }, async (id) => {
      await setPracticeRating(id, 'delivered', 2);
      await setPracticeRating(id, 'understood', 1);
      await setPracticeRating(id, 'autonomous', 1);
    });
    await user.click(screen.getByRole('button', { name: 'Encerrar sessão' }));
    await screen.findByRole('button', { name: 'Reabrir sessão' }, SLOW);
    await waitFor(() => expect(title).toHaveFocus(), SLOW);
    await user.click(screen.getByRole('button', { name: 'Reabrir sessão' }));
    await screen.findByRole('button', { name: 'Encerrar sessão' }, SLOW);
    await waitFor(() => expect(title).toHaveFocus(), SLOW);
  });

  it('adding feedback returns focus to the text field', async () => {
    const user = userEvent.setup();
    await openAt('feedback');
    const field = screen.getByLabelText('O que disseram?');
    await user.type(field, 'use um set');
    await user.click(screen.getByRole('button', { name: 'Adicionar feedback' }));
    await screen.findByText('use um set', { selector: 'p' }, SLOW);
    await waitFor(() => expect(field).toHaveFocus(), SLOW);
  });
});
