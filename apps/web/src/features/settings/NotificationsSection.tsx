import { useState } from 'react';
import type { Settings } from '@life/shared';
import { enablePushNotifications, PushSetupError } from '../../timer/push';
import { Button } from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { saveSettings, SettingsSection } from './SettingsSection';

const REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60];

const reminderLabel = (n: number): string => (n === 0 ? 'Desligado' : n === 60 ? '1 h antes' : `${n} min antes`);

function permissionText(): string | undefined {
  if (typeof Notification === 'undefined') return undefined;
  if (Notification.permission === 'granted') return 'Notificações permitidas neste aparelho.';
  if (Notification.permission === 'denied') return 'Notificações bloqueadas neste aparelho. Libere nos ajustes do navegador.';
  return undefined;
}

export function NotificationsSection({ settings }: { settings?: Settings }) {
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState(permissionText);
  const toast = useToast((s) => s.show);

  const enable = async () => {
    setBusy(true);
    try {
      const result = await enablePushNotifications();
      if (result === 'granted') toast('Notificações ativadas');
      else if (result === 'denied') toast('Sem permissão para notificar. Dá para liberar nos ajustes do navegador.');
      else toast('Este navegador não recebe notificações. No iPhone, adicione o app à Tela de Início primeiro.');
    } catch (e) {
      toast(e instanceof PushSetupError ? e.message : 'Não foi possível ativar as notificações. Tente de novo.');
      if (!(e instanceof PushSetupError)) console.error('push setup failed', e);
    } finally {
      setBusy(false);
      setPermission(permissionText());
    }
  };

  const current = settings?.commitmentReminderMin;
  const options = current === undefined || REMINDER_OPTIONS.includes(current)
    ? REMINDER_OPTIONS : [...REMINDER_OPTIONS, current].sort((a, b) => a - b);

  return (
    <SettingsSection title="Notificações" icon="bell">
      <p className="settings-hint">
        No iPhone, as notificações só funcionam com o app na Tela de Início: no Safari, toque em Compartilhar
        e depois em “Adicionar à Tela de Início”. Abra o app por lá e ative aqui.
      </p>
      <div>
        <Button variant="primary" disabled={busy} onClick={() => { void enable(); }}>Ativar notificações</Button>
      </div>
      {permission && <p className="settings-hint" role="status">{permission}</p>}
      <label className="field">
        <span className="field__label">Lembrar compromissos</span>
        <select value={current ?? ''} disabled={current === undefined}
          onChange={(e) => saveSettings({ commitmentReminderMin: Number(e.target.value) })}>
          {current === undefined && <option value="" />}
          {options.map((n) => <option key={n} value={n}>{reminderLabel(n)}</option>)}
        </select>
      </label>
    </SettingsSection>
  );
}
