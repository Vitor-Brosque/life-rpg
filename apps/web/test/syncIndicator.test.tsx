import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { StatusStrip } from '../src/features/agora/StatusStrip';
import { useSyncStatus } from '../src/sync/status';
import { ToastHost, useToast } from '../src/ui/Toast';

beforeEach(async () => {
  await db.delete(); await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
  useSyncStatus.setState({ state: 'offline', pending: 2, lastSync: undefined, error: undefined });
});

const mount = () => {
  const { hook } = memoryLocation({ path: '/' });
  return render(<Router hook={hook}><StatusStrip /><ToastHost /></Router>);
};
const toastText = () => document.querySelector('.toast')?.textContent;
const synced = () => useSyncStatus.setState({ state: 'idle', pending: 0, lastSync: new Date(2026, 11, 3, 10, 38).getTime() });

describe('sync indicator', () => {
  it('the message it opened follows the status: "Sem conexão" does not linger after syncing', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /^Sem conexão/ }));
    expect(toastText()).toBe('Sem conexão — tudo fica salvo no aparelho · 2 alterações pendentes');
    act(synced);
    await waitFor(() => expect(toastText()).toBe('Sincronizado às 10:38'));
  });

  it('a message from somewhere else is left alone when the status changes', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /^Sem conexão/ }));
    act(() => useToast.getState().show('Missão concluída · +8 XP'));
    act(synced);
    await screen.findByRole('button', { name: 'Sincronizado às 10:38' });
    expect(toastText()).toBe('Missão concluída · +8 XP');
  });

  it('with no message on screen a status change opens none', async () => {
    mount();
    await screen.findByRole('button', { name: /^Sem conexão/ });
    act(synced);
    await screen.findByRole('button', { name: 'Sincronizado às 10:38' });
    expect(toastText()).toBeUndefined();
  });
});
