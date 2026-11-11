// Shared colours for the hand-drawn pixel art. Sprites reference these through
// single-character palette keys (see sprites.ts).

export const OUTLINE = '#1a1220';

/** Look options. Index = value stored in `profile.look`. */
export const SKIN_TONES: string[] = ['#f7d9bc', '#eab98f', '#c98b5e', '#9c6440', '#6b4128'];
export const HAIR_COLORS: string[] = ['#3b2a24', '#7a4722', '#b9602c', '#e6b54f', '#d8d3c8', '#9a3b34', '#3f5f9e'];
export const OUTFIT_COLORS: string[] = ['#3f6fb5', '#4e8a3e', '#a8432f', '#7b52a3', '#c48a2c', '#46546a'];

export const SKIN_NAMES = ['Clara', 'Média clara', 'Média', 'Morena', 'Escura'];
export const HAIR_COLOR_NAMES = ['Preto', 'Castanho', 'Ruivo', 'Loiro', 'Grisalho', 'Vermelho', 'Azul'];
export const OUTFIT_NAMES = ['Azul', 'Verde', 'Vermelho', 'Roxo', 'Mostarda', 'Ardósia'];

/** Fixed avatar details. */
export const LEATHER = '#5c3a21';
export const LEATHER_DARK = '#3d2616';
export const PANTS = '#4a3e3a';
export const BUCKLE = '#f2c14e';
export const EYE = '#1a1220';

/** Companion: brass lantern + flame spirit. */
export const BRASS_LIGHT = '#f8dc84';
export const BRASS = '#e0a63a';
export const BRASS_DARK = '#9a5c1c';
export const GLASS = '#2c2238';
export const GLASS_GLOW = '#5e3532';
export const GLASS_SHINE = '#77689a';
export const FLAME_RED = '#e0482c';
export const FLAME_ORANGE = '#f58f2c';
export const FLAME_YELLOW = '#ffd447';
export const FLAME_CORE = '#fff5c9';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Linear mix of two hex colours; t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** Shadow tone: towards a cool dark purple instead of plain black, like hand-picked pixel ramps. */
export const shade = (hex: string, t = 0.32): string => mix(hex, '#2a1838', t);
/** Highlight tone: towards warm white. */
export const light = (hex: string, t = 0.3): string => mix(hex, '#fff6e0', t);
