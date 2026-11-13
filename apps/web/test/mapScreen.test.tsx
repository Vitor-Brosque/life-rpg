import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Area, Journey, Mission, XpEvent } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, patch, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { MapScreen, WORLD_VIEW_KEY } from '../src/features/world/MapScreen';
import { seedBlocks } from './blockFixture';

const NOW = new Date(2026, 10, 13, 10, 0).getTime();   // Friday 10:00

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await db.delete();
  await db.open();
  await ensureSeed();
  try { localStorage.clear(); } catch { /* storage may be unavailable */ }
});
afterEach(() => {
  vi.useRealTimers();
});

function renderMap() {
  const { hook } = memoryLocation({ path: '/mapa' });
  return render(<Router hook={hook}><MapScreen /></Router>);
}

const mission = (fields: Partial<Mission>): Mission => newRecord<Mission>({
  title: 'Missão', checklist: [], status: 'open', important: false, shrunk: false, postponeCount: 0, ...fields,
});

async function seedVigor() {
  await put('missions', mission({ id: 'm1', title: 'Treino A', status: 'done', areaId: 'area-vigor', completedAt: NOW - 1000 }));
  await put('xpEvents', newRecord<XpEvent>({ at: NOW - 60_000, amount: 25, reason: 'complete', dayKey: '2026-11-13', areaId: 'area-vigor', missionId: 'm1' }));
}

describe('MapScreen', () => {
  it('summarises the world and names every territory and the hub', async () => {
    await seedVigor();
    renderMap();
    expect(await screen.findByText('Você está na Encruzilhada · 6 territórios · 1 acampamento, 5 em ruínas')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Mapa do mundo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Vigor, Corpo: Acampamento, nível 2\. Dara \(treinadora\)/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^(Vigor|Equilíbrio|Intelecto|Ofício|Ordem|Laços), / })).toHaveLength(6);
    expect(screen.getByRole('img', { name: 'Encruzilhada, onde começam as estradas das jornadas. Faísca está aqui. Você está aqui.' }))
      .toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/atrasad|falhou|deveria/i);
  });

  it('puts the avatar in the territory of the current block (area through its journey)', async () => {
    await seedBlocks();   // 09:00 "Tech" block of journey j-tech is current at 10:00
    await put('journeys', newRecord<Journey>({ id: 'j-tech', title: 'Tech News', areaId: 'area-oficio', status: 'active', order: 0 }));
    await put('missions', mission({ title: 'Fonte nova', journeyId: 'j-tech', journeyOrder: 1, firstStep: 'Ler a doc da API' }));
    renderMap();
    expect(await screen.findByText(/^Você está em Ofício · /)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Ofício, Trabalho: .*Você está aqui\. Jornada “Tech News”: 0 de 1 missões\.$/ }))
      .toBeInTheDocument();
  });

  it('opens a territory: level, next stage, NPC lines, recent actions and journey link', async () => {
    await seedVigor();
    await put('journeys', newRecord<Journey>({ id: 'jv', title: 'Voltar a correr', areaId: 'area-vigor', status: 'active', order: 0 }));
    const user = userEvent.setup();
    renderMap();
    await user.click(await screen.findByRole('button', { name: /^Vigor, / }));
    const dialog = await screen.findByRole('dialog', { name: 'Vigor · Acampamento' });
    expect(within(dialog).getByText('Corpo · Nível 2')).toBeInTheDocument();
    expect(within(dialog).getByRole('progressbar', { name: '5 / 30 XP' })).toBeInTheDocument();
    expect(within(dialog).getByText('Próximo estágio: Aldeia, no nível 5 (faltam 115 XP)')).toBeInTheDocument();
    expect(within(dialog).getByText('Missão concluída · Treino A')).toBeInTheDocument();
    expect(within(dialog).getByText('+25 XP')).toBeInTheDocument();
    const line = () => dialog.querySelector('.npc__line')!.textContent;
    const first = line();
    await user.click(within(dialog).getByRole('button', { name: 'Outra fala de Dara' }));
    expect(line()).not.toBe(first);
    expect(within(dialog).getByRole('link', { name: /Voltar a correr/ })).toHaveAttribute('href', '/jornadas/jv');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('a territory without actions or journeys says so calmly', async () => {
    const user = userEvent.setup();
    renderMap();
    await user.click(await screen.findByRole('button', { name: /^Laços, / }));
    const dialog = await screen.findByRole('dialog', { name: 'Laços · Ruínas' });
    expect(within(dialog).getByText('Nada por aqui ainda. Qualquer ação desta área conta.')).toBeInTheDocument();
    expect(within(dialog).getByText('Nenhuma jornada ativa nesta área.')).toBeInTheDocument();
    expect(within(dialog).getByText('Lírio · bardo')).toBeInTheDocument();
  });

  it('the list shows the same world as text, and the choice is remembered', async () => {
    await seedVigor();
    const user = userEvent.setup();
    renderMap();
    await user.click(await screen.findByRole('button', { name: 'Lista' }));
    expect(screen.getByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'true');
    const list = screen.getByRole('list', { name: 'Territórios' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(7);
    expect(within(list).getByRole('heading', { name: 'Encruzilhada' })).toBeInTheDocument();
    const vigor = within(list).getByRole('heading', { name: 'Vigor · Acampamento' }).closest('li')!;
    expect(vigor).toHaveTextContent('Corpo · Nível 2');
    expect(vigor).toHaveTextContent('Dara (treinadora): “');
    expect(localStorage.getItem(WORLD_VIEW_KEY)).toBe('lista');
    await user.click(within(vigor).getByRole('button', { name: 'Abrir Vigor' }));
    expect(await screen.findByRole('dialog', { name: 'Vigor · Acampamento' })).toBeInTheDocument();
  });

  it('without active areas it points to Ajustes', async () => {
    for (const a of await db.areas.toArray()) await patch<Area>('areas', a.id, { archived: true });
    renderMap();
    expect(await screen.findByText(/Nenhuma área ativa/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ajustes' })).toHaveAttribute('href', '/ajustes');
  });

  it('keeps keyboard focus off <body>: the opener gets it back when the sheet closes', async () => {
    const user = userEvent.setup();
    renderMap();
    const tile = await screen.findByRole('button', { name: /^Laços, / });
    await user.click(tile);
    await screen.findByRole('dialog', { name: 'Laços · Ruínas' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(tile);
  });

  it('the map art is one crisp decorative svg and territory buttons are positioned in %', async () => {
    renderMap();
    const tile = await screen.findByRole('button', { name: /^Laços, / });
    const svg = document.querySelector('svg.world-map__art')!;
    expect(svg).toHaveAttribute('shape-rendering', 'crispEdges');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(tile.style.width).toMatch(/%$/);
    expect(tile.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('still works when localStorage throws', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const user = userEvent.setup();
    renderMap();
    await user.click(await screen.findByRole('button', { name: 'Lista' }));
    expect(screen.getByRole('list', { name: 'Territórios' })).toBeInTheDocument();
    get.mockRestore();
    set.mockRestore();
  });
});
