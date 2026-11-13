import type { Rect, SketchView, Stroke } from '@life/shared';
import { INK_WIDTHS, strokeBounds } from '@life/shared';

// Canvas drawing of a lousa (spec §5). Pure apart from the context it is given: tests pass a fake one.

/** CSS custom properties of the four inks (chalk on the dark lousa), with fallbacks. */
export const INK_VARS = ['--text', '--sky', '--leaf', '--gold'] as const;
const INK_FALLBACK = ['#ece6d6', '#6fb3e0', '#7bc96f', '#f2c14e'];
const GRID_FALLBACK = '#2a2e45';
/** Dot grid spacing in world units (×4 when it would be denser than 12 px on screen). */
export const GRID = 24;

export interface Inks { colors: string[]; grid: string }

/** The theme colours as the canvas needs them (it cannot read CSS variables itself). */
export function readInks(el: Element): Inks {
  const cs = getComputedStyle(el);
  return {
    colors: INK_VARS.map((v, i) => cs.getPropertyValue(v).trim() || INK_FALLBACK[i]!),
    grid: cs.getPropertyValue('--stone').trim() || GRID_FALLBACK,
  };
}

/** Starts a path for `s`: a circle for one point, a segment for two, quadratic curves through the midpoints otherwise. */
export function traceStroke(ctx: CanvasRenderingContext2D, s: Stroke): 'dot' | 'line' {
  const p = s.p;
  const n = p.length >> 1;
  ctx.beginPath();
  if (n === 1) {
    ctx.arc(p[0]!, p[1]!, INK_WIDTHS[s.w] / 2, 0, Math.PI * 2);
    return 'dot';
  }
  ctx.moveTo(p[0]!, p[1]!);
  if (n === 2) {
    ctx.lineTo(p[2]!, p[3]!);
    return 'line';
  }
  for (let i = 1; i < n - 1; i++) {
    const x = p[2 * i]!, y = p[2 * i + 1]!;
    ctx.quadraticCurveTo(x, y, (x + p[2 * i + 2]!) / 2, (y + p[2 * i + 3]!) / 2);
  }
  ctx.lineTo(p[2 * n - 2]!, p[2 * n - 1]!);
  return 'line';
}

const boxes = new WeakMap<Stroke, Rect>();
/** Bounds of a stored stroke, computed once (strokes are never mutated). */
function boxOf(s: Stroke): Rect {
  let b = boxes.get(s);
  if (!b) { b = strokeBounds(s); boxes.set(s, b); }
  return b;
}

export interface Scene {
  strokes: readonly Stroke[];
  /** The stroke being drawn: its points grow, so its bounds are never cached. */
  current?: Stroke;
  view: SketchView;
  /** CSS pixels of the canvas and the device pixel ratio of its backing store. */
  w: number;
  h: number;
  dpr: number;
  inks: Inks;
}

/** Clears and draws the dot grid, then every stroke that crosses the view. */
export function drawScene(ctx: CanvasRenderingContext2D, s: Scene): void {
  const { view, w, h, dpr } = s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const step = GRID * view.zoom >= 12 ? GRID : GRID * 4;
  ctx.fillStyle = s.inks.grid;
  const right = view.x + w / view.zoom;
  const bottom = view.y + h / view.zoom;
  for (let x = Math.ceil(view.x / step) * step; x <= right; x += step) {
    for (let y = Math.ceil(view.y / step) * step; y <= bottom; y += step) {
      ctx.fillRect((x - view.x) * view.zoom - 1, (y - view.y) * view.zoom - 1, 2, 2);
    }
  }
  ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, -view.x * view.zoom * dpr, -view.y * view.zoom * dpr);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const draw = (k: Stroke, b: Rect): void => {
    if (b.maxX < view.x || b.minX > right || b.maxY < view.y || b.minY > bottom) return;
    const color = s.inks.colors[k.c] ?? s.inks.colors[0]!;
    if (traceStroke(ctx, k) === 'dot') {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = INK_WIDTHS[k.w];
      ctx.stroke();
    }
  };
  for (const k of s.strokes) draw(k, boxOf(k));
  if (s.current) draw(s.current, strokeBounds(s.current));
}
