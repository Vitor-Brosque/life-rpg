import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Area, Block, Journey } from '@life/shared';
import { Icon, areaIcon } from '../../art/icons';
import { GripIcon } from '../agora/TodayList';
import { KIND_ICON, KIND_LABEL, durationText } from './routineShared';

const OUT_OF_ORDER = 'horário antes do bloco acima: no dia, vem depois dele';

export interface BlockCardProps {
  block: Block;
  /** The linked area, or the linked journey (and its area, for the colour). */
  area?: Area;
  journey?: Journey;
  /** Its time is earlier than the card above: the day runs it after that one anyway (order wins). */
  outOfOrder?: boolean;
  onOpen(block: Block): void;
}

/** A routine block: drag handle, then time, name, durations, kind, link and the protected badge. */
export function BlockCard({ block, area, journey, outOfOrder = false, onOpen }: BlockCardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });
  const link = journey?.title ?? (block.areaId ? area?.name : undefined);
  const durations = durationText(block);
  const label = [
    block.name, block.targetStart, durations, KIND_LABEL[block.kind], block.protected && 'protegido', link,
    outOfOrder && OUT_OF_ORDER,
  ].filter(Boolean).join(', ');
  return (
    <li
      ref={setNodeRef}
      className={`row-card block-card${isDragging ? ' row-card--dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button type="button" ref={setActivatorNodeRef} className="row-card__handle" aria-label={`Reordenar ${block.name}`}
        {...attributes} {...listeners}>
        <GripIcon />
      </button>
      <button type="button" className="row-card__main block-card__main" aria-label={label} onClick={() => onOpen(block)}>
        <span className="row-card__stripe" style={area ? { background: area.color } : undefined} aria-hidden="true" />
        <span className={`block-card__kind kind--${block.kind}`} aria-hidden="true">
          <Icon name={KIND_ICON[block.kind]} size={24} />
        </span>
        <span className="row-card__body">
          <span className="block-card__head">
            <span className="block-card__time">{block.targetStart}</span>
            <span className="row-card__title">{block.name}</span>
          </span>
          <span className="row-card__sub">{durations} · {KIND_LABEL[block.kind]}</span>
          {(link || block.protected) && (
            <span className="block-card__meta">
              {link && (
                <span className="block-card__link">
                  <Icon name={journey ? 'journey' : areaIcon(area?.icon)} size={12} />
                  {link}
                </span>
              )}
              {block.protected && <span className="tag tag--gold">protegido</span>}
            </span>
          )}
          {outOfOrder && <span className="block-card__note">{OUT_OF_ORDER}</span>}
        </span>
      </button>
    </li>
  );
}
