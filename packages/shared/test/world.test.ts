import { describe, expect, it } from 'vitest';
import type { Area, Block, BlockSession, XpEvent } from '../src/types';
import type { BlockOccurrence } from '../src/planDay';
import {
  BASE_OUTFITS, CELEBRATE_WINDOW_MS, NEWS_TTL_MS, activeNews, anchorOf, avatarAreaId, buildWorld, mapLayout,
  normalizeSeen, npcOf, outfitUnlockLevel, roadDots, roadMarkers, stageForLevel, stageProgress, stageSummary,
  unlockedOutfits, worldProgress, worldSnapshot, xpToReachLevel, type WorldSeen,
} from '../src/world';

const area = (id: string, order = 0, extra: Partial<Area> = {}): Area => ({
  id, name: id, attribute: id, color: '#e5675d', icon: 'heart', order, archived: false,
  createdAt: 1, updatedAt: 1, deleted: false, ...extra,
});
let seq = 0;
const xp = (amount: number, fields: Partial<XpEvent> = {}): XpEvent => ({
  id: `x${++seq}`, at: 1000 + seq, amount, reason: 'complete', dayKey: '2026-11-13',
  createdAt: 1, updatedAt: 1, deleted: false, ...fields,
});

describe('stages', () => {
  it('xpToReachLevel follows levelFromXp (attribute curve: 20, 30, 40…)', () => {
    expect(xpToReachLevel(1, true)).toBe(0);
    expect(xpToReachLevel(2, true)).toBe(20);
    expect(xpToReachLevel(5, true)).toBe(140);
    expect(xpToReachLevel(9, true)).toBe(440);
    expect(xpToReachLevel(14, true)).toBe(1040);
    expect(xpToReachLevel(2)).toBe(40);
  });
  it('stageForLevel: ruins 1, camp 2–4, village 5–8, town 9–13, castle 14+', () => {
    expect([1, 2, 4, 5, 8, 9, 13, 14, 30].map(stageForLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it('stageProgress gives the XP left to the next stage, none at the castle', () => {
    expect(stageProgress(0)).toMatchObject({ stage: 0, next: { stage: 1, level: 2, xpLeft: 20 } });
    expect(stageProgress(100)).toMatchObject({ stage: 1, level: { level: 4 }, next: { stage: 2, level: 5, xpLeft: 40 } });
    expect(stageProgress(140).stage).toBe(2);
    const castle = stageProgress(1040);
    expect(castle.stage).toBe(4);
    expect(castle.next).toBeUndefined();
  });
  it('stageSummary lists the highest stage first, with plurals', () => {
    expect(stageSummary([1, 1, 2, 0, 3, 1, 1])).toBe('7 territórios · 1 vila, 1 aldeia, 4 acampamentos, 1 em ruínas');
    expect(stageSummary([4])).toBe('1 território · 1 castelo');
    expect(stageSummary([0, 0])).toBe('2 territórios · 2 em ruínas');
    expect(stageSummary([])).toBe('Nenhum território ainda');
  });
});

describe('outfit unlocks', () => {
  it('six base colours always; more at total levels 5, 8, 12 and 20', () => {
    expect(unlockedOutfits(1)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(unlockedOutfits(5)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(unlockedOutfits(12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(unlockedOutfits(20)).toHaveLength(10);
    expect(outfitUnlockLevel(7)).toBe(8);
    expect(outfitUnlockLevel(2)).toBeUndefined();
    expect(BASE_OUTFITS).toBe(6);
  });
});

describe('npcOf', () => {
  it('maps the known areas and gives user areas a wanderer with a stable name', () => {
    expect(npcOf({ id: 'area-intelecto' })).toEqual({ kind: 'escriba', name: 'Tomás', role: 'escriba' });
    expect(npcOf({ id: 'area-facul' })).toEqual({ kind: 'mestra', name: 'Aurora', role: 'mestra da academia' });
    const w = npcOf({ id: '01HXCUSTOM' });
    expect(w.kind).toBe('andarilha');
    expect(['Vela', 'Rumo', 'Brisa', 'Trilha']).toContain(w.name);
    expect(npcOf({ id: '01HXCUSTOM' })).toEqual(w);
  });
});

describe('layout', () => {
  it('fills the sides of the hub first, then the corners; empty cells get scenery', () => {
    const l = mapLayout(7);
    expect(l.cols).toBe(3);
    expect(l.rows).toBe(3);
    expect(l.cells).toEqual([
      { c: 1, r: 0 }, { c: 2, r: 1 }, { c: 1, r: 2 }, { c: 0, r: 1 }, { c: 0, r: 0 }, { c: 2, r: 0 }, { c: 2, r: 2 },
    ]);
    expect(l.empty).toEqual([{ c: 0, r: 2 }]);
  });
  it('after 8 territories it grows downwards in rows of 3', () => {
    const l = mapLayout(10);
    expect(l.rows).toBe(4);
    expect(l.cells.slice(8)).toEqual([{ c: 0, r: 3 }, { c: 1, r: 3 }]);
    expect(l.empty).toEqual([{ c: 2, r: 3 }]);
    expect(mapLayout(0)).toEqual({ cols: 3, rows: 3, cells: [], empty: expect.any(Array) });
    expect(mapLayout(0).empty).toHaveLength(8);
  });
  it('anchors: top-row art sits 10 px lower (its label goes on top)', () => {
    expect(anchorOf({ c: 1, r: 1 })).toEqual({ x: 72, y: 66 });
    expect(anchorOf({ c: 1, r: 0 })).toEqual({ x: 72, y: 28 });
    expect(anchorOf({ c: 2, r: 2 })).toEqual({ x: 120, y: 114 });
  });
});

describe('roads', () => {
  it('roadDots walks a 2-px grid, both ends included', () => {
    expect(roadDots({ x: 0, y: 0 }, { x: 8, y: 0 })).toEqual([[0, 0], [2, 0], [4, 0], [6, 0], [8, 0]]);
    expect(roadDots({ x: 0, y: 0 }, { x: 6, y: 6 })).toEqual([[0, 0], [2, 2], [4, 4], [6, 6]]);
    expect(roadDots({ x: 4, y: 4 }, { x: 4, y: 0 })).toEqual([[4, 4], [4, 2], [4, 0]]);
  });
  it('roadMarkers: up to 4 stones with a gap, done ones nearest the hub', () => {
    const hub = { x: 72, y: 66 };
    expect(roadMarkers(hub, { x: 120, y: 66 }, 1, 2)).toEqual([
      { x: 91, y: 65, done: true }, { x: 99, y: 65, done: false },
    ]);
    const four = roadMarkers(hub, { x: 120, y: 66 }, 3, 10);
    expect(four.map((m) => m.done)).toEqual([true, false, false, false]);
    expect(four.map((m) => m.x)).toEqual([88, 93, 97, 102]);
    expect(roadMarkers(hub, { x: 120, y: 66 }, 10, 10).every((m) => m.done)).toBe(true);
  });
  it('a short road (the tile above the hub) fits only 2; no missions, no stones', () => {
    const hub = { x: 72, y: 66 };
    expect(roadMarkers(hub, { x: 72, y: 28 }, 0, 9)).toEqual([
      { x: 71, y: 48, done: false }, { x: 71, y: 44, done: false },
    ]);
    expect(roadMarkers(hub, { x: 120, y: 66 }, 0, 0)).toEqual([]);
  });
});

describe('avatarAreaId', () => {
  const block = (id: string, fields: Partial<Block> = {}): Block => ({
    id, name: id, weekdays: [1], order: 0, targetStart: '09:00', durationMin: 60, minimumMin: 15, kind: 'focus',
    protected: false, checklist: [], archived: false, createdAt: 1, updatedAt: 1, deleted: false, ...fields,
  });
  const occ = (b: Block, state: BlockOccurrence['state'], startedAt?: number): BlockOccurrence => ({
    block: b, day: '2026-11-13', plannedStart: 0, plannedEnd: 1, start: 0, end: 1, version: 'normal', shrunk: false, state,
    ...(startedAt !== undefined
      ? { session: { id: `bs-${b.id}`, blockId: b.id, day: '2026-11-13', startedAt, version: 'normal', createdAt: 1, updatedAt: 1, deleted: false } as BlockSession }
      : {}),
  });
  it('current block first, then the latest started one with an area, through the journey', () => {
    const journeys = [{ id: 'j1', areaId: 'area-oficio' }];
    expect(avatarAreaId([occ(block('a', { areaId: 'area-vigor' }), 'current')], journeys)).toBe('area-vigor');
    expect(avatarAreaId([
      occ(block('a', { areaId: 'area-vigor' }), 'done', 100),
      occ(block('b', { journeyId: 'j1' }), 'done', 200),
      occ(block('c'), 'current', 300),
    ], journeys)).toBe('area-oficio');
    expect(avatarAreaId([occ(block('a', { areaId: 'area-vigor' }), 'upcoming')], journeys)).toBeUndefined();
  });
});

describe('buildWorld', () => {
  it('derives every territory from XP, with recent actions, journeys, roads and the avatar', () => {
    const areas = [area('area-vigor', 0), area('area-intelecto', 1), area('area-lacos', 2)];
    const events = [
      xp(25, { areaId: 'area-vigor', at: 10 }), xp(130, { areaId: 'area-intelecto', at: 20 }),
      xp(5, { areaId: 'area-vigor', at: 30, deleted: true }), xp(7, { at: 40 }),
    ];
    const w = buildWorld({
      areas, xp: events, avatarAreaId: 'area-intelecto',
      journeys: [
        { id: 'j2', title: 'B', areaId: 'area-intelecto', order: 2, done: 0, total: 3 },
        { id: 'j1', title: 'A', areaId: 'area-intelecto', order: 1, done: 1, total: 2 },
      ],
    });
    expect(w.territories.map((t) => [t.area.id, t.xp, t.stage])).toEqual([
      ['area-vigor', 25, 1], ['area-intelecto', 130, 1], ['area-lacos', 0, 0],
    ]);
    const intel = w.territories[1]!;
    expect(intel.next).toEqual({ stage: 2, level: 5, xpLeft: 10 });
    expect(intel.journeys.map((j) => j.id)).toEqual(['j1', 'j2']);
    expect(intel.npc.kind).toBe('escriba');
    expect(w.territories[0]!.recent.map((x) => x.at)).toEqual([10]);
    expect(w.roads[1]).toMatchObject({ areaId: 'area-intelecto', journeyId: 'j1' });
    expect(w.roads[1]!.markers.length).toBeGreaterThan(0);
    expect(w.roads[0]!.journeyId).toBeUndefined();
    expect(w.roads[0]!.markers).toEqual([]);
    expect(w.avatar).toEqual({ areaId: 'area-intelecto', cell: { c: 2, r: 1 } });
    expect(w.empty).toHaveLength(5);
    expect(w.empty[0]!.deco).toBe('floresta');
  });
  it('without a known avatar area, the avatar rests at the hub', () => {
    expect(buildWorld({ areas: [area('a')], xp: [], journeys: [], avatarAreaId: 'gone' }).avatar).toEqual({ cell: { c: 1, r: 1 } });
  });
});

describe('celebrations', () => {
  const NOW = 10_000_000;
  const areas = [area('area-vigor'), area('area-ordem')];
  it('first run stores the present silently', () => {
    const snap = worldSnapshot(areas, [xp(25, { areaId: 'area-vigor', at: NOW })]);
    const r = worldProgress(undefined, snap, NOW);
    expect(r.celebrate).toEqual([]);
    expect(r.changed).toBe(true);
    expect(r.seen).toEqual({ stages: { 'area-vigor': 1, 'area-ordem': 0 }, outfits: [0, 1, 2, 3, 4, 5], news: [] });
  });
  it('a stage-up from XP earned now is celebrated once; old XP (sync) only updates', () => {
    const seen: WorldSeen = { stages: { 'area-vigor': 0, 'area-ordem': 0 }, outfits: [0, 1, 2, 3, 4, 5], news: [] };
    const fresh = worldProgress(seen, worldSnapshot(areas, [xp(25, { areaId: 'area-vigor', at: NOW - 1000 })]), NOW);
    expect(fresh.celebrate).toEqual([{ kind: 'stage', areaId: 'area-vigor', stage: 1, at: NOW }]);
    expect(fresh.seen.news).toEqual(fresh.celebrate);
    const again = worldProgress(fresh.seen, worldSnapshot(areas, [xp(25, { areaId: 'area-vigor', at: NOW - 1000 })]), NOW + 1);
    expect(again.celebrate).toEqual([]);
    expect(again.changed).toBe(false);
    const old = worldProgress(seen, worldSnapshot(areas, [xp(25, { areaId: 'area-vigor', at: NOW - CELEBRATE_WINDOW_MS - 1 })]), NOW);
    expect(old.celebrate).toEqual([]);
    expect(old.seen.stages['area-vigor']).toBe(1);
  });
  it('undo then redo never celebrates twice (the stored stage is the highest)', () => {
    const seen: WorldSeen = { stages: { 'area-vigor': 1, 'area-ordem': 0 }, outfits: [0, 1, 2, 3, 4, 5], news: [] };
    expect(worldProgress(seen, worldSnapshot(areas, []), NOW).seen.stages['area-vigor']).toBe(1);
  });
  it('a new outfit colour from the total level is celebrated; a new area is stored silently', () => {
    const seen: WorldSeen = { stages: { 'area-vigor': 0 }, outfits: [0, 1, 2, 3, 4, 5], news: [] };
    const r = worldProgress(seen, worldSnapshot(areas, [xp(280, { at: NOW })]), NOW);
    expect(r.celebrate).toEqual([{ kind: 'outfit', outfit: 6, at: NOW }]);
    expect(r.seen.outfits).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(r.seen.stages['area-ordem']).toBe(0);
  });
  it('news expire after 3 days; junk in storage is cleaned', () => {
    const seen: WorldSeen = { stages: {}, outfits: [], news: [{ kind: 'outfit', outfit: 6, at: NOW - NEWS_TTL_MS - 1 }] };
    expect(activeNews(seen, NOW)).toEqual([]);
    expect(normalizeSeen({ stages: { a: 2, b: 'x' }, outfits: [1, 'y'], news: [{ kind: 'stage', areaId: 'a', stage: 2, at: 5 }, { kind: 'odd' }] }))
      .toEqual({ stages: { a: 2 }, outfits: [1], news: [{ kind: 'stage', areaId: 'a', stage: 2, at: 5 }] });
    expect(normalizeSeen(null)).toBeUndefined();
    expect(normalizeSeen('x')).toBeUndefined();
  });
});
