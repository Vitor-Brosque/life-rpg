import { useEffect } from 'react';
import { Link } from 'wouter';
import { refreshAiStatus } from '../../ai/aiClient';
import { useAiStatus } from '../../ai/aiStatus';
import { APP_VERSION } from '../../app/version';
import { useProfile, useSettings } from '../../db/hooks';
import { AiSection } from './AiSection';
import { AreasSection } from './AreasSection';
import { DataSection } from './DataSection';
import { NotificationsSection } from './NotificationsSection';
import { SleepSection } from './SleepSection';
import { CompanionSection, DaySection, FocusSection } from './PreferenceSections';
import { StorageSection } from './StorageSection';
import { SettingsSection } from './SettingsSection';
import { SyncSection } from './SyncSection';
import './settings.css';

/**
 * "/ajustes": áreas da vida, dia, foco, companheiro, sincronização, notificações, dados e sobre.
 * Every change is saved right away (local first; sync carries it to the other devices).
 * Each section is its own component in this folder.
 */
export function SettingsScreen() {
  const settings = useSettings();
  const profile = useProfile();
  const aiAvailable = useAiStatus((s) => s.available);
  useEffect(() => { void refreshAiStatus(); }, []);
  return (
    <section className="screen settings" aria-labelledby="settings-title">
      <div className="settings__top">
        <Link href="/personagem" className="settings__back">‹ Personagem</Link>
        <h1 id="settings-title">Ajustes</h1>
      </div>
      <div className="settings__sections">
        <div className="settings__col">
          <AreasSection />
          <DaySection settings={settings} />
          <FocusSection settings={settings} />
          <CompanionSection settings={settings} profile={profile} />
        </div>
        <div className="settings__col">
          <SyncSection />
          {aiAvailable && <AiSection settings={settings} />}
          <NotificationsSection settings={settings} />
          <SleepSection settings={settings} />
          <StorageSection />
          <DataSection />
          <SettingsSection title="Sobre" icon="book">
            <p>LIFE RPG, versão {APP_VERSION}.</p>
            <p className="settings-hint">Marco 1 — Fundação e “Agora”.</p>
          </SettingsSection>
        </div>
      </div>
    </section>
  );
}
