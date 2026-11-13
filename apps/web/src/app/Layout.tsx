import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Companion } from '../art/Companion';
import { Icon, type IconName } from '../art/icons';
import { useCommitmentReminders, useWindDownReminders } from '../features/reminders/reminders';

interface NavItem { href: string; label: string; icon: IconName; also?: string[] }

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Agora', icon: 'agora', also: ['/painel'] },
  { href: '/planejar', label: 'Planejar', icon: 'plan', also: ['/casa'] },
  { href: '/estudo', label: 'Estudo', icon: 'book', also: ['/lousa', '/pratica'] },
  { href: '/jornadas', label: 'Jornadas', icon: 'journey' },
  { href: '/personagem', label: 'Personagem', icon: 'character', also: ['/ajustes', '/corpo', '/padroes', '/mapa'] },
];

export interface LayoutProps {
  children?: ReactNode;
  /** Slim bar docked right above the bottom nav (mobile) / bottom of the content (desktop). For the TimerBar. */
  aboveNav?: ReactNode;
  /** Floating element right-aligned above `aboveNav` (never covering it). For the "+" capture button. */
  floating?: ReactNode;
}

function matches(location: string, path: string): boolean {
  return path === '/' ? location === '/' : location === path || location.startsWith(`${path}/`);
}

function isActive(location: string, item: NavItem): boolean {
  return [item.href, ...(item.also ?? [])].some((p) => matches(location, p));
}

/**
 * App shell. Mobile: content + fixed bottom nav with safe-area insets.
 * ≥ 1200 px: left sidebar nav. The dock (floating + aboveNav) height is published as
 * the CSS variable --dock-h so content padding and toasts stay clear of it.
 */
export function Layout({ children, aboveNav, floating }: LayoutProps) {
  const [location] = useLocation();
  const dockRef = useRef<HTMLDivElement>(null);
  // Commitment reminders (server push) follow commitments, settings and the day.
  useCommitmentReminders();
  // The wind-down push (Marco 4) follows the sleep setting, the day and tonight's "Deitei".
  useWindDownReminders();

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty('--dock-h', `${dock.offsetHeight}px`));
    ro.observe(dock);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--dock-h');
    };
  }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
      <nav className="app-nav" aria-label="Navegação principal">
        <div className="app-nav__brand" aria-hidden="true">
          <Companion scale={2} />
          LIFE RPG
        </div>
        <ul className="app-nav__list">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="app-nav__link"
                aria-current={isActive(location, item) ? 'page' : undefined}
              >
                <Icon name={item.icon} size={24} />
                <span>{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main id="conteudo" className="app-main" tabIndex={-1}>{children}</main>
      <div className="app-dock" ref={dockRef}>
        <div className="app-dock__floating">{floating}</div>
        <div className="app-dock__above-nav">{aboveNav}</div>
      </div>
    </div>
  );
}
