import type { Stroke } from '@life/shared';
import { INK_WIDTHS, drawingFrame, sketchBounds } from '@life/shared';
import { readInks, traceStroke } from '../sketch/render';

/**
 * A drawing as a PNG on the lousa background (no grid), at most 1600 px (spec §6.3). PNG: chalk
 * lines on a flat background stay small and sharp. null without strokes or without a canvas.
 */
export async function drawingToImage(strokes: readonly Stroke[], el: Element = document.documentElement): Promise<Blob | null> {
  const frame = drawingFrame(sketchBounds(strokes));
  if (!frame) return null;
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const inks = readInks(el);
  ctx.fillStyle = getComputedStyle(el).getPropertyValue('--bg').trim() || '#12141f';
  ctx.fillRect(0, 0, frame.width, frame.height);
  const { x, y, zoom } = frame.view;
  ctx.setTransform(zoom, 0, 0, zoom, -x * zoom, -y * zoom);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    const color = inks.colors[s.c] ?? inks.colors[0]!;
    if (traceStroke(ctx, s) === 'dot') {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = INK_WIDTHS[s.w];
      ctx.stroke();
    }
  }
  return new Promise((resolve) => canvas.toBlob((b) => {
    canvas.width = canvas.height = 0;
    resolve(b);
  }, 'image/png'));
}
