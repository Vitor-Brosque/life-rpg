import { Link } from 'wouter';
import type { EnergyLevel, EngineOutput } from '@life/shared';
import { formatHHmm } from '@life/shared';
import { Avatar } from '../../art/Avatar';
import { Icon } from '../../art/icons';
import {
  useCharacterStats, useCurrentEnergy, useDayState, useProfile, useSettings,
} from '../../db/hooks';
import { setEnergy, setHardDay } from '../../domain/actions';
import { useSyncStatus, type SyncStatus } from '../../sync/status';
import { Button } from '../../ui/Button';
import { ENERGY_LEVEL_LABEL, formatDuration } from '../../ui/format';
import { useToast } from '../../ui/Toast';
import { useCompanion } from '../companion/store';

type FreeTimeInput = Pick<EngineOutput, 'freeMinutes' | 'currentCommitment' | 'nextCommitment'>;

/** "1h40 livre até Dentista 15:00" / "livre até 23:00" / "Em compromisso: Dentista até 15:00". */
export function freeTimeText(engine: FreeTimeInput, dayEndHour: number): string {
  const end = formatHHmm((dayEndHour % 24) * 60);
  if (engine.currentCommitment) {
    const c = engine.currentCommitment.commitment;
    return `Em compromisso: ${c.title} até ${c.end}`;
  }
  if (engine.nextCommitment) {
    const c = engine.nextCommitment.commitment;
    return engine.freeMinutes > 0
      ? `${formatDuration(engine.freeMinutes)} livre até ${c.title} ${c.start}`
      : `${c.title} às ${c.start}`;
  }
  if (engine.freeMinutes <= 0) return `Depois das ${end}: hora de descansar`;
  return `livre até ${end}`;
}

const NEXT_ENERGY: Record<EnergyLevel, EnergyLevel> = { low: 'medium', medium: 'high', high: 'low' };
const ENERGY_BARS: Record<EnergyLevel, number> = { low: 1, medium: 2, high: 3 };

function EnergyButton({ energy }: { energy?: EnergyLevel }) {
  const bars = energy ? ENERGY_BARS[energy] : 0;
  return (
    <Button
      size="sm"
      className="energy-btn"
      title="Toque para mudar"
      onClick={() => { void setEnergy(energy ? NEXT_ENERGY[energy] : 'medium'); }}
    >
      <span className="energy-btn__bars" aria-hidden="true">
        {[1, 2, 3].map((i) => <span key={i} className={i <= bars ? 'is-on' : undefined} />)}
      </span>
      {energy ? `Energia ${ENERGY_LEVEL_LABEL[energy]}` : 'Definir energia'}
    </Button>
  );
}

export function syncText(s: SyncStatus): string {
  const pending = s.pending > 0 && s.state !== 'disabled'
    ? ` · ${s.pending} ${s.pending === 1 ? 'alteração pendente' : 'alterações pendentes'}` : '';
  switch (s.state) {
    case 'disabled': return 'Sincronização desativada — tudo fica salvo no aparelho';
    case 'syncing': return `Sincronizando…${pending}`;
    case 'offline': return `Sem conexão — tudo fica salvo no aparelho${pending}`;
    case 'error': return `Erro na sincronização${s.error ? `: ${s.error}` : ''}${pending}`;
    case 'idle': {
      const at = s.lastSync !== undefined ? new Date(s.lastSync) : undefined;
      return `${at ? `Sincronizado às ${formatHHmm(at.getHours() * 60 + at.getMinutes())}` : 'Sincronizado'}${pending}`;
    }
  }
}

function SyncIndicator() {
  const status = useSyncStatus();
  const text = syncText(status);
  return (
    <button
      type="button"
      className={`sync-indicator sync-indicator--${status.state}`}
      aria-label={text}
      title={text}
      onClick={() => useToast.getState().show(text)}
    >
      <Icon name="sync" size={24} />
    </button>
  );
}

export interface StatusStripProps {
  engine?: EngineOutput;
  /** Tighter variant (Painel column). */
  compact?: boolean;
}

/** Avatar + level · free time · sync, then energy and "Hoje está pesado". */
export function StatusStrip({ engine, compact }: StatusStripProps) {
  const profile = useProfile();
  const stats = useCharacterStats();
  const energy = useCurrentEnergy();
  const dayState = useDayState();
  const settings = useSettings();
  const level = stats?.total.level ?? 1;
  const hardDay = dayState?.hardDay ?? false;

  const toggleHardDay = () => {
    void setHardDay(!hardDay);
    if (!hardDay) void useCompanion.getState().say('hardDay');
  };

  return (
    <div className={compact ? 'status-strip status-strip--compact' : 'status-strip'}>
      <div className="status-strip__top">
        <Link href="/personagem" className="status-strip__hero" aria-label={`Personagem, nível ${level}`}>
          {profile && <Avatar look={profile.look} scale={2} />}
          <span className="status-strip__level" aria-hidden="true">Nv {level}</span>
        </Link>
        <p className="status-strip__free">
          {engine && settings && (
            <>
              <Icon name="timer" size={12} className="status-strip__free-icon" />
              {freeTimeText(engine, settings.dayEndHour)}
            </>
          )}
        </p>
        <SyncIndicator />
      </div>
      <div className="status-strip__controls">
        <EnergyButton energy={energy} />
        <Button size="sm" icon="moon" className="hard-day-btn" aria-pressed={hardDay} onClick={toggleHardDay}>
          Hoje está pesado
        </Button>
      </div>
    </div>
  );
}
