import { useId } from 'react';
import type { AiSettings, Settings } from '@life/shared';
import { aiSettingsOf } from '@life/shared';
import { useAiStatus } from '../../ai/aiStatus';
import { saveAiSettings, SettingsSection } from './SettingsSection';

const AIDS: ReadonlyArray<{ key: keyof AiSettings; label: string; sends: string }> = [
  {
    key: 'hints',
    label: 'Pistas na sessão de prática',
    sends: 'Quando você pede uma pista, vão o título, o problema, as entradas e saídas, os conceitos, os passos, as decisões, os casos de teste e o código do passo atual (na reconstrução, só a reconstrução). Erros e feedback não vão.',
  },
  { key: 'cards', label: 'Sugerir cards', sends: 'Vão só o texto que você colar (ou o da nota escolhida) e o nome do baralho.' },
  { key: 'weekly', label: 'Resumo da semana', sends: 'Vão só os números do Observado da semana. Suas respostas vão apenas se você marcar.' },
];

/** Ajustes → "Inteligência (opcional)": shown only when the server has AI (spec §6.2). */
export function AiSection({ settings }: { settings?: Settings }) {
  const usage = useAiStatus((s) => s.usage);
  const ai = aiSettingsOf(settings);
  const id = useId();
  return (
    <SettingsSection title="Inteligência (opcional)" icon="star">
      <p className="settings-hint">
        Três ajudas opcionais que usam o Claude, um modelo de IA da Anthropic, pelo seu servidor. Cada uma começa
        desligada, nada é enviado sem você tocar no botão e o app funciona igual sem elas.
      </p>
      {AIDS.map((a) => (
        <div key={a.key}>
          <label className="settings-check">
            <input type="checkbox" className="px-checkbox" checked={ai[a.key]} disabled={!settings}
              aria-describedby={`${id}-${a.key}`} onChange={(e) => saveAiSettings({ [a.key]: e.target.checked })} />
            <span>{a.label}</span>
          </label>
          <p id={`${id}-${a.key}`} className="settings-hint">{a.sends}</p>
        </div>
      ))}
      {usage && <p className="settings-hint">{`Hoje: ${usage.used} de ${usage.limit} pedidos usados.`}</p>}
      <p className="settings-hint">
        A chave fica só no servidor; o aparelho nunca a vê. Os pedidos vão do seu servidor para a API da Anthropic.
      </p>
    </SettingsSection>
  );
}
