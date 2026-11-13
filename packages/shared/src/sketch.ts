import type { ID, InkColor, InkWidth, Sketch, Stroke } from './types';

// Lousa (Marco 3b, spec §4): pure geometry. World units: 1 = 1 CSS px at zoom 1. A stroke's points
// are a flat [x0, y0, x1, y1, …] list. A view { x, y, zoom } is the world point at the canvas'
// top-left corner and the scale: screen → world is x + sx / zoom.

export const SKETCH_MAX_STROKES = 2000;
export const SKETCH_MAX_POINTS = 20_000;
/** A stroke being drawn is closed at this many raw points and goes on as a new one. */
export const STROKE_MAX_POINTS = 2000;
/** World widths of the thin and the thick pen. */
export const INK_WIDTHS = [2, 6] as const;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 5;
/** Simplification tolerance, minimum sampling step and eraser radius, in screen pixels. */
export const SIMPLIFY_PX = 0.8;
export const MIN_STEP_PX = 1;
export const ERASER_PX = 10;
export const SKETCH_TITLE_MAX = 80;

export interface Pt { x: number; y: number }
export interface Rect { minX: number; minY: number; maxX: number; maxY: number }
export interface SketchView { x: number; y: number; zoom: number }

export const DEFAULT_VIEW: SketchView = { x: 0, y: 0, zoom: 1 };

const sq = (v: number): number => v * v;
const halfWidth = (s: Stroke): number => (INK_WIDTHS[s.w] ?? INK_WIDTHS[0]) / 2;

/** Squared distance from (px, py) to the segment (ax, ay)–(bx, by). */
export function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return sq(px - (ax + t * dx)) + sq(py - (ay + t * dy));
}

// ------------------------------------------------------------------ finished strokes

/**
 * Ramer–Douglas–Peucker on a flat list (iterative, no recursion): keeps the first and last point
 * and every point farther than `tolerance` from the simplified line. ≤ 2 points: a copy. An odd
 * trailing value is dropped.
 */
export function simplifyPoints(p: readonly number[], tolerance: number): number[] {
  const n = p.length >> 1;
  if (n <= 2) return p.slice(0, n * 2);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = tolerance * tolerance;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const ax = p[2 * a]!, ay = p[2 * a + 1]!, bx = p[2 * b]!, by = p[2 * b + 1]!;
    let far = -1;
    let farD = tol2;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(p[2 * i]!, p[2 * i + 1]!, ax, ay, bx, by);
      if (d > farD) { farD = d; far = i; }
    }
    if (far !== -1) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i]!, p[2 * i + 1]!);
  return out;
}

const round1 = (v: number): number => {
  const r = Math.round(v * 10) / 10;
  return r === 0 ? 0 : r; // no -0
};

/** Coordinates rounded to 0.1, without consecutive repeated points. */
export function roundPoints(p: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < p.length; i += 2) {
    const x = round1(p[i]!);
    const y = round1(p[i + 1]!);
    const n = out.length;
    if (n >= 2 && out[n - 2] === x && out[n - 1] === y) continue;
    out.push(x, y);
  }
  return out;
}

/** A stroke as stored: simplified with SIMPLIFY_PX on screen at the zoom it was drawn, then rounded. */
export function finishStroke(raw: readonly number[], zoom: number): number[] {
  return roundPoints(simplifyPoints(raw, SIMPLIFY_PX / zoom));
}

// ------------------------------------------------------------------ caps

export const pointCount = (strokes: readonly Stroke[]): number =>
  strokes.reduce((sum, s) => sum + (s.p.length >> 1), 0);

/** Whether a new stroke may start (a stroke already started always finishes). */
export const canAddStroke = (strokes: readonly Stroke[]): boolean =>
  strokes.length < SKETCH_MAX_STROKES && pointCount(strokes) < SKETCH_MAX_POINTS;

// ------------------------------------------------------------------ geometry and eraser

/** Bounding box of the points, grown by half the stroke width. */
export function strokeBounds(s: Stroke): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < s.p.length; i += 2) {
    const x = s.p[i]!, y = s.p[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const r = halfWidth(s);
  return { minX: minX - r, minY: minY - r, maxX: maxX + r, maxY: maxY + r };
}

/** Union of the strokes' boxes; undefined for an empty lousa. */
export function sketchBounds(strokes: readonly Stroke[]): Rect | undefined {
  if (strokes.length === 0) return undefined;
  const all = strokes.map(strokeBounds);
  return {
    minX: Math.min(...all.map((b) => b.minX)),
    minY: Math.min(...all.map((b) => b.minY)),
    maxX: Math.max(...all.map((b) => b.maxX)),
    maxY: Math.max(...all.map((b) => b.maxY)),
  };
}

/** Whether the eraser circle (x, y, radius) touches the stroke's line (half its width included). */
export function strokeHit(s: Stroke, x: number, y: number, radius: number): boolean {
  const reach2 = sq(radius + halfWidth(s));
  const p = s.p;
  if (p.length < 4) return sq(x - p[0]!) + sq(y - p[1]!) <= reach2;
  for (let i = 0; i + 3 < p.length; i += 2) {
    if (segDist2(x, y, p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!) <= reach2) return true;
  }
  return false;
}

/**
 * The strokes left after the eraser moved from `a` to `b` (sampled every radius / 2): whole strokes
 * go. When nothing was touched, the SAME array comes back (callers compare by reference).
 */
export function eraseAlong(strokes: Stroke[], a: Pt, b: Pt, radius: number): Stroke[] {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (radius / 2)));
  const samples: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    samples.push({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
  }
  const minX = Math.min(a.x, b.x) - radius, maxX = Math.max(a.x, b.x) + radius;
  const minY = Math.min(a.y, b.y) - radius, maxY = Math.max(a.y, b.y) + radius;
  const kept = strokes.filter((s) => {
    const r = strokeBounds(s);
    if (r.maxX < minX || r.minX > maxX || r.maxY < minY || r.minY > maxY) return true;
    return !samples.some((q) => strokeHit(s, q.x, q.y, radius));
  });
  return kept.length === strokes.length ? strokes : kept;
}

// ------------------------------------------------------------------ view

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** World point under the screen point (sx, sy). */
export const toWorld = (v: SketchView, sx: number, sy: number): Pt => ({ x: v.x + sx / v.zoom, y: v.y + sy / v.zoom });

/** Moves the content by (dx, dy) screen pixels. */
export const panBy = (v: SketchView, dx: number, dy: number): SketchView =>
  ({ x: v.x - dx / v.zoom, y: v.y - dy / v.zoom, zoom: v.zoom });

/** Scales by `factor` (clamped), keeping the world point under (sx, sy) where it is. */
export function zoomAt(v: SketchView, sx: number, sy: number, factor: number): SketchView {
  const zoom = clampZoom(v.zoom * factor);
  const w = toWorld(v, sx, sy);
  return { x: w.x - sx / zoom, y: w.y - sy / zoom, zoom };
}

/**
 * Two fingers: scale by how much their distance changed since the start, and move the world point
 * that was under their start midpoint to their current midpoint (pinch and pan in one gesture).
 */
export function pinchView(start: SketchView, a0: Pt, b0: Pt, a1: Pt, b1: Pt): SketchView {
  const d0 = Math.max(1, Math.hypot(b0.x - a0.x, b0.y - a0.y));
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const zoom = clampZoom(start.zoom * (d1 / d0));
  const w = toWorld(start, (a0.x + b0.x) / 2, (a0.y + b0.y) / 2);
  return { x: w.x - (a1.x + b1.x) / 2 / zoom, y: w.y - (a1.y + b1.y) / 2 / zoom, zoom };
}

/** Centres `bounds` in a w × h canvas with `pad` px around, never magnifying beyond `maxZoom`. */
export function fitView(bounds: Rect | undefined, w: number, h: number, pad = 24, maxZoom = 1): SketchView {
  if (!bounds || w <= 0 || h <= 0) return DEFAULT_VIEW;
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = clampZoom(Math.min(maxZoom, (w - 2 * pad) / bw, (h - 2 * pad) / bh));
  return { x: bounds.minX - (w / zoom - bw) / 2, y: bounds.minY - (h / zoom - bh) / 2, zoom };
}

// ------------------------------------------------------------------ outside data and names

const isIndex = (v: unknown, max: number): boolean => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

/** Drawable strokes only: colour 0–3, width 0–1, ≥ 1 finite (x, y) pair (an odd tail is cut). */
export function normalizeStrokes(raw: unknown): Stroke[] {
  if (!Array.isArray(raw)) return [];
  const out: Stroke[] = [];
  for (const s of raw) {
    if (typeof s !== 'object' || s === null) continue;
    const { c, w, p } = s as Record<string, unknown>;
    if (!isIndex(c, 3) || !isIndex(w, 1) || !Array.isArray(p) || p.length < 2) continue;
    if (!p.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    out.push({ c: c as InkColor, w: w as InkWidth, p: p.length % 2 === 0 ? (p as number[]) : (p as number[]).slice(0, -1) });
  }
  return out;
}

/** Deterministic id of a mission's lousa: two devices opening it offline make the same record. */
export const missionSketchId = (missionId: ID): ID => `sketch-m-${missionId}`;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The name shown: the title, else "Lousa · <mission>", else "Lousa de DD/MM" (local creation date). */
export function sketchTitle(s: Pick<Sketch, 'title' | 'createdAt'>, missionTitle?: string): string {
  const title = s.title.trim();
  if (title) return title;
  const mission = missionTitle?.trim();
  if (mission) return `Lousa · ${mission}`;
  const d = new Date(s.createdAt);
  return `Lousa de ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}
