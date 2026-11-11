import { useId, type ReactNode } from 'react';
import type { Profile, Settings } from '@life/shared';
import { Icon, type IconName } from '../../art/icons';
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

export function saveProfile(changes: Partial<Profile>): void {
  patch<Profile>('profile', 'me', changes).catch(reportFailure);
}

/** "04:00" for an hour of the day. */
export const hourLabel = (h: number): string => `${String(h).padStart(2, '0')}:00`;
