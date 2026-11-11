import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PixelSprite, spriteRects } from '../src/art/PixelSprite';
import {
  HAIR_COLORS, HAIR_STYLES_COUNT, OUTFIT_COLORS, SKIN_TONES, SPRITES, avatarSprite, type Sprite,
} from '../src/art/sprites';
import { ICONS, ICON_NAMES } from '../src/art/icons';

function expectValid(sprite: Sprite, label: string): void {
  expect(sprite.rows.length, `${label}: height`).toBe(sprite.h);
  sprite.rows.forEach((row, y) => {
    expect(row.length, `${label}: row ${y} length`).toBe(sprite.w);
    for (const ch of row) {
      expect(ch === '.' || ch in sprite.palette, `${label}: row ${y} has unknown key "${ch}"`).toBe(true);
    }
  });
}

describe('PixelSprite', () => {
  it('renders an svg with crispEdges and merges a horizontal run into one rect', () => {
    const sprite: Sprite = { w: 4, h: 1, rows: ['aaa.'], palette: { a: '#ff0000' } };
    const { container } = render(<PixelSprite sprite={sprite} scale={3} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toBeInTheDocument();
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(svg.getAttribute('viewBox')).toBe('0 0 4 1');
    expect(svg.getAttribute('width')).toBe('12');
    expect(svg.getAttribute('height')).toBe('3');
    const rects = svg.querySelectorAll('rect');
    expect(rects).toHaveLength(1);
    expect(rects[0]!.getAttribute('x')).toBe('0');
    expect(rects[0]!.getAttribute('width')).toBe('3');
    expect(rects[0]!.getAttribute('fill')).toBe('#ff0000');
  });

  it('splits runs when the palette key changes', () => {
    const rects = spriteRects({ w: 5, h: 2, rows: ['aabb.', '.a.aa'], palette: { a: '#111', b: '#222' } });
    expect(rects).toEqual([
      { x: 0, y: 0, w: 2, fill: '#111' },
      { x: 2, y: 0, w: 2, fill: '#222' },
      { x: 1, y: 1, w: 1, fill: '#111' },
      { x: 3, y: 1, w: 2, fill: '#111' },
    ]);
  });

  it('is decorative without a title and labelled with one', () => {
    const sprite: Sprite = { w: 1, h: 1, rows: ['a'], palette: { a: '#000' } };
    const { container, rerender } = render(<PixelSprite sprite={sprite} />);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    rerender(<PixelSprite sprite={sprite} title="Faísca" />);
    expect(container.querySelector('svg')!.getAttribute('role')).toBe('img');
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe('Faísca');
  });
});

describe('sprites', () => {
  it('companion has two valid 16×16 frames that differ', () => {
    expect(SPRITES.companion).toHaveLength(2);
    SPRITES.companion.forEach((frame, i) => {
      expect(frame.w).toBe(16);
      expect(frame.h).toBe(16);
      expectValid(frame, `companion frame ${i}`);
    });
    expect(SPRITES.companion[0].rows).not.toEqual(SPRITES.companion[1].rows);
  });

  it('every hair style produces a valid 16×16 avatar, and styles differ', () => {
    expect(HAIR_STYLES_COUNT).toBe(4);
    const seen = new Set<string>();
    for (let hair = 0; hair < HAIR_STYLES_COUNT; hair++) {
      const sprite = avatarSprite({ skin: 0, hair, hairColor: 0, outfit: 0 });
      expect(sprite.w).toBe(16);
      expect(sprite.h).toBe(16);
      expectValid(sprite, `hair style ${hair}`);
      seen.add(sprite.rows.join('\n'));
    }
    expect(seen.size).toBe(HAIR_STYLES_COUNT);
  });

  it('avatar colors follow the look and never crash on out-of-range indexes', () => {
    const a = avatarSprite({ skin: 1, hair: 0, hairColor: 2, outfit: 3 });
    expect(Object.values(a.palette)).toContain(SKIN_TONES[1]);
    expect(Object.values(a.palette)).toContain(HAIR_COLORS[2]);
    expect(Object.values(a.palette)).toContain(OUTFIT_COLORS[3]);
    expectValid(avatarSprite({ skin: 99, hair: -1, hairColor: 42, outfit: 7.5 }), 'out of range');
  });

  it('every icon is a valid 12×12 sprite', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(27);
    for (const name of ICON_NAMES) {
      const icon = ICONS[name];
      expect(icon.w, name).toBe(12);
      expect(icon.h, name).toBe(12);
      expectValid(icon, `icon ${name}`);
    }
  });
});
