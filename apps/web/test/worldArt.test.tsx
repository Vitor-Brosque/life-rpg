import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BASE_OUTFITS, OUTFIT_UNLOCKS, type NpcKind } from '@life/shared';
import { ICON_NAMES } from '../src/art/icons';
import { OUTFIT_COLORS, OUTFIT_NAMES } from '../src/art/palette';
import { SpriteRects } from '../src/art/PixelSprite';
import type { Sprite } from '../src/art/sprites';
import {
  HUB_SPRITE, SPARKLE_SPRITE, TALK_SPRITE, areaTint, decoSprite, npcSprite, territorySprite,
} from '../src/art/worldSprites';

function expectValid(s: Sprite, label: string): void {
  expect(s.rows, `${label}: height`).toHaveLength(s.h);
  s.rows.forEach((row, y) => {
    expect(row.length, `${label}: row ${y}`).toBe(s.w);
    for (const ch of row) expect(ch === '.' || ch in s.palette, `${label}: key "${ch}" in row ${y}`).toBe(true);
  });
}

const KINDS: NpcKind[] = ['treinadora', 'herbalista', 'escriba', 'ferreira', 'intendente', 'bardo', 'mestra', 'andarilha'];

describe('world sprites', () => {
  it('every stage is a valid 24×24 sprite tinted with the area colour', () => {
    for (const stage of [0, 1, 2, 3, 4] as const) {
      const s = territorySprite(stage, '#e5675d');
      expect([s.w, s.h]).toEqual([24, 24]);
      expectValid(s, `stage ${stage}`);
      expect(s.palette.A).toBe('#e5675d');
    }
  });
  it('a colour that is not hex falls back to a neutral tint; sprites are cached', () => {
    expect(areaTint('red')).toBe('#9a8f7a');
    expect(areaTint('#A98BE0')).toBe('#A98BE0');
    expectValid(territorySprite(2, 'red'), 'stage with odd colour');
    expect(territorySprite(1, '#e5675d')).toBe(territorySprite(1, '#e5675d'));
    expect(npcSprite('bardo', '#e68fb5')).toBe(npcSprite('bardo', '#e68fb5'));
  });
  it('hub, scenery, NPCs, sparkle and talk bubble are valid', () => {
    expectValid(HUB_SPRITE, 'hub');
    for (const kind of ['floresta', 'lago', 'colinas'] as const) expectValid(decoSprite(kind), kind);
    const seen = new Set<string>();
    for (const kind of KINDS) {
      const s = npcSprite(kind, '#a98be0');
      expect([s.w, s.h]).toEqual([12, 16]);
      expectValid(s, kind);
      seen.add(s.rows.join('\n'));
    }
    expect(seen.size).toBe(KINDS.length);
    expectValid(SPARKLE_SPRITE, 'sparkle');
    expectValid(TALK_SPRITE, 'talk');
  });
  it('SpriteRects draws inside a parent svg, moved by translate', () => {
    const { container } = render(<svg><SpriteRects sprite={TALK_SPRITE} x={3} y={4} /></svg>);
    const g = container.querySelector('g')!;
    expect(g.getAttribute('transform')).toBe('translate(3 4)');
    expect(g.querySelectorAll('rect').length).toBeGreaterThan(0);
  });
});

describe('palette and icon', () => {
  it('outfit colours and names cover the base and the unlockable ones', () => {
    expect(OUTFIT_COLORS).toHaveLength(BASE_OUTFITS + OUTFIT_UNLOCKS.length);
    expect(OUTFIT_NAMES).toHaveLength(OUTFIT_COLORS.length);
    expect(OUTFIT_NAMES.slice(BASE_OUTFITS)).toEqual(['Esmeralda', 'Celeste', 'Carmim', 'Dourado']);
  });
  it('the map icon exists', () => {
    expect(ICON_NAMES).toContain('map');
  });
});
