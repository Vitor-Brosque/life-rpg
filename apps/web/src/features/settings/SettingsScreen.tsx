import { Link } from 'wouter';
import { APP_VERSION } from '../../app/version';
import { useProfile, useSettings } from '../../db/hooks';
import { AreasSection } from './AreasSection';
import { DataSection } from './DataSection';
import { NotificationsSection } from './NotificationsSection';
import { CompanionSection, DaySection, FocusSection } from './PreferenceSections';
import { SettingsSection } from './SettingsSection';
import { SyncSection } from './SyncSection';
import './settings.css';

const SPEC_PATH = 'docs/superpowers/specs/2026-11-11-marco1-fundacao-agora-design.md';

/**
 * "/ajustes": áreas da vida, dia, foco, companheiro, sincronização, notificações, dados e sobre.
 * Every change is saved right away (local first; sync carries it to the other devices).
 * Each section is its own component in this folder.
 */
export function SettingsScreen() {
  const settings = useSettings();
  const profile = useProfile();
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
          <NotificationsSection settings={settings} />
          <DataSection />
          <SettingsSection title="Sobre" icon="book">
            <p>LIFE RPG, versão {APP_VERSION}.</p>
            <p className="settings-hint">
              Marco 1 — Fundação e “Agora”. Especificação no repositório: <code className="settings-code">{SPEC_PATH}</code>
            </p>
          </SettingsSection>
        </div>
      </div>
    </section>
  );
}
