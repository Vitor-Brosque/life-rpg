import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Profile, XpEvent } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, patch, put, setMeta } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { CharacterScreen } from '../src/features/character/CharacterScreen';
import { LookFields, draftFromProfile, unlockHint } from '../src/features/character/LookEditor';

const NOW = new Date(2026, 10, 13, 10, 0).getTime();

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => {
  vi.useRealTimers();
});

const addXp = (amount: number, fields: Partial<XpEvent> = {}) =>
  put('xpEvents', newRecord<XpEvent>({ at: NOW - 60_000, amount, reason: 'complete', dayKey: '2026-11-13', ...fields }));

function renderCharacter() {
  const { hook } = memoryLocation({ path: '/personagem' });
  return render(<Router hook={hook}><CharacterScreen /></Router>);
}

async function openEditor() {
  const user = userEvent.setup();
  renderCharacter();
  await user.click(await screen.findByRole('button', { name: 'Editar aparência' }));
  const dialog = await screen.findByRole('dialog', { name: 'Editar aparência' });
  return { user, dialog, outfit: within(dialog).getByRole('group', { name: 'Cor da roupa' }) };
}

describe('unlockable outfit colours', () => {
  it('at level 1 the four new colours are locked and say which level frees them', async () => {
    const { outfit, dialog } = await openEditor();
    await waitFor(() => expect(within(outfit).getAllByRole('radio')).toHaveLength(10));
    expect(within(outfit).getByRole('radio', { name: 'Esmeralda, libera no nível 5' })).toBeDisabled();
    expect(within(outfit).getByRole('radio', { name: 'Dourado, libera no nível 20' })).toBeDisabled();
    expect(within(outfit).getByRole('radio', { name: 'Ardósia' })).toBeEnabled();
    expect(within(dialog).getByText('Mais cores chegam nos níveis 5, 8, 12 e 20.')).toBeInTheDocument();
  });

  it('at total level 5 Esmeralda can be chosen and saved', async () => {
    await addXp(280);   // total level 5
    const { user, outfit, dialog } = await openEditor();
    const esmeralda = await within(outfit).findByRole('radio', { name: 'Esmeralda' });
    expect(esmeralda).toBeEnabled();
    expect(within(dialog).getByText('Mais cores chegam nos níveis 8, 12 e 20.')).toBeInTheDocument();
    await user.click(esmeralda);
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect((await db.profile.get('me'))?.look.outfit).toBe(6));
  });

  it('the saved colour stays available after the preview moved to another one', async () => {
    const me = (await db.profile.get('me'))!;
    await patch<Profile>('profile', 'me', { look: { ...me.look, outfit: 9 } });
    const { user, outfit } = await openEditor();
    await user.click(await within(outfit).findByRole('radio', { name: 'Ardósia' }));
    const dourado = within(outfit).getByRole('radio', { name: 'Dourado' });
    expect(dourado).toBeEnabled();
    expect(dourado).not.toBeChecked();
    await user.click(dourado);
    expect(within(outfit).getByRole('radio', { name: 'Dourado' })).toBeChecked();
  });

  it('the current colour is never shown as locked, even above the level', async () => {
    const me = (await db.profile.get('me'))!;
    await patch<Profile>('profile', 'me', { look: { ...me.look, outfit: 9 } });
    const { outfit, dialog } = await openEditor();
    expect(await within(outfit).findByRole('radio', { name: 'Dourado' })).toBeChecked();
    expect(within(dialog).getByText('Mais cores chegam nos níveis 5, 8 e 12.')).toBeInTheDocument();
  });

  it('first access (no level) shows only the six base colours, without a hint', () => {
    render(<LookFields value={draftFromProfile()} onChange={() => {}} />);
    expect(within(screen.getByRole('group', { name: 'Cor da roupa' })).getAllByRole('radio')).toHaveLength(6);
    expect(screen.queryByText(/Mais cores/)).not.toBeInTheDocument();
  });

  it('unlockHint', () => {
    expect(unlockHint([])).toBeUndefined();
    expect(unlockHint([20])).toBe('Mais uma cor chega no nível 20.');
    expect(unlockHint([8, 12, 20])).toBe('Mais cores chegam nos níveis 8, 12 e 20.');
  });
});

describe('Personagem and the world', () => {
  it('a "Mapa do mundo" card links to /mapa with the stage summary and the latest news', async () => {
    await addXp(25, { areaId: 'area-vigor' });
    await setMeta('world', { stages: { 'area-vigor': 1 }, outfits: [0, 1, 2, 3, 4, 5], news: [{ kind: 'stage', areaId: 'area-vigor', stage: 1, at: NOW - 1000 }] });
    renderCharacter();
    const card = await screen.findByRole('link', { name: /Mapa do mundo/ });
    expect(card).toHaveAttribute('href', '/mapa');
    expect(card).toHaveTextContent('6 territórios · 1 acampamento, 5 em ruínas');
    await waitFor(() => expect(card).toHaveTextContent('Novidade: Vigor virou acampamento'));
  });

  it('news of a stage or colour that an undo took back is not shown', async () => {
    await addXp(25, { areaId: 'area-vigor' });
    await setMeta('world', {
      stages: { 'area-vigor': 2 }, outfits: [0, 1, 2, 3, 4, 5, 6],
      news: [
        { kind: 'stage', areaId: 'area-vigor', stage: 2, at: NOW - 1000 },
        { kind: 'outfit', outfit: 6, at: NOW - 2000 },
      ],
    });
    renderCharacter();
    const card = await screen.findByRole('link', { name: /Mapa do mundo/ });
    await waitFor(() => expect(card).toHaveTextContent('1 acampamento, 5 em ruínas'));
    await new Promise((r) => setTimeout(r, 100));
    expect(card).not.toHaveTextContent('Novidade');
  });

  it('attributes show the stage of their territory', async () => {
    await addXp(25, { areaId: 'area-vigor' });
    renderCharacter();
    const list = await screen.findByRole('list', { name: 'Atributos' });
    await waitFor(() => expect(within(list).getByText('Corpo · Acampamento')).toBeInTheDocument());
    expect(within(list).getByText('Pessoas · Ruínas')).toBeInTheDocument();
  });
});
