import type { CharacterLook } from '@life/shared';
import {
  BRASS, BRASS_DARK, BRASS_LIGHT, BUCKLE, EYE, FLAME_CORE, FLAME_ORANGE, FLAME_RED, FLAME_YELLOW,
  GLASS, GLASS_GLOW, GLASS_SHINE, HAIR_COLORS, LEATHER, LEATHER_DARK, OUTFIT_COLORS, OUTLINE, PANTS,
  SKIN_TONES, light, mix, shade,
} from './palette';

export { HAIR_COLORS, OUTFIT_COLORS, SKIN_TONES };

/** A pixel sprite: each char of a row is a palette key; '.' is transparent. */
export interface Sprite { w: number; h: number; rows: string[]; palette: Record<string, string> }

// ---------------------------------------------------------------------------
// Companion "Faísca": a flame spirit living in a brass lantern. 16×16, 2 frames.
// ---------------------------------------------------------------------------

const COMPANION_PALETTE: Record<string, string> = {
  o: OUTLINE,
  G: BRASS_LIGHT,
  B: BRASS,
  D: BRASS_DARK,
  g: GLASS,
  a: GLASS_GLOW,
  h: GLASS_SHINE,
  R: FLAME_RED,
  O: FLAME_ORANGE,
  Y: FLAME_YELLOW,
  W: FLAME_CORE,
  e: EYE,
};

/** Builds a lantern frame around 7 rows × 8 columns of glass (flame) content. */
function lantern(glass: string[]): Sprite {
  return {
    w: 16,
    h: 16,
    palette: COMPANION_PALETTE,
    rows: [
      '......DDDD......',
      '.....D....D.....',
      '.....oGBBDo.....',
      '....oGBBBBDo....',
      '..oDDDDDDDDDDo..',
      ...glass.map((g) => `..oB${g}Do..`),
      '..oDDDDDDDDDDo..',
      '...oGBBBBBBDo...',
      '....oooooooo....',
      '................',
    ],
  };
}

export const SPRITES: { companion: [Sprite, Sprite] } = {
  companion: [
    lantern([
      'gggaRagg',
      'hgaRORgg',
      'hgRYORag',
      'gROYYORg',
      'gReYYeRg',
      'gROWWORg',
      'gaRRRRag',
    ]),
    lantern([
      'ggaRaggg',
      'hgRORgOg',
      'hgROYRag',
      'gROYYORg',
      'gReYYeRg',
      'gROWWORg',
      'gaRRRRag',
    ]),
  ],
};

// ---------------------------------------------------------------------------
// Avatar: 16×16 front-facing chibi adventurer, composed from layers.
// ---------------------------------------------------------------------------

export const HAIR_STYLES_COUNT = 4 as const;
export const HAIR_STYLE_NAMES = ['Curto', 'Longo', 'Rabo de cavalo', 'Cacheado'];

/** Body + outfit (tunic, belt, pants, boots). Bald head; hair is layered on top. */
const AVATAR_BASE = [
  '................',
  '.....oooooo.....',
  '....osssssso....',
  '...osssssssSo...',
  '...ossessesSo...',
  '...ossessesSo...',
  '....orssssro....',
  '....oooSSooo....',
  '...otttssttto...',
  '..oTLtttttttTo..',
  '..oTLtttttttTo..',
  '..osbbbkkbbbso..',
  '...otttttttTo...',
  '....oppooppo....',
  '....offooffo....',
  '....ooo..ooo....',
];

/** Hair overlays: '.' keeps the layer below. Rows not listed are untouched. */
const HAIR_STYLES: string[][] = [
  // 0 — Curto: short, side-swept fringe.
  [
    '.....oooooo.....',
    '....ohhjjhho....',
    '...ohhjhhhhho...',
    '...ohhhhH..ho...',
    '...oh......ho...',
  ],
  // 1 — Longo: long, centre part, falling past the shoulders.
  [
    '.....oooooo.....',
    '....ohjhHjho....',
    '...ohjhhHhhjo...',
    '..ohhhH..Hhhho..',
    '..ohh......hho..',
    '..ohh......hho..',
    '..ohhh....hhho..',
    '..ohhhh..hhhho..',
    '..ohhH....Hhho..',
    '..ohH......Hho..',
    '..oH........Ho..',
  ],
  // 2 — Rabo de cavalo: swept back, tied, tail to the side.
  [
    '.....oooooo.....',
    '....ohhjjhho....',
    '...ohhjhhhhhooo.',
    '...ohh....hhoko.',
    '...oh......ohho',
    '............ohHo',
    '............ohHo',
    '............oHo.',
    '.............o..',
  ],
  // 3 — Cacheado: voluminous curls.
  [
    '....oooooooo....',
    '...ohjhhjhhjo...',
    '..ohjHhjHhjHho..',
    '..ohHhjHhhjHho..',
    '..ohH......Hho..',
    '..ohh......hho..',
    '...oh......ho...',
  ],
];

function pick<T>(list: readonly T[], index: number): T {
  const n = list.length;
  const i = Number.isFinite(index) ? Math.trunc(index) : 0;
  return list[((i % n) + n) % n]!;
}

function overlay(base: string[], layer: string[]): string[] {
  return base.map((row, y) => {
    const top = layer[y];
    if (!top) return row;
    let out = '';
    for (let x = 0; x < row.length; x++) out += top[x] && top[x] !== '.' ? top[x] : row[x];
    return out;
  });
}

export function avatarSprite(look: CharacterLook): Sprite {
  const skin = pick(SKIN_TONES, look.skin);
  const hair = pick(HAIR_COLORS, look.hairColor);
  const outfit = pick(OUTFIT_COLORS, look.outfit);
  return {
    w: 16,
    h: 16,
    rows: overlay(AVATAR_BASE, pick(HAIR_STYLES, look.hair)),
    palette: {
      o: OUTLINE,
      e: EYE,
      s: skin,
      S: shade(skin, 0.22),
      r: mix(skin, '#e8675e', 0.35),
      h: hair,
      H: shade(hair),
      j: light(hair, 0.28),
      t: outfit,
      T: shade(outfit),
      L: light(outfit, 0.22),
      b: LEATHER,
      k: BUCKLE,
      p: PANTS,
      f: LEATHER_DARK,
    },
  };
}
