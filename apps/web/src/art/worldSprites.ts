import type { DecoKind, NpcKind, StageIndex } from '@life/shared';
import { OUTLINE, light, shade } from './palette';
import type { Sprite } from './sprites';

// Mundo RPG (Marco 6): territory stages, the Encruzilhada, scenery and NPCs, drawn in code like
// every other sprite. Keys A/a/L are the territory's area colour (base, shadow, highlight).

export const WORLD_PALETTE: Readonly<Record<string, string>> = {
  o: OUTLINE,
  S: '#8b8fa8', s: '#5b5f7a', T: '#c3c6d8',   // stone
  W: '#9a6a3c', w: '#5c3a21',                 // wood
  C: '#efe2c0', c: '#c4ad82',                 // canvas
  Y: '#ffd447', e: '#2a1a14',                 // lit window, dark opening (doors, eyes)
  G: '#3d7336', g: '#79bf5f',                 // grass and leaves
  F: '#f58f2c', f: '#ffe07a', r: '#e0482c',   // fire
  D: '#a07d52',                               // dirt path
  k: '#eab98f',                               // NPC skin
  B: '#7a4722', P: '#f1e3c4', n: '#5a4632',   // book, paper, ink
  M: '#c3c6d8', m: '#5b5f7a',                 // metal
  V: '#6fbf4a', N: '#f2c14e',                 // leaf, gold
  i: '#4f8fd0', u: '#9fd0f0',                 // water
};

export const GRASS = '#4f8f45';
export const GRASS_LIGHT = '#5ea152';
export const GRASS_DARK = '#437d3b';
export const ROAD_DIRT = '#8c7350';
export const ROAD_STONE = '#cdb88f';
export const MARKER_DONE = '#f2c14e';
export const MARKER_OPEN = '#3b4063';

const FALLBACK_TINT = '#9a8f7a';
/** Area colours are hex in practice; anything else would break the shade/light ramp. */
export function areaTint(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : FALLBACK_TINT;
}

const tinted = (color: string): Record<string, string> => {
  const c = areaTint(color);
  return { ...WORLD_PALETTE, A: c, a: shade(c), L: light(c) };
};

const STAGE_ROWS: readonly (readonly string[])[] = [
  // 0 Ruínas: broken walls, rubble and a torn flag in the area colour.
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '..................oooo..',
    '..................wALLo.',
    '..................wAAo..',
    '...oo.............waAo..',
    '..oTTo............wo.o..',
    '..oTSo............w.....',
    '..oSSo..oo........w.....',
    '..oSso.oTTo.......w.....',
    '..oTSo.oTSo.......w.....',
    '..oSsooSSso.......w.....',
    '.oSSssoSsssooooo..w..g..',
    '.oSssssSsssoTTSSo.w.gG..',
    'oSSsssssssssSSssoowGgG..',
    'oooooooooooooooooooooo..',
    '..gG...oo.......gG......',
    '...g..oTSo...........g..',
    '......oooo..............',
  ],
  // 1 Acampamento: a striped tent with a pennant, a campfire and a log.
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '.........o..............',
    '.........wooo...........',
    '.........wALo...........',
    '.........wAo............',
    '........owo.............',
    '.......oCCo.............',
    '......oCCcCo............',
    '.....oCCAcCCo...........',
    '....oCCAAcCCCo..........',
    '...oCCAAacCCCCo.........',
    '..oCCAAaacCCCCCo........',
    '.oCCCAeeacCCCCCCo.......',
    'oCCCCAeeacCCCCCCCo..r...',
    'ooooooeeooooooooooorFr..',
    '.......ee........rFfFr..',
    '..gG.........oWWWwoFfo..',
    '...g..........owwwwooo..',
    '.............g......gG..',
    '........................',
  ],
  // 2 Aldeia: two huts with roofs in the area colour and a fence.
  [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '.....oo.................',
    '....oAAo................',
    '...oAAAAo...............',
    '..oAALLAAo.......oo.....',
    '.oAAAAAAAAo.....oAAo....',
    'oaaaaaaaaaao...oAAAAo...',
    '.oWWWWWWWWo...oAALLAAo..',
    '.oWYYwWeeWo..oaaaaaaaao.',
    '.oWYYwWeeWo...oWWWWWWo..',
    '.oWwwwWeeWo...oWYwWeeo..',
    '.oWWWWWeeWo...oWwwWeeo..',
    '.oooooooooo...oooooooo..',
    '........................',
    'ow.ow.ow.ow.ow.ow.ow.ow.',
    'oWooWooWooWooWooWooWooW.',
    'owwowwowwowwowwowwowwow.',
    '.gG.......gG.......g....',
    '..g...............gG....',
    '........................',
  ],
  // 3 Vila: three stone houses with lit windows and a stone wall.
  [
    '........................',
    '........................',
    '........................',
    '..........oo............',
    '.........oAAo...........',
    '........oAAAAo..........',
    '.......oAALLAAo.........',
    '..oo..oAAAAAAAAo..oo....',
    '.oAAooaaaaaaaaaaooAAo...',
    'oAAAAooSSSSSSSSoAAAAAo..',
    'aaaaaaoSYYSSYYSaaaaaaao.',
    'oSSSSSoSYYSSYYSoSSSSSo..',
    'oSYYSSoSSSSSSSSoSSYYSo..',
    'oSYYSSoSSSeeSSSoSSYYSo..',
    'oSSSSSoSSSeeSSSoSSSSSo..',
    'oSSeeSoSSSeeSSSoSeeSSo..',
    'oSSeeSoSSSeeSSSoSeeSSo..',
    'ooooooooooooooooooooooo.',
    'TSTSTSTSTSTSTSTSTSTSTST.',
    'SsSsSsSsSsSsSsSsSsSsSsS.',
    'ooooooooooooooooooooooo.',
    '.gG........DD.......gG..',
    '..g........DD........g..',
    '........................',
  ],
  // 4 Castelo: two towers with banners, a keep with the area crest and a gate.
  [
    '....o..............o....',
    '....oo.............oo...',
    '....oALo...........oALo.',
    '....oAo............oAo..',
    '...owo............owo...',
    '..oAAAo..........oAAAo..',
    '.oAALAAo........oAALAAo.',
    'oaaaaaaao......oaaaaaaao',
    '.oTSTSTo.o.oo.o.oTSTSTo.',
    '.oSSSSSooToTToTooSSSSSo.',
    '.oSSYSSoSSSSSSSSoSSYSSo.',
    '.oSSYSSoSSSSSSSSoSSYSSo.',
    '.oSSSSSoSSAAAASSoSSSSSo.',
    '.oSSSsSoSSALLASSoSsSSSo.',
    '.oSSSSSoSSAAAASSoSSSSSo.',
    '.oSsSSSoSSSaaSSSoSSSsSo.',
    '.oSSSSSoSSoeeoSSoSSSSSo.',
    '.oSSSSSoSoeeeeoSoSSSSSo.',
    '.oSSSSsoSoeeeeoSosSSSSo.',
    '.oSsSSSoSoeeeeoSoSSSsSo.',
    'oooooooooooooooooooooooo',
    '.gG.......oDDo......gG..',
    '..g.......oDDo.......g..',
    '........................',
  ],
];

const stageCache = new Map<string, Sprite>();
/** 24×24 sprite of a territory stage, tinted with the area colour (cached per stage and colour). */
export function territorySprite(stage: StageIndex, color: string): Sprite {
  const key = `${stage}|${areaTint(color)}`;
  let sprite = stageCache.get(key);
  if (!sprite) {
    sprite = { w: 24, h: 24, rows: [...STAGE_ROWS[stage]!], palette: tinted(color) };
    stageCache.set(key, sprite);
  }
  return sprite;
}

/** The Encruzilhada: a signpost and a campfire (24×24). */
export const HUB_SPRITE: Sprite = {
  w: 24,
  h: 24,
  palette: { ...WORLD_PALETTE },
  rows: [
    '........................',
    '........................',
    '........................',
    '.........oooooooo.......',
    '.........oWWWWWWWoo.....',
    '.........oWwwwwwWWWo....',
    '.........oWWWWWWWoo.....',
    '.....ooooooooWoooo......',
    '....ooWWWWWWWWo.........',
    '...oWWWwwwwwwWo.........',
    '....ooWWWWWWWWo.........',
    '.......ooooWooo.........',
    '...........Wo...........',
    '...........Wo...........',
    '...........Wo...........',
    '...........Wo....o......',
    '...........Wo...oro.....',
    '...........Wo..orFro....',
    '..........oWo..rFfFr....',
    '..........oWo.oFfffFo...',
    '...gG....ooooowWwwWwo...',
    '....g..........owwwo..g.',
    '..................gG....',
    '........................',
  ],
};

const DECO_ROWS: Readonly<Record<DecoKind, readonly string[]>> = {
  floresta: [
    '........................',
    '........................',
    '.......oo...............',
    '......oGGo..............',
    '.....oGgGGo.......oo....',
    '....oGgGGGGo.....oGGo...',
    '...oGGgGGGGGo...oGgGGo..',
    '....oGGGGGGo...oGgGGGGo.',
    '...oGgGGGGGGo...oGGGGo..',
    '..oGGgGGGGGGGo.oGgGGGGo.',
    '...oooGGGGooo.oGGgGGGGGo',
    '.....ooowooo...oooGGooo.',
    '.......owo.......owo....',
    '...oo..owo.......owo....',
    '..oGGo.owo.......ooo....',
    '.oGgGGo.o...............',
    'oGgGGGGo................',
    '.oGGGGo.................',
    'oGgGGGGo................',
    '.ooowoo.................',
    '...owo..................',
    '...ooo..........gG......',
    '.................g......',
    '........................',
  ],
  lago: [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '.......oooooooooo.......',
    '.....ooiiiiiiiiiioo.....',
    '....oiiiuuiiiiiiiiio....',
    '...oiiiiiiiiiuuiiiiio...',
    '..oiiuuiiiiiiiiiiiiiio..',
    '..oiiiiiiiiiiiiiuuiiio..',
    '..oiiiiiiuuiiiiiiiiiio..',
    '...oiiiiiiiiiiiiiiiio...',
    '....oiiiiiiiiuuiiiio....',
    '.....ooiiiiiiiiiioo.....',
    '.......oooooooooo.......',
    '...gG.............g.....',
    '....g............gG.....',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  colinas: [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '.......oooo.............',
    '.....ooGGggoo...........',
    '....oGGGGGggGo..........',
    '...oGGGGGGGGgGo..oooo...',
    '..oGGGGGGGGGGGGooGGggoo.',
    '.oGGGGGGGGGGGGGGGGGGGgGo',
    'oGGGGGGGGGGGGGGGGGGGGGGo',
    'oooooooooooooooooooooooo',
    '........................',
    '...g.......gG...........',
    '..gG........g.......g...',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
};

const decoCache = new Map<DecoKind, Sprite>();
/** Scenery for an empty cell (24×24). */
export function decoSprite(kind: DecoKind): Sprite {
  let sprite = decoCache.get(kind);
  if (!sprite) {
    sprite = { w: 24, h: 24, rows: [...DECO_ROWS[kind]], palette: { ...WORLD_PALETTE } };
    decoCache.set(kind, sprite);
  }
  return sprite;
}

/** NPC body: hood and robe in the area colour, 8 px wide inside a 12×16 box. */
const NPC_BASE = [
  '..oooo......',
  '.oLAAAo.....',
  'oLAAAAAo....',
  'oAkkkkAo....',
  'okekkeko....',
  'okkkkkko....',
  '.okkkko.....',
  'ooaAAaoo....',
  'oAAaaAAo....',
  'okAAAAko....',
  'okAAAAko....',
  '.oAAAAo.....',
  '.oaAAao.....',
  '.oAAAAo.....',
  '.owoowo.....',
  '.oooooo.....',
];

/** What each NPC holds (5×9, drawn at column 7, row 6 of the NPC box). */
const ACCESSORIES: Readonly<Record<NpcKind, readonly string[]>> = {
  treinadora: ['.....', '.....', '.....', 'om.mo', 'omMmo', 'omMmo', 'om.mo', '.....', '.....'],   // dumbbell
  herbalista: ['.oVo.', 'oVVVo', '.oVwo', '...w.', '...w.', '...w.', '...w.', '...w.', '...w.'],   // leafy staff
  escriba: ['.....', '.....', 'oooo.', 'oBPBo', 'oBPBo', 'oBPBo', 'oooo.', '.....', '.....'],      // book
  ferreira: ['.ooo.', 'oMMMo', 'oMmMo', '.owo.', '..w..', '..w..', '..w..', '.....', '.....'],     // hammer
  intendente: ['.....', '.oNo.', 'oN.No', '.oNo.', '..N..', 'ooooo', 'oMMMo', 'oMmMo', '.ooo.'],  // keys and a marmita
  bardo: ['...ow', '..ow.', '.ow..', 'oWWo.', 'WWeWo', 'WeWWo', 'oWWo.', '.oo..', '.....'],        // lute
  mestra: ['.....', '.....', 'ooooo', 'oPPPo', 'oPnPo', 'oPPPo', 'oPnPo', 'ooooo', '.....'],       // scroll
  andarilha: ['.ooo.', '.oNo.', '.ooo.', '..w..', '..w..', '..w..', '..w..', '..w..', '..w..'],    // walking staff
};

function withAccessory(acc: readonly string[]): string[] {
  return NPC_BASE.map((row, y) => {
    const top = acc[y - 6];
    if (!top) return row;
    let out = row.slice(0, 7);
    for (let x = 0; x < 5; x++) out += top[x] !== '.' ? top[x] : row[7 + x];
    return out;
  });
}

const npcCache = new Map<string, Sprite>();
/** 12×16 NPC of a territory, in the area colour. */
export function npcSprite(kind: NpcKind, color: string): Sprite {
  const key = `${kind}|${areaTint(color)}`;
  let sprite = npcCache.get(key);
  if (!sprite) {
    sprite = { w: 12, h: 16, rows: withAccessory(ACCESSORIES[kind]), palette: tinted(color) };
    npcCache.set(key, sprite);
  }
  return sprite;
}

/** Shown for 3 days on a territory that grew. */
export const SPARKLE_SPRITE: Sprite = {
  w: 5, h: 5, palette: { ...WORLD_PALETTE }, rows: ['..N..', '..N..', 'NNfNN', '..N..', '..N..'],
};

/** "…" bubble over an NPC that has a line about today. */
export const TALK_SPRITE: Sprite = {
  w: 7, h: 6, palette: { ...WORLD_PALETTE }, rows: ['.ooooo.', 'oCCCCCo', 'oCoCoCo', 'oCCCCCo', '.ooCoo.', '...o...'],
};
