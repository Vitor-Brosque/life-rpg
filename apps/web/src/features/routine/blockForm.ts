import type { Block, BlockKind, ChecklistItem } from '@life/shared';
import { formatDuration } from '../../ui/format';
import { isWeekend } from './routineShared';

// The block sheet's editable state, its validation (PT-BR messages) and the fields it saves.

export interface BlockDraft {
  name: string;
  targetStart: string;
  /** Minutes as typed (strings, so a field can be cleared while typing). */
  duration: string;
  minimum: string;
  kind: BlockKind;
  protected: boolean;
  /** Spaced-repetition reviews are offered during this block. */
  reviews: boolean;
  /** '' (no link), 'area:<id>' or 'journey:<id>'. */
  link: string;
  weekdays: number[];
  checklist: ChecklistItem[];
}

export type BlockErrors = Partial<Record<'name' | 'targetStart' | 'duration' | 'minimum' | 'weekdays', string>>;

export const MIN_MINUTES = 5;
export const MAX_MINUTES = 12 * 60;

const linkOf = (b: Block): string =>
  b.journeyId ? `journey:${b.journeyId}` : b.areaId ? `area:${b.areaId}` : '';

/** Draft of an existing block, or of a new one for the weekday being edited (workdays → Mon–Fri). */
export function draftOf(block: Block | undefined, weekday: number): BlockDraft {
  if (block) {
    return {
      name: block.name, targetStart: block.targetStart, duration: String(block.durationMin),
      minimum: String(block.minimumMin), kind: block.kind, protected: block.protected, reviews: block.reviews ?? block.kind === 'light',
      link: linkOf(block),
      weekdays: [...block.weekdays], checklist: block.checklist.map((c) => ({ ...c })),
    };
  }
  return {
    name: '', targetStart: '09:00', duration: '60', minimum: '15', kind: 'focus', protected: false, reviews: false, link: '',
    weekdays: isWeekend(weekday) ? [weekday] : [1, 2, 3, 4, 5], checklist: [],
  };
}

const minutes = (s: string): number => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);

export function validateDraft(d: BlockDraft): BlockErrors {
  const errors: BlockErrors = {};
  if (!d.name.trim()) errors.name = 'Dê um nome ao bloco.';
  if (!/^\d{2}:\d{2}$/.test(d.targetStart)) errors.targetStart = 'Escolha o horário de início.';
  const duration = minutes(d.duration);
  const minimum = minutes(d.minimum);
  if (Number.isNaN(duration) || duration < MIN_MINUTES) errors.duration = 'A duração precisa ter pelo menos 5 min.';
  else if (duration > MAX_MINUTES) errors.duration = 'A duração vai até 12h.';
  if (Number.isNaN(minimum) || minimum < MIN_MINUTES) errors.minimum = 'A versão mínima precisa ter pelo menos 5 min.';
  else if (!errors.duration && minimum > duration) {
    errors.minimum = `A versão mínima não pode passar da duração (${formatDuration(duration)}).`;
  }
  if (d.weekdays.length === 0) errors.weekdays = 'Escolha pelo menos um dia.';
  return errors;
}

/** Fields for `saveBlock` (a valid draft). Both links are always given, so "Sem ligação" clears them. */
export function fieldsOf(d: BlockDraft): Partial<Block> {
  const [type, id] = d.link.split(':');
  return {
    name: d.name.trim(),
    targetStart: d.targetStart,
    durationMin: minutes(d.duration),
    minimumMin: minutes(d.minimum),
    kind: d.kind,
    protected: d.protected,
    reviews: d.reviews,
    weekdays: [...d.weekdays].sort((a, b) => a - b),
    checklist: d.checklist,
    areaId: type === 'area' ? id : undefined,
    journeyId: type === 'journey' ? id : undefined,
  };
}
