import { describe, expect, it } from 'vitest';
import type { Block, Mission } from '../src/types';
import { isOfBlock, suggest, type EngineInput } from '../src/engine';
import { cueBlockDay } from '../src/planDay';

function blk(p: Partial<Block> & { id: string }): Block {
  return {
    createdAt: 1, updatedAt: 1, deleted: false, name: p.id, weekdays: [1, 2, 3, 4, 5], order: 0,
    targetStart: '09:00', durationMin: 60, minimumMin: 30, kind: 'focus', protected: false,
    checklist: [], archived: false, ...p,
  };
}
let seq = 0;
function mk(p: Partial<Mission> = {}): Mission {
  seq += 1;
  return {
    id: `c${seq}`, createdAt: 1000 + seq, updatedAt: 1000 + seq, deleted: false, title: `M ${seq}`,
    checklist: [], status: 'open', important: false, shrunk: false, postponeCount: 0, ...p,
  };
}

const MIN = (h: number, m = 0) => h * 60 + m;

describe('cueBlockDay (research P5)', () => {
  const tech = blk({ id: 'tech', weekdays: [1, 3], targetStart: '09:00' }); // seg, qua

  it('today when the block occurs today and has not started yet', () => {
    expect(cueBlockDay(tech, '2026-11-11', MIN(8, 30))).toBe('2026-11-11'); // quarta
  });

  it('the next occurrence once the block already started today', () => {
    expect(cueBlockDay(tech, '2026-11-11', MIN(9, 0))).toBe('2026-11-16'); // segunda
    expect(cueBlockDay(tech, '2026-11-11', MIN(14, 0))).toBe('2026-11-16');
  });

  it('the next occurrence when the block does not occur today', () => {
    expect(cueBlockDay(tech, '2026-11-12', MIN(7, 0))).toBe('2026-11-16'); // quinta -> segunda
  });

  it('undefined when the block never occurs', () => {
    expect(cueBlockDay(blk({ id: 'x', weekdays: [] }), '2026-11-11', MIN(7))).toBeUndefined();
  });
});

describe('cue block in the engine', () => {
  const NOW = new Date(2026, 10, 11, 10, 0).getTime();
  const base = (p: Partial<EngineInput> = {}): EngineInput => ({
    now: NOW, dayStartHour: 4, dayEndHour: 23, missions: [], journeys: [], commitments: [],
    hardDay: false, lastCompletionByArea: {}, ...p,
  });
  const block = { id: 'b-tech', areaId: 'a1', endTs: NOW + 3 * 3600_000 };

  it('isOfBlock accepts the cue link, even for another explicit blockId or area', () => {
    const m = mk({ cueBlockId: 'b-tech', blockId: 'other', areaId: 'zzz' });
    expect(isOfBlock(m, { id: 'b-tech' })).toBe(true);
    expect(isOfBlock(mk({ blockId: 'other' }), { id: 'b-tech' })).toBe(false);
  });

  it('inside the chosen block the cue mission ranks first, with its reason', () => {
    const cued = mk({ cueBlockId: 'b-tech', date: '2026-11-11' });
    const rival = mk({ areaId: 'a1', important: true, deadline: '2026-11-11', date: '2026-11-11' });
    const out = suggest(base({ missions: [rival, cued], block }));
    expect(out.primary?.mission.id).toBe(cued.id);
    expect(out.primary?.reasons.some((r) => r.code === 'cue')).toBe(true);
  });

  it('outside that block the cue gives no boost', () => {
    const cued = mk({ cueBlockId: 'b-tech', date: '2026-11-11' });
    const rival = mk({ important: true, date: '2026-11-11' });
    const out = suggest(base({ missions: [cued, rival], block: { id: 'b-other', endTs: block.endTs } }));
    expect(out.primary?.mission.id).toBe(rival.id);
    expect(out.ranked.find((s) => s.mission.id === cued.id)?.reasons.some((r) => r.code === 'cue')).toBe(false);
  });

  it('a cue mission planned for a later day is not a candidate yet', () => {
    const cued = mk({ cueBlockId: 'b-tech', date: '2026-11-16' });
    expect(suggest(base({ missions: [cued], block })).ranked).toEqual([]);
  });
});
