import type { Area, ID, Journey, XpEvent } from './types';
import type { BlockOccurrence } from './planDay';
import type { Pt } from './sketch';
import { levelFromXp, type LevelInfo } from './xp';

// Mundo RPG (Marco 6, spec §4): everything here is derived from XP, areas, journeys and the day's
// blocks. Nothing is stored except the per-device "already celebrated" memory (WorldSeen).

// ------------------------------------------------------------------ stages

export type StageIndex = 0 | 1 | 2 | 3 | 4;

export interface StageInfo {
  stage: StageIndex;
  name: string;      // 'Aldeia'
  minLevel: number;  // attribute level where the stage starts
  a: string;         // with the indefinite article: 'uma aldeia'
  one: string;       // summary, one territory: 'aldeia'
  many: string;      // summary, several: 'aldeias'
}

export const STAGES: readonly StageInfo[] = [
  { stage: 0, name: 'Ruínas', minLevel: 1, a: 'ruínas', one: 'em ruínas', many: 'em ruínas' },
  { stage: 1, name: 'Acampamento', minLevel: 2, a: 'um acampamento', one: 'acampamento', many: 'acampamentos' },
  { stage: 2, name: 'Aldeia', minLevel: 5, a: 'uma aldeia', one: 'aldeia', many: 'aldeias' },
  { stage: 3, name: 'Vila', minLevel: 9, a: 'uma vila', one: 'vila', many: 'vilas' },
  { stage: 4, name: 'Castelo', minLevel: 14, a: 'um castelo', one: 'castelo', many: 'castelos' },
];

/** Cumulative XP at which `level` starts (same curve as levelFromXp). */
export function xpToReachLevel(level: number, attribute = false): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += levelFromXp(total, attribute).needed;
  return total;
}

export function stageForLevel(level: number): StageIndex {
  let stage: StageIndex = 0;
  for (const info of STAGES) if (level >= info.minLevel) stage = info.stage;
  return stage;
}

export interface NextStage { stage: StageIndex; level: number; xpLeft: number }
export interface StageProgress { level: LevelInfo; stage: StageIndex; next?: NextStage }

/** Attribute level, stage and what the next stage needs, from an area's XP. */
export function stageProgress(xp: number): StageProgress {
  const level = levelFromXp(xp, true);
  const stage = stageForLevel(level.level);
  const info = STAGES[stage + 1];
  if (!info) return { level, stage };
  return { level, stage, next: { stage: info.stage, level: info.minLevel, xpLeft: xpToReachLevel(info.minLevel, true) - Math.max(0, xp) } };
}

/** "7 territórios · 1 vila, 2 aldeias, 4 acampamentos" (highest stage first). */
export function stageSummary(stages: readonly StageIndex[]): string {
  if (stages.length === 0) return 'Nenhum território ainda';
  const head = stages.length === 1 ? '1 território' : `${stages.length} territórios`;
  const parts: string[] = [];
  for (let s = 4; s >= 0; s--) {
    const n = stages.filter((x) => x === s).length;
    if (n > 0) parts.push(`${n} ${n === 1 ? STAGES[s]!.one : STAGES[s]!.many}`);
  }
  return `${head} · ${parts.join(', ')}`;
}

// ------------------------------------------------------------------ outfit colours

/** Outfit indices 0..5 are always available; the rest unlock with the total level. */
export const BASE_OUTFITS = 6;
export const OUTFIT_UNLOCKS: ReadonlyArray<{ outfit: number; level: number }> = [
  { outfit: 6, level: 5 },   // Andarilho
  { outfit: 7, level: 8 },   // Guardião
  { outfit: 8, level: 12 },  // Cavaleiro
  { outfit: 9, level: 20 },  // Lenda
];

export function outfitUnlockLevel(outfit: number): number | undefined {
  return OUTFIT_UNLOCKS.find((u) => u.outfit === outfit)?.level;
}

/** Selectable outfit indices at `totalLevel`, ascending. */
export function unlockedOutfits(totalLevel: number): number[] {
  const base = Array.from({ length: BASE_OUTFITS }, (_, i) => i);
  return [...base, ...OUTFIT_UNLOCKS.filter((u) => totalLevel >= u.level).map((u) => u.outfit)];
}

// ------------------------------------------------------------------ NPCs

export type NpcKind = 'treinadora' | 'herbalista' | 'escriba' | 'ferreira' | 'intendente' | 'bardo' | 'mestra' | 'andarilha';
export interface Npc { kind: NpcKind; name: string; role: string }

const NPC_BY_AREA: Readonly<Record<string, NpcKind>> = {
  'area-vigor': 'treinadora',
  'area-equilibrio': 'herbalista',
  'area-intelecto': 'escriba',
  'area-oficio': 'ferreira',
  'area-ordem': 'intendente',
  'area-lacos': 'bardo',
  'area-facul': 'mestra',
};

const NPC_IDENTITY: Readonly<Record<Exclude<NpcKind, 'andarilha'>, { name: string; role: string }>> = {
  treinadora: { name: 'Dara', role: 'treinadora' },
  herbalista: { name: 'Sálvia', role: 'herbalista' },
  escriba: { name: 'Tomás', role: 'escriba' },
  ferreira: { name: 'Bruna', role: 'ferreira' },
  intendente: { name: 'Otávio', role: 'intendente' },
  bardo: { name: 'Lírio', role: 'bardo' },
  mestra: { name: 'Aurora', role: 'mestra da academia' },
};

/** Areas created by the user share the wanderer; the name varies with the id so two differ. */
const WANDERER_NAMES = ['Vela', 'Rumo', 'Brisa', 'Trilha'] as const;

export function npcOf(area: Pick<Area, 'id'>): Npc {
  const kind = NPC_BY_AREA[area.id];
  if (kind && kind !== 'andarilha') return { kind, ...NPC_IDENTITY[kind] };
  let sum = 0;
  for (const ch of area.id) sum += ch.charCodeAt(0);
  return { kind: 'andarilha', name: WANDERER_NAMES[sum % WANDERER_NAMES.length]!, role: 'andarilha' };
}

// ------------------------------------------------------------------ layout

export interface Cell { c: number; r: number }

/** World pixels per tile. Art inside a tile: building 24×24, NPC 12×16, avatar 16×16. */
export const TILE = 48;
export const HUB: Cell = { c: 1, r: 1 };
/** Fill order around the hub: the four sides first, then the corners. */
const RING: readonly Cell[] = [
  { c: 1, r: 0 }, { c: 2, r: 1 }, { c: 1, r: 2 }, { c: 0, r: 1 },
  { c: 0, r: 0 }, { c: 2, r: 0 }, { c: 2, r: 2 }, { c: 0, r: 2 },
];

export type DecoKind = 'floresta' | 'lago' | 'colinas';
const DECOS: readonly DecoKind[] = ['floresta', 'lago', 'colinas'];

export interface MapLayout { cols: number; rows: number; cells: Cell[]; empty: Cell[] }

const cellKey = (c: Cell): string => `${c.c},${c.r}`;

/** Cells for `n` territories: 3 columns, the hub in the middle, extra rows below after 8. */
export function mapLayout(n: number): MapLayout {
  const count = Math.max(0, Math.floor(n));
  const cells: Cell[] = [];
  for (let i = 0; i < count; i++) {
    cells.push(i < RING.length ? RING[i]! : { c: (i - RING.length) % 3, r: 3 + Math.floor((i - RING.length) / 3) });
  }
  const rows = count <= RING.length ? 3 : 3 + Math.ceil((count - RING.length) / 3);
  const used = new Set(cells.map(cellKey));
  const empty = RING.filter((c) => !used.has(cellKey(c)));
  for (let r = 3; r < rows; r++) for (let c = 0; c < 3; c++) if (!used.has(`${c},${r}`)) empty.push({ c, r });
  return { cols: 3, rows, cells, empty };
}

/** Top-row tiles carry their label above the art, so the hub's road never runs under a label. */
export const labelOnTop = (cell: Cell): boolean => cell.r === 0;
/** Vertical offset of the art inside a tile. */
export const artTop = (cell: Cell): number => (labelOnTop(cell) ? 10 : 0);
/** Centre of the building (world px): where roads start and end. */
export function anchorOf(cell: Cell): Pt {
  return { x: cell.c * TILE + 24, y: cell.r * TILE + artTop(cell) + 18 };
}

// ------------------------------------------------------------------ roads

/** 2-px road dots from a to b (Bresenham on a 2-px grid), both ends included. */
export function roadDots(a: Pt, b: Pt, step = 2): Array<[number, number]> {
  let x = Math.round(a.x / step);
  let y = Math.round(a.y / step);
  const x1 = Math.round(b.x / step);
  const y1 = Math.round(b.y / step);
  const dx = Math.abs(x1 - x);
  const dy = -Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let err = dx + dy;
  const out: Array<[number, number]> = [];
  for (;;) {
    out.push([x * step, y * step]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return out;
}

/** Distance from each anchor kept clear of markers (half a building plus a pixel). */
export const ROAD_CLEAR = 13;
export const MAX_MARKERS = 4;

export interface RoadMarker { x: number; y: number; done: boolean }

/**
 * Up to 4 milestone stones (3×3, top-left corner given) on the visible stretch of the road from
 * the hub (a) to the territory (b), with at least 1 px between them. The done ones come first,
 * from the hub outwards; all of them only when every mission is done.
 */
export function roadMarkers(a: Pt, b: Pt, done: number, total: number): RoadMarker[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const len = dist - 2 * ROAD_CLEAR;
  const fit = Math.floor(len / 4) - 1;
  if (total <= 0 || fit < 1) return [];
  const k = Math.min(total, MAX_MARKERS, fit);
  const filled = done >= total ? k : Math.floor((Math.max(0, done) * k) / total);
  const out: RoadMarker[] = [];
  for (let i = 0; i < k; i++) {
    const t = (ROAD_CLEAR + (len * (i + 1)) / (k + 1)) / dist;
    out.push({ x: Math.round(a.x + dx * t) - 1, y: Math.round(a.y + dy * t) - 1, done: i < filled });
  }
  return out;
}

// ------------------------------------------------------------------ avatar

/**
 * Where the avatar stands: the area of the current block; else the area of the most recently
 * started block today; else none (the hub). A block's area falls back to its journey's area.
 */
export function avatarAreaId(plan: readonly BlockOccurrence[], journeys: readonly Pick<Journey, 'id' | 'areaId'>[]): ID | undefined {
  const areaOf = (o: BlockOccurrence): ID | undefined =>
    o.block.areaId ?? (o.block.journeyId ? journeys.find((j) => j.id === o.block.journeyId)?.areaId : undefined);
  const current = plan.find((o) => o.state === 'current');
  const fromCurrent = current ? areaOf(current) : undefined;
  if (fromCurrent) return fromCurrent;
  const started = plan
    .filter((o) => o.session?.startedAt !== undefined)
    .sort((x, y) => y.session!.startedAt! - x.session!.startedAt!);
  for (const o of started) {
    const a = areaOf(o);
    if (a) return a;
  }
  return undefined;
}

// ------------------------------------------------------------------ the world

export interface WorldJourney { id: ID; title: string; areaId?: ID; order: number; done: number; total: number; nextTitle?: string }

export interface Territory {
  area: Area;
  index: number;
  cell: Cell;
  anchor: Pt;
  xp: number;
  level: LevelInfo;
  stage: StageIndex;
  next?: NextStage;
  npc: Npc;
  journeys: WorldJourney[];   // active journeys of the area, by order
  recent: XpEvent[];          // newest first, at most RECENT_PER_TERRITORY
  lastXpAt?: number;
}

export interface Road { areaId: ID; journeyId?: ID; dots: Array<[number, number]>; markers: RoadMarker[] }

export interface WorldModel {
  cols: number;
  rows: number;
  hub: { cell: Cell; anchor: Pt };
  territories: Territory[];
  empty: Array<{ cell: Cell; deco: DecoKind }>;
  roads: Road[];
  avatar: { areaId?: ID; cell: Cell };
}

export interface WorldInput {
  areas: readonly Area[];             // live, not archived, by order (the caller filters)
  xp: readonly XpEvent[];
  journeys: readonly WorldJourney[];  // active journeys with their progress
  avatarAreaId?: ID;
}

export const RECENT_PER_TERRITORY = 5;

export function buildWorld(input: WorldInput): WorldModel {
  const layout = mapLayout(input.areas.length);
  const byArea = new Map<ID, XpEvent[]>();
  for (const x of input.xp) {
    if (x.deleted || !x.areaId) continue;
    const list = byArea.get(x.areaId);
    if (list) list.push(x);
    else byArea.set(x.areaId, [x]);
  }
  const hubAnchor = anchorOf(HUB);
  const territories: Territory[] = input.areas.map((area, index) => {
    const events = (byArea.get(area.id) ?? []).slice().sort((p, q) => q.at - p.at);
    const xp = events.reduce((s, x) => s + x.amount, 0);
    const progress = stageProgress(xp);
    const cell = layout.cells[index]!;
    return {
      area, index, cell, anchor: anchorOf(cell), xp, level: progress.level, stage: progress.stage,
      ...(progress.next ? { next: progress.next } : {}),
      npc: npcOf(area),
      journeys: input.journeys.filter((j) => j.areaId === area.id).sort((p, q) => p.order - q.order),
      recent: events.slice(0, RECENT_PER_TERRITORY),
      ...(events[0] ? { lastXpAt: events[0].at } : {}),
    };
  });
  const roads: Road[] = territories.map((t) => {
    const j = t.journeys[0];
    return {
      areaId: t.area.id,
      ...(j ? { journeyId: j.id } : {}),
      dots: roadDots(hubAnchor, t.anchor),
      markers: j ? roadMarkers(hubAnchor, t.anchor, j.done, j.total) : [],
    };
  });
  const home = territories.find((t) => t.area.id === input.avatarAreaId);
  return {
    cols: layout.cols,
    rows: layout.rows,
    hub: { cell: HUB, anchor: hubAnchor },
    territories,
    empty: layout.empty.map((cell, i) => ({ cell, deco: DECOS[i % DECOS.length]! })),
    roads,
    avatar: home ? { areaId: home.area.id, cell: home.cell } : { cell: HUB },
  };
}

// ------------------------------------------------------------------ celebrations

export type WorldNews =
  | { kind: 'stage'; areaId: ID; stage: StageIndex; at: number }
  | { kind: 'outfit'; outfit: number; at: number };

/** Per-device memory (Dexie meta 'world'): the highest stage and the outfits already shown. */
export interface WorldSeen { stages: Record<ID, number>; outfits: number[]; news: WorldNews[] }

export interface WorldSnapshot {
  areas: Record<ID, { stage: StageIndex; lastXpAt?: number }>;
  totalLevel: number;
  lastXpAt?: number;
}

/** Only growth caused by XP earned in the last 30 min is celebrated (not sync catch-up). */
export const CELEBRATE_WINDOW_MS = 30 * 60_000;
export const NEWS_TTL_MS = 3 * 86_400_000;
export const NEWS_MAX = 6;

export function worldSnapshot(
  areas: readonly Pick<Area, 'id'>[],
  xp: readonly Pick<XpEvent, 'areaId' | 'amount' | 'at' | 'deleted'>[],
): WorldSnapshot {
  const sums = new Map<ID, number>();
  const last = new Map<ID, number>();
  let total = 0;
  let lastAll: number | undefined;
  for (const x of xp) {
    if (x.deleted) continue;
    total += x.amount;
    lastAll = lastAll === undefined ? x.at : Math.max(lastAll, x.at);
    if (!x.areaId) continue;
    sums.set(x.areaId, (sums.get(x.areaId) ?? 0) + x.amount);
    last.set(x.areaId, Math.max(last.get(x.areaId) ?? -Infinity, x.at));
  }
  const out: WorldSnapshot['areas'] = {};
  for (const a of areas) {
    const l = last.get(a.id);
    out[a.id] = { stage: stageProgress(sums.get(a.id) ?? 0).stage, ...(l !== undefined ? { lastXpAt: l } : {}) };
  }
  return { areas: out, totalLevel: levelFromXp(total).level, ...(lastAll !== undefined ? { lastXpAt: lastAll } : {}) };
}

function isNews(n: unknown): n is WorldNews {
  if (!n || typeof n !== 'object') return false;
  const r = n as Record<string, unknown>;
  if (typeof r.at !== 'number') return false;
  if (r.kind === 'stage') return typeof r.areaId === 'string' && typeof r.stage === 'number';
  return r.kind === 'outfit' && typeof r.outfit === 'number';
}

/** Whatever is stored under meta 'world', made safe; undefined when nothing usable is there. */
export function normalizeSeen(raw: unknown): WorldSeen | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const stages: Record<ID, number> = {};
  if (r.stages && typeof r.stages === 'object') {
    for (const [k, v] of Object.entries(r.stages as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) stages[k] = v;
    }
  }
  const outfits = Array.isArray(r.outfits) ? r.outfits.filter((o): o is number => typeof o === 'number') : [];
  const news = Array.isArray(r.news) ? r.news.filter(isNews) : [];
  return { stages, outfits, news };
}

export interface WorldProgress { seen: WorldSeen; celebrate: WorldNews[]; changed: boolean }

/**
 * Compares the world now with what this device already showed. First run (nothing stored): stores
 * the present silently. A stage above the stored one is stored and, when that area earned XP in the
 * last 30 min, celebrated; the same for outfit colours and the total level. The stored stage is the
 * highest ever, so undoing and redoing an action never celebrates twice.
 */
export function worldProgress(prev: WorldSeen | undefined, snap: WorldSnapshot, now: number): WorldProgress {
  const recent = (at?: number): boolean => at !== undefined && now - at <= CELEBRATE_WINDOW_MS;
  if (!prev) {
    const stages: Record<ID, number> = {};
    for (const [id, a] of Object.entries(snap.areas)) stages[id] = a.stage;
    return { seen: { stages, outfits: unlockedOutfits(snap.totalLevel), news: [] }, celebrate: [], changed: true };
  }
  const stages = { ...prev.stages };
  const celebrate: WorldNews[] = [];
  let changed = false;
  for (const [id, a] of Object.entries(snap.areas)) {
    const before = stages[id];
    if (before === undefined) {
      stages[id] = a.stage;
      changed = true;
    } else if (a.stage > before) {
      stages[id] = a.stage;
      changed = true;
      if (recent(a.lastXpAt)) celebrate.push({ kind: 'stage', areaId: id, stage: a.stage, at: now });
    }
  }
  const outfits = [...prev.outfits];
  for (const o of unlockedOutfits(snap.totalLevel)) {
    if (outfits.includes(o)) continue;
    outfits.push(o);
    changed = true;
    if (o >= BASE_OUTFITS && recent(snap.lastXpAt)) celebrate.push({ kind: 'outfit', outfit: o, at: now });
  }
  outfits.sort((x, y) => x - y);
  const news = [...celebrate, ...prev.news].filter((n) => now - n.at <= NEWS_TTL_MS).slice(0, NEWS_MAX);
  return { seen: { stages, outfits, news }, celebrate, changed };
}

/** News still worth showing (the last 3 days), newest first. */
export function activeNews(seen: WorldSeen | undefined, now: number): WorldNews[] {
  return (seen?.news ?? []).filter((n) => now - n.at <= NEWS_TTL_MS);
}
