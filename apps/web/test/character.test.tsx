import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { XpEvent } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { newRecord, put } from '../src/db/repo';
import { CharacterScreen } from '../src/features/character/CharacterScreen';
import { relativeTime } from '../src/ui/format';

const NOW = new Date(2026, 10, 11, 10, 20).getTime();

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

function renderCharacter() {
  const { hook } = memoryLocation({ path: '/personagem' });
  return render(<Router hook={hook}><CharacterScreen /></Router>);
}

const sheet = () => screen.findByRole('region', { name: 'Ficha do personagem' });

async function addXp(amount: number, fields: Partial<XpEvent> = {}) {
  await put('xpEvents', newRecord<XpEvent>({
    at: Date.now(), amount, reason: 'complete', dayKey: '2026-11-11', ...fields,
  }));
}

describe('CharacterScreen', () => {
  it('shows "Aprendiz" and "Nv 1" with no XP', async () => {
    renderCharacter();
    const card = await sheet();
    expect(await within(card).findByText('Aprendiz')).toBeInTheDocument();
    expect(within(card).getByText('Nv 1')).toBeInTheDocument();
    expect(within(card).getByRole('progressbar', { name: '0 / 40 XP' })).toBeInTheDocument();
  });

  it('reaches level 2 after 40 XP of xpEvents', async () => {
    await addXp(25);
    await addXp(15, { reason: 'focus' });
    renderCharacter();
    const card = await sheet();
    expect(await within(card).findByText('Nv 2')).toBeInTheDocument();
    expect(within(card).getByText('Aprendiz')).toBeInTheDocument();
    expect(within(card).getByRole('progressbar', { name: '0 / 60 XP' })).toBeInTheDocument();
  });

  it('lists every active area as an attribute with its own level', async () => {
    await addXp(25, { areaId: 'area-vigor' });
    renderCharacter();
    const list = await screen.findByRole('list', { name: 'Atributos' });
    const items = await within(list).findAllByRole('listitem');
    expect(items).toHaveLength(6);
    const vigor = items.find((li) => li.textContent?.includes('Vigor'))!;
    expect(vigor).toHaveTextContent('Corpo');
    // Attributes need half the XP: 20 for level 2.
    expect(within(vigor).getByText('Nv 2')).toBeInTheDocument();
    expect(within(vigor).getByRole('progressbar', { name: '5 / 30 XP' })).toBeInTheDocument();
  });

  it('shows constancy as 7 dots and workday counts, never the word "sequência"', async () => {
    await addXp(5, { dayKey: '2026-11-11' });
    await addXp(5, { dayKey: '2026-11-09', at: NOW - 2 * 86_400_000 });
    await addXp(5, { dayKey: '2026-10-20', at: NOW - 22 * 86_400_000 });
    renderCharacter();
    const dots = await screen.findByRole('list', { name: '2 de 5 dias úteis com atividade' });
    expect(within(dots).getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByText('2 de 5 dias úteis')).toBeInTheDocument();
    expect(screen.getByText('3 de 22 dias úteis nos últimos 30')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sequ[eê]ncia/i);
  });

  it('lists recent achievements with PT-BR labels and relative time', async () => {
    await addXp(8, { reason: 'complete', at: NOW - 5 * 60_000 });
    await addXp(5, { reason: 'review', at: NOW - 3 * 3_600_000 });
    await addXp(5, { reason: 'start', at: NOW - 26 * 3_600_000 });
    renderCharacter();
    const list = await screen.findByRole('list', { name: 'Conquistas recentes' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3));
    const rows = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows[0]).toContain('Missão concluída');
    expect(rows[0]).toContain('+8 XP');
    expect(rows[0]).toContain('há 5 min');
    expect(rows[1]).toContain('Revisão rápida');
    expect(rows[1]).toContain('há 3 h');
    expect(rows[2]).toContain('Coragem para começar');
    expect(rows[2]).toContain('ontem');
  });

  it('edits the look and names in the "Editar aparência" sheet', async () => {
    const user = userEvent.setup();
    renderCharacter();
    await user.click(await screen.findByRole('button', { name: 'Editar aparência' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar aparência' });
    await user.type(within(dialog).getByLabelText('Nome'), 'Vitor');
    const companion = within(dialog).getByLabelText('Nome do companheiro');
    await user.clear(companion);
    await user.type(companion, 'Brasa');
    await user.click(within(dialog).getByRole('radio', { name: 'Morena' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Cacheado' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Ruivo' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Verde' }));
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => {
      const p = await db.profile.get('me');
      expect(p).toMatchObject({ name: 'Vitor', companionName: 'Brasa', look: { skin: 3, hair: 3, hairColor: 2, outfit: 1 } });
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await within(await sheet()).findByRole('heading', { name: 'Vitor' })).toBeInTheDocument();
  });

  it('every look radio carries its visible name as aria-label', async () => {
    const user = userEvent.setup();
    renderCharacter();
    await user.click(await screen.findByRole('button', { name: 'Editar aparência' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar aparência' });
    expect(within(dialog).getByRole('radio', { name: 'Clara' })).toHaveAttribute('aria-label', 'Clara');
    expect(within(dialog).getByRole('radio', { name: 'Longo' })).toHaveAttribute('aria-label', 'Longo');
    expect(within(dialog).getAllByRole('radio').every((r) => r.getAttribute('aria-label'))).toBe(true);
  });

  it('links the gear to /ajustes', async () => {
    renderCharacter();
    expect(await screen.findByRole('link', { name: 'Ajustes' })).toHaveAttribute('href', '/ajustes');
  });
});

describe('relativeTime', () => {
  it('formats elapsed time in PT-BR', () => {
    expect(relativeTime(NOW - 20_000, NOW)).toBe('agora');
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('há 5 min');
    expect(relativeTime(NOW - 59 * 60_000, NOW)).toBe('há 59 min');
    expect(relativeTime(NOW - 2 * 3_600_000, NOW)).toBe('há 2 h');
    expect(relativeTime(NOW - 30 * 3_600_000, NOW)).toBe('ontem');
    expect(relativeTime(NOW - 3 * 86_400_000, NOW)).toBe('há 3 dias');
    expect(relativeTime(NOW + 60_000, NOW)).toBe('agora');
  });
});
