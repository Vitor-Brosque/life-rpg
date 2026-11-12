import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'wouter';
import type { BlockOccurrence, DayMode, EnergyLevel, EngineOutput } from '@life/shared';
import { formatHHmm } from '@life/shared';
import { Avatar } from '../../art/Avatar';
import { Icon } from '../../art/icons';
import {
  useCharacterStats, useCurrentEnergy, useDayMode, useProfile, useSettings,
} from '../../db/hooks';
import { setEnergy } from '../../domain/actions';
import { useSyncStatus, type SyncStatus } from '../../sync/status';
import { useTimerSheet } from '../../timer/TimerSheet';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { ENERGY_LEVEL_LABEL, formatDuration } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { pickDayMode } from './blockFeedback';
import { ModeButton, ModePicker } from './ModeChip';

type FreeTimeInput = Pick<EngineOutput, 'freeMinutes' | 'currentCommitment' | 'nextCommitment'>;

/**
 * "1h40 livre até Dentista 15:00" / "livre até 23:00" / "Em compromisso: Dentista até 15:00";
 * inside a block (`blockLeftMin` > 0): "2h30 até o fim do bloco".
 */
export function freeTimeText(engine: FreeTimeInput, dayEndHour: number, blockLeftMin?: number): string {
  const end = formatHHmm((dayEndHour % 24) * 60);
  if (engine.currentCommitment) {
    const c = engine.currentCommitment.commitment;
    return `Em compromisso: ${c.title} até ${c.end}`;
  }
  // Past the block's end the banner says so; the strip goes back to the day's free time.
  if (blockLeftMin !== undefined && blockLeftMin > 0) return `${formatDuration(blockLeftMin)} até o fim do bloco`;
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
      onClick={() => safeRun(setEnergy(energy ? NEXT_ENERGY[energy] : 'medium'))}
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
  /** The current block: the strip then counts down to its end instead of the free time. */
  block?: BlockOccurrence;
  now?: number;
  /** Tighter variant (Painel column). */
  compact?: boolean;
}

/** Avatar + level · free time · sync, then energy and the day type (Normal / Baixa energia / …). */
export function StatusStrip({ engine, block, now, compact }: StatusStripProps) {
  const profile = useProfile();
  const stats = useCharacterStats();
  const energy = useCurrentEnergy();
  const mode = useDayMode();
  const settings = useSettings();
  const [picking, setPicking] = useState(false);
  const pickerId = useId();
  const chipRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const level = stats?.total.level ?? 1;
  const blockLeft = block && now !== undefined ? Math.max(0, Math.ceil((block.end - now) / 60_000)) : undefined;

  // Esc (focus back on the chip) and a tap outside the picker close it.
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPicking(false);
      chipRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (pickerRef.current?.contains(t) || chipRef.current?.contains(t))) return;
      setPicking(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [picking]);

  const pick = (m: DayMode, option: HTMLElement) => {
    focusWhenGone(option);
    setPicking(false);
    if (m !== mode) pickDayMode(m);
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
              {freeTimeText(engine, settings.dayEndHour, blockLeft)}
            </>
          )}
        </p>
        {/* The Painel has its own big timer card. */}
        {!compact && (
          <Button variant="ghost" size="sm" icon="timer" className="status-strip__timer" aria-label="Cronômetro"
            aria-haspopup="dialog" onClick={() => useTimerSheet.getState().open()} />
        )}
        <SyncIndicator />
      </div>
      <div className="status-strip__controls">
        <EnergyButton energy={energy} />
        <ModeButton ref={chipRef} mode={mode} open={picking} pickerId={pickerId} onToggle={() => setPicking((v) => !v)} />
      </div>
      {picking && <ModePicker ref={pickerRef} id={pickerId} mode={mode} onPick={pick} />}
    </div>
  );
}
