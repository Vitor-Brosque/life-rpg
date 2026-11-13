import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
    expect(links.map((l) => l.textContent?.trim())).toEqual(['Agora', 'Planejar', 'Estudo', 'Jornadas', 'Personagem']);
    for (const [name, href] of [['Agora', '/'], ['Planejar', '/planejar'], ['Estudo', '/estudo'], ['Jornadas', '/jornadas'], ['Personagem', '/personagem']]) {
      expect(within(nav).getByRole('link', { name })).toHaveAttribute('href', href);
    }
    expect(screen.getByRole('main')).toHaveTextContent('Conteúdo');
  });

  it('marks the current section, including nested routes', () => {
    renderAt('/jornadas/abc', <Layout>x</Layout>);
    expect(screen.getByRole('link', { name: 'Jornadas' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Agora' })).not.toHaveAttribute('aria-current');
  });

  it('a lousa (/lousa/…) belongs to Estudo', () => {
    renderAt('/lousa/abc', <Layout>x</Layout>);
    expect(screen.getByRole('link', { name: 'Estudo' })).toHaveAttribute('aria-current', 'page');
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
