import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Settings, XpEvent } from '@life/shared';
import { normalizeSeen } from '@life/shared';
import { db } from '../src/db/db';
import { getMeta, newRecord, patch, put, setMeta } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { useCompanion } from '../src/features/companion/store';
import { WorldWatcher, checkWorld } from '../src/features/world/WorldWatcher';

const xp = (amount: number, fields: Partial<XpEvent> = {}): XpEvent =>
  newRecord<XpEvent>({ at: Date.now(), amount, reason: 'complete', dayKey: '2026-11-13', ...fields });

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureSeed();
  useCompanion.getState().clear();
});

const liveAreas = async () => (await db.areas.toArray()).filter((a) => !a.deleted && !a.archived);

describe('checkWorld', () => {
  it('first run stores the present silently', async () => {
    expect(await checkWorld(await liveAreas(), [xp(25, { areaId: 'area-vigor' })])).toEqual([]);
    expect(normalizeSeen(await getMeta('world'))?.stages).toMatchObject({ 'area-vigor': 1, 'area-ordem': 0 });
  });

  it('a stage reached with fresh XP comes back once; old XP only updates', async () => {
    const areas = await liveAreas();
    await checkWorld(areas, []);
    const now = Date.now();
    const fresh = await checkWorld(areas, [xp(25, { areaId: 'area-vigor', at: now })], now);
    expect(fresh).toEqual([{ kind: 'stage', areaId: 'area-vigor', stage: 1, at: now }]);
    expect(await checkWorld(areas, [xp(25, { areaId: 'area-vigor', at: now })], now)).toEqual([]);
    const old = await checkWorld(areas, [xp(140, { areaId: 'area-ordem', at: now - 31 * 60_000 })], now);
    expect(old).toEqual([]);
    expect(normalizeSeen(await getMeta('world'))?.stages['area-ordem']).toBe(2);
  });

  it('an empty or unrecognised stored memory is a first run, never everything new', async () => {
    const now = Date.now();
    const list = [xp(5000, { areaId: 'area-ordem', at: now })];
    for (const junk of [{}, 'oops', { stages: 5 }]) {
      await setMeta('world', junk);
      expect(await checkWorld(await liveAreas(), list, now)).toEqual([]);
      expect(normalizeSeen(await getMeta('world'))?.stages['area-ordem']).toBeGreaterThanOrEqual(3);
    }
  });

  it('simultaneous checks never celebrate twice', async () => {
    const areas = await liveAreas();
    await checkWorld(areas, []);
    const list = [xp(25, { areaId: 'area-vigor' })];
    const [a, b] = await Promise.all([checkWorld(areas, list), checkWorld(areas, list)]);
    expect(a.length + b.length).toBe(1);
  });
});

describe('WorldWatcher', () => {
  it('the companion celebrates a territory that grows', async () => {
    await setMeta('world', { stages: { 'area-vigor': 0 }, outfits: [0, 1, 2, 3, 4, 5], news: [] });
    render(<WorldWatcher />);
    await put('xpEvents', xp(25, { areaId: 'area-vigor' }));
    await waitFor(() => expect(useCompanion.getState().message).toBe('O território de Vigor agora é um acampamento!'), { timeout: 4000 });
    expect(normalizeSeen(await getMeta('world'))?.news[0]).toMatchObject({ kind: 'stage', areaId: 'area-vigor', stage: 1 });
  });

  it('a muted companion says nothing, but the news is kept', async () => {
    await patch<Settings>('settings', 'settings', { companionMuted: true });
    await setMeta('world', { stages: { 'area-vigor': 0 }, outfits: [0, 1, 2, 3, 4, 5], news: [] });
    render(<WorldWatcher />);
    await put('xpEvents', xp(25, { areaId: 'area-vigor' }));
    await waitFor(async () => expect(normalizeSeen(await getMeta('world'))?.news).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 1700));
    expect(useCompanion.getState().message).toBeUndefined();
  });
});
