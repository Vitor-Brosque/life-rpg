import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { Layout } from '../src/app/Layout';
import { ErrorBoundary } from '../src/app/ErrorBoundary';

function renderAt(path: string, ui: React.ReactNode) {
  const { hook } = memoryLocation({ path });
  return render(<Router hook={hook}>{ui}</Router>);
}

describe('Layout', () => {
  it('renders the 5 main nav links with accessible names', () => {
    renderAt('/', <Layout><h1>Conteúdo</h1></Layout>);
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent?.trim())).toEqual(['Agora', 'Planejar', 'Estudo', 'Diário', 'Personagem']);
    for (const [name, href] of [['Agora', '/'], ['Planejar', '/planejar'], ['Estudo', '/estudo'], ['Diário', '/diario'], ['Personagem', '/personagem']]) {
      expect(within(nav).getByRole('link', { name })).toHaveAttribute('href', href);
    }
    expect(screen.getByRole('main')).toHaveTextContent('Conteúdo');
  });

  it('marks the current section, including nested routes', () => {
    renderAt('/diario/abc', <Layout>x</Layout>);
    expect(screen.getByRole('link', { name: 'Diário' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Agora' })).not.toHaveAttribute('aria-current');
  });

  it('the journeys (/jornadas, /jornadas/…) belong to Planejar', () => {
    renderAt('/jornadas/abc', <Layout>x</Layout>);
    expect(screen.getByRole('link', { name: 'Planejar' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Jornadas' })).not.toBeInTheDocument();
  });

  it('a lousa (/lousa/…) belongs to Estudo', () => {
    renderAt('/lousa/abc', <Layout>x</Layout>);
    expect(screen.getByRole('link', { name: 'Estudo' })).toHaveAttribute('aria-current', 'page');
  });

  it('the world map (/mapa) belongs to Personagem', () => {
    renderAt('/mapa', <Layout>x</Layout>);
    expect(screen.getByRole('link', { name: 'Personagem' })).toHaveAttribute('aria-current', 'page');
  });

  it('a practice session (/pratica/…) belongs to Estudo', () => {
    renderAt('/pratica/abc', <Layout>x</Layout>);
    expect(screen.getByRole('link', { name: 'Estudo' })).toHaveAttribute('aria-current', 'page');
  });

  it('Corpo (/corpo) belongs to Personagem', () => {
    renderAt('/corpo', <Layout>x</Layout>);
    expect(screen.getByRole('link', { name: 'Personagem' })).toHaveAttribute('aria-current', 'page');
  });

  it('the Casa screens (/casa/…) belong to Planejar', () => {
    renderAt('/casa/compras', <Layout>x</Layout>);
    expect(screen.getByRole('link', { name: 'Planejar' })).toHaveAttribute('aria-current', 'page');
  });

  it('renders the slots above the nav and the floating button', () => {
    renderAt('/', (
      <Layout aboveNav={<div>Barra do cronômetro</div>} floating={<button type="button">Capturar</button>}>
        x
      </Layout>
    ));
    expect(screen.getByText('Barra do cronômetro')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Capturar' })).toBeInTheDocument();
  });
});

describe('ErrorBoundary', () => {
  it('shows a recovery screen when a child throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Boom = () => { throw new Error('boom'); };
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('heading', { name: 'Algo deu errado' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recarregar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar dados' })).toBeInTheDocument();
    spy.mockRestore();
  });

  it('Padrões (/padroes) belongs to Personagem', () => {
    renderAt('/padroes', <Layout>x</Layout>);
    expect(screen.getByRole('link', { name: 'Personagem' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('messages and the dock on a phone', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('publishes the sizes of the dock, of the bar above the nav and of the "+" slot, and clears them on unmount', () => {
    const callbacks: Array<() => void> = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { callbacks.push(cb); }
      observe(): void {}
      disconnect(): void {}
    });
    // jsdom has no layout: give the slots a size.
    const sized = (sizes: Record<string, number>) => function (this: HTMLElement): number {
      return Object.entries(sizes).find(([cls]) => this.classList.contains(cls))?.[1] ?? 0;
    };
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(sized({ 'app-dock': 112, 'app-dock__above-nav': 40 }));
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(sized({ 'app-dock__floating': 60 }));
    const root = document.documentElement.style;
    const { unmount } = renderAt('/', <Layout floating={<button type="button">+</button>} aboveNav={<div>cronômetro</div>}>x</Layout>);
    act(() => { for (const cb of callbacks) cb(); });
    expect(root.getPropertyValue('--dock-h')).toBe('112px');
    expect(root.getPropertyValue('--dock-bar-h')).toBe('40px');
    expect(root.getPropertyValue('--dock-fab-w')).toBe('68px'); // the button plus the gap kept beside it

    // No "+" on screen: nothing is reserved beside the message.
    width.mockImplementation(() => 0);
    act(() => { for (const cb of callbacks) cb(); });
    expect(root.getPropertyValue('--dock-fab-w')).toBe('0px');

    unmount();
    for (const name of ['--dock-h', '--dock-bar-h', '--dock-fab-w']) expect(root.getPropertyValue(name)).toBe('');
  });

  // jsdom has no layout: the placement is checked in the stylesheet itself.
  const css = readFileSync(resolve(process.cwd(), 'src/styles/pixel.css'), 'utf8');
  const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

  it('the message sits right above the nav and its bar, beside the "+", not stacked above it', () => {
    const host = /\.toast-host\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(/bottom:\s*([^;]+);/.exec(host)?.[1]).toBe('calc(var(--nav-h) + var(--safe-bottom) + var(--dock-bar-h) + var(--space-3))');
    expect(/padding:\s*([^;]+);/.exec(host)?.[1]).toBe('0 calc(var(--space-4) + var(--dock-fab-w)) 0 var(--space-4)');
    expect(tokens).toMatch(/--dock-bar-h:\s*0px;/);
    expect(tokens).toMatch(/--dock-fab-w:\s*0px;/);
  });
});
