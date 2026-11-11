import { memo, useMemo } from 'react';
import type { Sprite } from './sprites';

export interface SpriteRect { x: number; y: number; w: number; fill: string }

/** Turns sprite rows into rects, merging horizontal runs of the same palette key. */
export function spriteRects(sprite: Sprite): SpriteRect[] {
  const rects: SpriteRect[] = [];
  sprite.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const key = row[x]!;
      let end = x + 1;
      while (end < row.length && row[end] === key) end++;
      const fill = key === '.' ? undefined : sprite.palette[key];
      if (fill) rects.push({ x, y, w: end - x, fill });
      x = end;
    }
  });
  return rects;
}

export interface PixelSpriteProps { sprite: Sprite; scale?: number; title?: string; className?: string }

export const PixelSprite = memo(function PixelSprite({ sprite, scale = 1, title, className }: PixelSpriteProps) {
  const rects = useMemo(() => spriteRects(sprite), [sprite]);
  const a11y = title
    ? { role: 'img' as const, 'aria-label': title }
    : { 'aria-hidden': true as const, focusable: 'false' as const };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${sprite.w} ${sprite.h}`}
      width={sprite.w * scale}
      height={sprite.h * scale}
      shapeRendering="crispEdges"
      className={className}
      {...a11y}
    >
      {title && <title>{title}</title>}
      {rects.map((r) => (
        <rect key={`${r.x},${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  );
});
