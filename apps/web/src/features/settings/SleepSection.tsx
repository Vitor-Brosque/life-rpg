import type { Settings } from '@life/shared';
import { sleepSettingsOf } from '@life/shared';
import { saveSleepSettings } from '../../domain/sleepActions';
import { useToast } from '../../ui/Toast';
import { SettingsSection } from './SettingsSection';

// Ajustes → Sono (Marco 4): the Agora's sleep taps and the wind-down push.

function save(changes: Parameters<typeof saveSleepSettings>[0]): void {
  saveSleepSettings(changes).catch((e: unknown) => {
    console.error('sleep settings save failed', e);
    useToast.getState().show('Não foi possível salvar. Tente de novo.');
  });
}

export function SleepSection({ settings }: { settings?: Settings }) {
  const sleep = settings ? sleepSettingsOf(settings) : undefined;
  return (
    <SettingsSection title="Sono" icon="moon">
      <label className="settings-check">
        <input type="checkbox" className="px-checkbox" checked={sleep?.agoraPrompt ?? true} disabled={!sleep}
          onChange={(e) => save({ agoraPrompt: e.target.checked })} />
        <span>Mostrar “Deitei” e “Acordei” no Agora</span>
      </label>
      <label className="settings-check">
        <input type="checkbox" className="px-checkbox" checked={sleep?.windDownReminder ?? false} disabled={!sleep}
          onChange={(e) => save({ windDownReminder: e.target.checked })} />
        <span>Lembrete de desaceleração</span>
      </label>
      <label className="field">
        <span className="field__label">Horário do lembrete</span>
        <input type="time" value={sleep?.windDownAt ?? ''} disabled={!sleep?.windDownReminder}
          onChange={(e) => { if (e.target.value) save({ windDownAt: e.target.value }); }} />
      </label>
      <p className="settings-hint">
        Segunda a sexta, depois da aula. Precisa das notificações ativadas. Se você já tocou em “Deitei”, o lembrete daquela noite não vem.
      </p>
    </SettingsSection>
  );
}
