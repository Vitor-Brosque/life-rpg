import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mission, Profile } from '@life/shared';
import { App } from '../src/app/App';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { getMeta, patch } from '../src/db/repo';
import { useCompanion } from '../src/features/companion/store';
import { Onboarding } from '../src/features/onboarding/Onboarding';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 10, 20).getTime());
  await db.delete();
  await db.open();
  await ensureSeed();
  useCompanion.getState().clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('Onboarding', () => {
  it('name → skip look → two ideas → choose one: onboarded, 2 missions, chosen first today', async () => {
    const user = userEvent.setup();
    render(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Começar do zero' }));

    await user.type(await screen.findByLabelText('Como devo te chamar?'), 'Vitor');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    const box = await screen.findByLabelText('O que está ocupando sua cabeça agora? Uma ideia por linha.');
    await user.type(box, 'Lavar a louça{Enter}Responder o email');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    const group = await screen.findByRole('radiogroup', { name: 'Qual delas dá para começar em 5 minutos?' });
    await user.click(within(group).getByRole('radio', { name: 'Responder o email' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    await waitFor(async () => expect((await db.profile.get('me'))?.onboarded).toBe(true));
    const profile = (await db.profile.get('me'))!;
    expect(profile.name).toBe('Vitor');
    const missions = (await db.missions.toArray()).filter((m) => !m.deleted);
    expect(missions.map((m) => m.title).sort()).toEqual(['Lavar a louça', 'Responder o email']);
    const chosen = missions.find((m) => m.title === 'Responder o email') as Mission;
    expect(chosen.dayOrder).toBe(0);
    expect(chosen.date).toBe('2026-11-11');
    expect(useCompanion.getState().message).toBe('Oi, Vitor! Eu sou Faísca. Vou te mostrar um passo de cada vez.');
  });

  it('every step can be skipped and it still finishes offline', async () => {
    const user = userEvent.setup();
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    render(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Começar do zero' }));
    await user.click(await screen.findByRole('button', { name: 'Pular' }));
    await screen.findByLabelText('O que está ocupando sua cabeça agora? Uma ideia por linha.');
    await user.click(screen.getByRole('button', { name: 'Pular' }));
    await waitFor(async () => expect((await db.profile.get('me'))?.onboarded).toBe(true));
    expect(await db.missions.count()).toBe(0);
    expect(f).not.toHaveBeenCalled();
    expect(useCompanion.getState().message).toBe('Oi! Eu sou Faísca. Vou te mostrar um passo de cada vez.');
  });

  it('shows progress dots for the current step', async () => {
    const user = userEvent.setup();
    render(<Onboarding />);
    expect(await screen.findByText('Passo 1 de 4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Começar do zero' }));
    expect(await screen.findByText('Passo 2 de 4')).toBeInTheDocument();
  });

  it('access code: invalid and offline answers are explained', async () => {
    const user = userEvent.setup();
    render(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Já uso em outro aparelho' }));
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
    await user.type(screen.getByLabelText('Código de acesso'), 'errado');
    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByText('Código inválido')).toBeInTheDocument();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByText('Sem conexão com o servidor')).toBeInTheDocument();
    expect(await getMeta('syncToken')).toBeUndefined();
  });

  it('access code: a synced profile that is not onboarded continues to step 1 with its name', async () => {
    const user = userEvent.setup();
    const remote = { ...(await db.profile.get('me'))!, name: 'Ana', updatedAt: 5000, onboarded: false };
    vi.stubGlobal('fetch', vi.fn(async () => json({ cursor: 3, changes: [{ table: 'profile', record: remote }] })));
    render(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Já uso em outro aparelho' }));
    await user.type(screen.getByLabelText('Código de acesso'), 'tok');
    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByLabelText('Como devo te chamar?')).toHaveValue('Ana');
    expect(await getMeta('syncToken')).toBe('tok');
  });

  it('access code: a failed first download stays on the code step and says so', async () => {
    const user = userEvent.setup();
    // The code is accepted, then the download itself fails (connection dropped).
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls === 1) return json({ cursor: 0, changes: [] });
      throw new TypeError('network');
    }));
    render(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Já uso em outro aparelho' }));
    await user.type(screen.getByLabelText('Código de acesso'), 'tok');
    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByText('Não consegui baixar seus dados. Tente de novo.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Seu personagem' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Código de acesso')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conectar' })).toBeEnabled();
    expect((await db.profile.get('me'))?.onboarded).toBeFalsy();
  });

  it('the appearance radios are named after their visible labels', async () => {
    const user = userEvent.setup();
    render(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Começar do zero' }));
    await screen.findByLabelText('Como devo te chamar?');
    const named = (group: string, name: string) =>
      within(screen.getByRole('group', { name: group })).getByRole('radio', { name });
    expect(named('Tom de pele', 'Clara')).toHaveAttribute('aria-label', 'Clara');
    expect(named('Cabelo', 'Curto')).toHaveAttribute('aria-label', 'Curto');
    expect(named('Cor do cabelo', 'Ruivo')).toHaveAttribute('aria-label', 'Ruivo');
    expect(named('Cor da roupa', 'Azul')).toHaveAttribute('aria-label', 'Azul');
    expect(screen.getAllByRole('radio').every((r) => r.getAttribute('aria-label'))).toBe(true);
  });
});

describe('App gate', () => {
  it('renders the onboarding instead of the app while not onboarded', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Começar do zero' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Navegação principal' })).not.toBeInTheDocument();
  });

  it('renders the app once onboarded', async () => {
    await patch<Profile>('profile', 'me', { onboarded: true });
    render(<App />);
    expect(await screen.findByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Começar do zero' })).not.toBeInTheDocument();
  });

  it('leaves the onboarding by itself when the synced profile is already onboarded', async () => {
    const user = userEvent.setup();
    const remote = { ...(await db.profile.get('me'))!, name: 'Vitor', updatedAt: 5000, onboarded: true };
    vi.stubGlobal('fetch', vi.fn(async () => json({ cursor: 3, changes: [{ table: 'profile', record: remote }] })));
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Já uso em outro aparelho' }));
    await user.type(screen.getByLabelText('Código de acesso'), 'tok');
    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument();
  });
});
