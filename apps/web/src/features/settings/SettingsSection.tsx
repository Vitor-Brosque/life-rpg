import { useId, type ReactNode } from 'react';
import type { Profile, Settings } from '@life/shared';
import { Icon, type IconName } from '../../art/icons';
import { db } from '../../db/db';
import { patch } from '../../db/repo';
import { Panel } from '../../ui/Panel';
import { useToast } from '../../ui/Toast';

/** One titled settings card; a labelled region so it can be found by its title. */
export function SettingsSection({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  const id = useId();
  return (
    <Panel variant="stone" className="settings-section" role="region" aria-labelledby={id}>
      <h2 id={id} className="settings-section__title">
        <Icon name={icon} size={24} />
        {title}
      </h2>
      {children}
    </Panel>
  );
}

function reportFailure(e: unknown): void {
  console.error('settings save failed', e);
  useToast.getState().show('Não foi possível salvar. Tente de novo.');
}

export function saveSettings(changes: Partial<Settings>): void {
  patch<Settings>('settings', 'settings', changes).catch(reportFailure);
}

/**
 * Merges into the stored Pomodoro lengths inside one transaction: the value read at render time
 * may be stale, and two quick changes (focus, then break) must not undo each other.
 */
export function savePomodoro(changes: Partial<Settings['pomodoro']>): void {
  db.transaction('rw', db.settings, db.outbox, async () => {
    const current = await db.settings.get('settings');
    if (current) await patch<Settings>('settings', 'settings', { pomodoro: { ...current.pomodoro, ...changes } });
  }).catch(reportFailure);
}

export function saveProfile(changes: Partial<Profile>): void {
  patch<Profile>('profile', 'me', changes).catch(reportFailure);
}

/** "04:00" for an hour of the day. */
export const hourLabel = (h: number): string => `${String(h).padStart(2, '0')}:00`;
