import { describe, expect, it } from 'vitest';
import type { Stroke } from '../src/types';
import {
  DEFAULT_VIEW, MAX_ZOOM, SKETCH_MAX_POINTS, SKETCH_MAX_STROKES, canAddStroke, eraseAlong, finishStroke, fitView,
  missionSketchId, normalizeStrokes, panBy, pinchView, pointCount, roundPoints, simplifyPoints, sketchBounds,
  sketchTitle, strokeBounds, strokeHit, toWorld, zoomAt,
} from '../src/sketch';

const line = (p: number[], w: 0 | 1 = 0): Stroke => ({ c: 0, w, p });

describe('simplifyPoints (RDP)', () => {
  it('a straight line keeps only its ends', () => {
    expect(simplifyPoints([0, 0, 1, 1, 2, 2, 3, 3], 0.5)).toEqual([0, 0, 3, 3]);
  });
  it('keeps a corner', () => {
    expect(simplifyPoints([0, 0, 5, 0, 10, 0, 10, 5, 10, 10], 0.5)).toEqual([0, 0, 10, 0, 10, 10]);
  });
  it('drops jitter under the tolerance and keeps it above', () => {
    expect(simplifyPoints([0, 0, 5, 0.3, 10, 0], 0.5)).toEqual([0, 0, 10, 0]);
    expect(simplifyPoints([0, 0, 5, 0.3, 10, 0], 0.2)).toEqual([0, 0, 5, 0.3, 10, 0]);
  });
  it('two points or fewer come back as a copy; an odd tail is dropped', () => {
    const two = [1, 2, 3, 4];
    expect(simplifyPoints(two, 1)).toEqual([1, 2, 3, 4]);
    expect(simplifyPoints(two, 1)).not.toBe(two);
    expect(simplifyPoints([1, 2, 3], 1)).toEqual([1, 2]);
  });
});

describe('roundPoints and finishStroke', () => {
  it('rounds to 0.1, never -0, without repeated points', () => {
    expect(roundPoints([0.04, -0.04, 1.26, 2.24, 1.26, 2.24])).toEqual([0, 0, 1.3, 2.2]);
    expect(Object.is(roundPoints([-0.04, 1])[0], 0)).toBe(true);
  });
  it('the tolerance is in screen pixels: zooming in keeps more detail', () => {
    expect(finishStroke([0, 0, 5, 1, 10, 0], 1)).toEqual([0, 0, 5, 1, 10, 0]);
    expect(finishStroke([0, 0, 5, 1, 10, 0], 0.5)).toEqual([0, 0, 10, 0]);
  });
  it('a tap, even a jittery one, is a single point', () => {
    expect(finishStroke([3.33, 4.44], 1)).toEqual([3.3, 4.4]);
    expect(finishStroke([3.31, 4.41, 3.33, 4.42], 1)).toEqual([3.3, 4.4]);
  });
});

describe('caps', () => {
  it('counts points and refuses a new stroke at either cap', () => {
    expect(pointCount([line([0, 0, 1, 1]), line([5, 5])])).toBe(3);
    expect(canAddStroke([line([0, 0])])).toBe(true);
    const many = Array.from({ length: SKETCH_MAX_STROKES }, (_, i) => line([i, 0]));
    expect(canAddStroke(many)).toBe(false);
    const heavy = [line(Array.from({ length: SKETCH_MAX_POINTS * 2 }, (_, i) => i))];
    expect(canAddStroke(heavy)).toBe(false);
  });
});

describe('bounds and eraser', () => {
  it('bounds grow by half the width; an empty lousa has none', () => {
    expect(strokeBounds(line([0, 10, 100, 20], 1))).toEqual({ minX: -3, minY: 7, maxX: 103, maxY: 23 });
    expect(sketchBounds([line([0, 0, 10, 0]), line([50, 50])])).toEqual({ minX: -1, minY: -1, maxX: 51, maxY: 51 });
    expect(sketchBounds([])).toBeUndefined();
  });
  it('strokeHit measures to the segment, to a dot, and counts the width', () => {
    const s = line([0, 0, 100, 0]);
    expect(strokeHit(s, 50, 10, 10)).toBe(true);    // 10 ≤ 10 + 1
    expect(strokeHit(s, 50, 11.5, 10)).toBe(false); // 11.5 > 11
    expect(strokeHit(line([0, 0, 100, 0], 1), 50, 12.5, 10)).toBe(true); // reach 13
    expect(strokeHit(line([5, 5]), 5, 15, 10)).toBe(true);
    expect(strokeHit(line([5, 5]), 5, 17, 10)).toBe(false);
  });
  it('eraseAlong removes whole strokes it touches and returns the same array otherwise', () => {
    const a = line([0, 10, 100, 10]);
    const b = line([0, 200, 100, 200]);
    const strokes = [a, b];
    expect(eraseAlong(strokes, { x: 50, y: 12 }, { x: 50, y: 12 }, 10)).toEqual([b]);
    expect(eraseAlong(strokes, { x: 50, y: 100 }, { x: 60, y: 100 }, 10)).toBe(strokes);
  });
  it('eraseAlong ignores a non-positive or NaN radius', () => {
    const strokes = [line([0, 10, 100, 10])];
    expect(eraseAlong(strokes, { x: 50, y: 10 }, { x: 60, y: 10 }, 0)).toBe(strokes);
    expect(eraseAlong(strokes, { x: 50, y: 10 }, { x: 60, y: 10 }, NaN)).toBe(strokes);
    expect(eraseAlong(strokes, { x: 50, y: 10 }, { x: 60, y: 10 }, -3)).toBe(strokes);
  });
  it('a fast eraser pass does not skip a thin stroke between two samples', () => {
    const thin = line([50, 0, 50, 100]);
    expect(eraseAlong([thin], { x: 0, y: 50 }, { x: 100, y: 50 }, 4)).toEqual([]);
  });
});

describe('view', () => {
  it('toWorld and panBy', () => {
    expect(toWorld({ x: 10, y: 20, zoom: 2 }, 40, 60)).toEqual({ x: 30, y: 50 });
    expect(panBy({ x: 0, y: 0, zoom: 2 }, 10, -4)).toEqual({ x: -5, y: 2, zoom: 2 });
  });
  it('zoomAt keeps the point under the cursor and respects the limits', () => {
    const v = zoomAt({ x: 0, y: 0, zoom: 1 }, 100, 50, 2);
    expect(v).toEqual({ x: 50, y: 25, zoom: 2 });
    expect((100 - v.x) * v.zoom).toBe(100);
    expect(zoomAt({ x: 0, y: 0, zoom: 4 }, 0, 0, 10).zoom).toBe(MAX_ZOOM);
  });
  it('pinchView: spreading zooms around the midpoint; moving both fingers pans', () => {
    const start = { x: 0, y: 0, zoom: 1 };
    expect(pinchView(start, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 200, y: 0 }))
      .toEqual({ x: 0, y: 0, zoom: 2 });
    expect(pinchView(start, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 10, y: 10 }, { x: 110, y: 10 }))
      .toEqual({ x: -10, y: -10, zoom: 1 });
  });
  it('fitView centres small content without magnifying, shrinks big content, and has a default', () => {
    expect(fitView({ minX: 0, minY: 0, maxX: 200, maxY: 100 }, 448, 248)).toEqual({ x: -124, y: -74, zoom: 1 });
    const big = fitView({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, 448, 248);
    expect(big.zoom).toBeCloseTo(0.4);
    expect(big.x).toBeCloseTo(-60);
    expect(big.y).toBeCloseTo(-60);
    expect(fitView(undefined, 448, 248)).toEqual(DEFAULT_VIEW);
    expect(fitView({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 0, 248)).toEqual(DEFAULT_VIEW);
  });
});

describe('outside data and names', () => {
  it('normalizeStrokes keeps only drawable strokes and cuts an odd tail', () => {
    expect(normalizeStrokes([
      { c: 1, w: 1, p: [1, 2, 3] },
      { c: 4, w: 0, p: [1, 2] },
      { c: 0, w: 2, p: [1, 2] },
      { c: 0, w: 0, p: [1] },
      { c: 0, w: 0, p: [1, Number.NaN] },
      { c: 0, w: 0, p: 'x' },
      null,
      { c: 0, w: 0, p: [5, 6] },
    ])).toEqual([{ c: 1, w: 1, p: [1, 2] }, { c: 0, w: 0, p: [5, 6] }]);
    expect(normalizeStrokes(undefined)).toEqual([]);
  });
  it('mission lousa id and names', () => {
    expect(missionSketchId('01HX')).toBe('sketch-m-01HX');
    const createdAt = new Date(2026, 10, 12, 10).getTime();
    expect(sketchTitle({ title: '  Lista 3  ', createdAt })).toBe('Lista 3');
    expect(sketchTitle({ title: '', createdAt }, 'Pipeline do Tech News')).toBe('Lousa · Pipeline do Tech News');
    expect(sketchTitle({ title: ' ', createdAt })).toBe('Lousa de 12/11');
  });
});
