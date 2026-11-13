import type { Profile, Settings } from '@life/shared';
import { EditableField } from '../mission/EditableField';
import { hourLabel, savePomodoro, saveProfile, saveSettings, SettingsSection } from './SettingsSection';

// Ajustes → Dia, Foco and Companheiro: small preferences saved as soon as they change.

const START_HOURS = [0, 1, 2, 3, 4, 5, 6];
const END_HOURS = [20, 21, 22, 23, 0];
const FOCUS_MINUTES = [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 90];
const BREAK_MINUTES = [3, 5, 10, 15, 20, 30];

/** Keeps a stored value that is not one of the options (e.g. set on another device) selectable. */
function withCurrent(options: number[], current: number | undefined): number[] {
  return current === undefined || options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
}

interface NumberSelectProps {
  label: string;
  value: number | undefined;
  options: number[];
  format(n: number): string;
  onChange(n: number): void;
}

function NumberSelect({ label, value, options, format, onChange }: NumberSelectProps) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <select value={value ?? ''} disabled={value === undefined} onChange={(e) => onChange(Number(e.target.value))}>
        {value === undefined && <option value="" />}
        {options.map((n) => <option key={n} value={n}>{format(n)}</option>)}
      </select>
    </label>
  );
}

export function DaySection({ settings }: { settings?: Settings }) {
  return (
    <SettingsSection title="Dia" icon="calendar">
      <div className="settings-row">
        <NumberSelect label="O dia começa às" value={settings?.dayStartHour} options={withCurrent(START_HOURS, settings?.dayStartHour)}
          format={hourLabel} onChange={(dayStartHour) => saveSettings({ dayStartHour })} />
        <NumberSelect label="O dia termina às" value={settings?.dayEndHour}
          options={settings && !END_HOURS.includes(settings.dayEndHour) ? [...END_HOURS, settings.dayEndHour] : END_HOURS}
          format={hourLabel} onChange={(dayEndHour) => saveSettings({ dayEndHour })} />
      </div>
      <p className="settings-hint">Antes do início, ainda conta como o dia anterior. Depois do fim, a tela Agora sugere descansar.</p>
    </SettingsSection>
  );
}

export function FocusSection({ settings }: { settings?: Settings }) {
  const pomodoro = settings?.pomodoro;
  return (
    <SettingsSection title="Foco" icon="timer">
      <div className="settings-row">
        <NumberSelect label="Minutos de foco" value={pomodoro?.focusMin} options={withCurrent(FOCUS_MINUTES, pomodoro?.focusMin)}
          format={(n) => `${n} min`} onChange={(focusMin) => savePomodoro({ focusMin })} />
        <NumberSelect label="Minutos de pausa" value={pomodoro?.breakMin} options={withCurrent(BREAK_MINUTES, pomodoro?.breakMin)}
          format={(n) => `${n} min`} onChange={(breakMin) => savePomodoro({ breakMin })} />
      </div>
      <p className="settings-hint">Usados no modo Pomodoro, para quem prefere um ritmo fixo. Pausas no seu ritmo funcionam tão bem quanto. A pausa só começa quando você tocar.</p>
      <label className="settings-check">
        <input type="checkbox" className="px-checkbox" checked={settings?.checkinCard !== false} disabled={!settings}
          onChange={(e) => saveSettings({ checkinCard: e.target.checked })} />
        <span>Card de início ao começar algo adiado</span>
      </label>
      <p className="settings-hint">
        Para missões adiadas ou pesadas: nomear o que aparece e tentar só 10 minutos. Sempre dá para pular.
      </p>
    </SettingsSection>
  );
}

export function CompanionSection({ settings, profile }: { settings?: Settings; profile?: Profile }) {
  return (
    <SettingsSection title="Companheiro" icon="flame">
      {profile && (
        <EditableField label="Nome do companheiro" value={profile.companionName} required
          onSave={(companionName) => saveProfile({ companionName })} />
      )}
      <label className="settings-check">
        <input type="checkbox" className="px-checkbox" checked={settings?.companionMuted ?? false} disabled={!settings}
          onChange={(e) => saveSettings({ companionMuted: e.target.checked })} />
        <span>Silenciar falas</span>
      </label>
      <p className="settings-hint">Silenciado, o companheiro continua ali, só não fala.</p>
    </SettingsSection>
  );
}
