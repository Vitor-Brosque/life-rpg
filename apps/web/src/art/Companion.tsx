import { PixelSprite } from './PixelSprite';
import { SPRITES } from './sprites';

export interface CompanionProps { scale?: number; speaking?: boolean; title?: string }

/**
 * The lantern spirit. Two stacked frames swap with a CSS step animation (flame flicker);
 * with prefers-reduced-motion only the first frame is shown.
 */
export function Companion({ scale = 3, speaking = false, title }: CompanionProps) {
  const [a, b] = SPRITES.companion;
  return (
    <span
      className={speaking ? 'companion companion--speaking' : 'companion'}
      style={{ width: 16 * scale, height: 16 * scale }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <PixelSprite sprite={a} scale={scale} className="companion__frame companion__frame--a" />
      <PixelSprite sprite={b} scale={scale} className="companion__frame companion__frame--b" />
    </span>
  );
}

/** Speech bubble for the companion. Keep it mounted so screen readers hear new messages. */
export function SpeechBubble({ message, className }: { message?: string; className?: string }) {
  return (
    <div className={className ? `speech ${className}` : 'speech'} role="status" aria-live="polite">
      {message && <p className="speech__bubble">{message}</p>}
    </div>
  );
}
