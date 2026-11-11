import { describe, it, expect } from 'vitest';
import type { Commitment, Journey, Mission } from '../src/types';
import { needsReview, occurrencesOn, suggest, todayList, type EngineInput } from '../src/engine';

let seq = 0;
function mk(p: Partial<Mission> = {}): Mission {
  seq += 1;
  return {
    id: `m${seq}`,
    createdAt: 1000 + seq,
    updatedAt: 1000 + seq,
    deleted: false,
    title: `Missão ${seq}`,
    checklist: [],
    status: 'open',
    important: false,
    shrunk: false,
    postponeCount: 0,
    ...p,
  };
}
function mkJourney(p: Partial<Journey> & { id: string }): Journey {
  return { createdAt: 1, updatedAt: 1, deleted: false, title: 'J', status: 'active', order: 0, ...p };
}
function mkCommitment(p: Partial<Commitment> = {}): Commitment {
  return {
    id: 'c1', createdAt: 1, updatedAt: 1, deleted: false, title: 'Reunião',
    date: '2026-11-11', start: '14:00', end: '15:00', remind: false, ...p,
  };
}

const NOW = new Date(2026, 10, 11, 10, 0).getTime(); // Wed 10:00
const TODAY = '2026-11-11';
function input(p: Partial<EngineInput> = {}): EngineInput {
  return {
    now: NOW, dayStartHour: 4, dayEndHour: 23, missions: [], journeys: [], commitments: [],
    hardDay: false, lastCompletionByArea: {}, ...p,
  };
}
const ids = (r: { mission: Mission }[]) => r.map((s) => s.mission.id);

describe('suggest', () => {
  it('1. empty', () => {
    const out = suggest(input());
    expect(out.mode).toBe('empty');
    expect(out.primary).toBeUndefined();
    expect(out.ranked).toEqual([]);
    expect(out.freeMinutes).toBe(780);
  });

  it('2. next commitment limits free time', () => {
    const big = mk({ id: 'big', durationMin: 300 });
    const small = mk({ id: 'small', durationMin: 60 });
    const out = suggest(input({ missions: [big, small], commitments: [mkCommitment()] }));
    expect(out.freeMinutes).toBe(240);
    expect(out.nextCommitment?.startTs).toBe(new Date(2026, 10, 11, 14, 0).getTime());
    expect(out.currentCommitment).toBeUndefined();
    expect(ids(out.ranked)).toEqual(['small']);
    expect(out.primary!.reasons).toEqual([{ code: 'fits', text: 'cabe no tempo livre', points: 10 }]);
    expect(out.primary!.score).toBe(10);
  });

  it('3. inside a commitment nothing is excluded', () => {
    const big = mk({ id: 'big', durationMin: 300 });
    const now = new Date(2026, 10, 11, 14, 30).getTime();
    const out = suggest(input({ now, missions: [big], commitments: [mkCommitment()] }));
    expect(out.freeMinutes).toBe(0);
    expect(out.currentCommitment?.commitment.id).toBe('c1');
    expect(ids(out.ranked)).toEqual(['big']);
    expect(out.primary!.reasons.find((r) => r.code === 'fits')).toBeUndefined();
  });

  it('5. manual order wins', () => {
    const a = mk({ id: 'A', dayOrder: 1, date: TODAY });
    const b = mk({ id: 'B', dayOrder: 0, date: TODAY });
    const c = mk({ id: 'C', deadline: TODAY });
    const out = suggest(input({ missions: [a, b, c] }));
    expect(out.mode).toBe('manual');
    expect(out.primary!.mission.id).toBe('B');
    expect(ids(out.ranked)).toEqual(['B', 'A', 'C']);
    expect(out.primary!.reasons[0]).toEqual({ code: 'manual', text: '1ª do seu plano de hoje', points: 0 });
    expect(out.ranked[1]!.reasons[0]).toEqual({ code: 'manual', text: '2ª do seu plano de hoje', points: 0 });
    expect(out.alternatives.map((s) => s.mission.id)).toEqual(['A', 'C']);
  });

  it('5b. manual mission that does not fit is skipped as primary', () => {
    const a = mk({ id: 'A', dayOrder: 0, date: TODAY, durationMin: 900 });
    const b = mk({ id: 'B', dayOrder: 1, date: TODAY, durationMin: 30 });
    const out = suggest(input({ missions: [a, b] }));
    expect(out.mode).toBe('manual');
    expect(ids(out.ranked)).toEqual(['B']);
    expect(out.primary!.reasons[0]!.text).toBe('1ª do seu plano de hoje');
  });

  it('6. score ordering and exact points', () => {
    const doing = mk({ id: 'doing', status: 'doing' });
    const imp = mk({ id: 'imp', important: true });
    const dl = mk({ id: 'dl', deadline: TODAY });
    const out = suggest(input({ missions: [imp, doing, dl] }));
    expect(out.mode).toBe('score');
    expect(ids(out.ranked)).toEqual(['dl', 'doing', 'imp']);
    expect(out.ranked.map((s) => s.score)).toEqual([40, 30, 15]);
    expect(out.ranked[1]!.reasons).toEqual([{ code: 'doing', text: 'você já começou', points: 30 }]);
    expect(out.ranked[2]!.reasons).toEqual([{ code: 'important', text: 'importante', points: 15 }]);
    expect(out.ranked[0]!.reasons).toEqual([{ code: 'deadline', text: 'prazo hoje', points: 40 }]);
    expect(out.alternatives.length).toBe(2);
  });

  it('6b. deadline tiers and planned reasons', () => {
    const cases: [string, number, string][] = [
      ['2026-11-10', 50, 'prazo passou'],
      ['2026-11-12', 25, 'prazo amanhã'],
      ['2026-11-14', 15, 'prazo em 3 dias'],
      ['2026-11-18', 5, 'prazo em 7 dias'],
    ];
    for (const [deadline, pts, text] of cases) {
      const out = suggest(input({ missions: [mk({ deadline })] }));
      expect(out.primary!.reasons).toEqual([{ code: 'deadline', text, points: pts }]);
    }
    expect(suggest(input({ missions: [mk({ deadline: '2026-11-19' })] })).primary!.score).toBe(0);
    const p1 = suggest(input({ missions: [mk({ date: TODAY })] })).primary!;
    expect(p1.reasons).toEqual([{ code: 'planned', text: 'planejada para hoje', points: 20 }]);
    const p2 = suggest(input({ missions: [mk({ date: '2026-11-09' })] })).primary!;
    expect(p2.reasons).toEqual([{ code: 'planned', text: 'ficou de outro dia', points: 20 }]);
  });

  it('7. energy', () => {
    const heavy = mk({ id: 'heavy', energy: 'heavy' });
    const light = mk({ id: 'light', energy: 'light' });
    const low = suggest(input({ missions: [heavy, light], energy: 'low' }));
    expect(ids(low.ranked)).toEqual(['light', 'heavy']);
    expect(low.ranked[1]!.score).toBe(-20);
    expect(low.ranked[1]!.reasons).toEqual([{ code: 'energy', text: 'pesada para agora', points: -20 }]);
    expect(low.ranked[0]!.score).toBe(10);
    expect(low.ranked[0]!.reasons[0]).toEqual({ code: 'energy', text: 'combina com sua energia', points: 10 });
    const high = suggest(input({ missions: [heavy, light], energy: 'high' }));
    expect(high.ranked[0]!.mission.id).toBe('heavy');
    expect(high.ranked[0]!.reasons).toEqual([{ code: 'energy', text: 'aproveita a energia alta', points: 15 }]);
    expect(high.ranked[1]!.reasons).toEqual([{ code: 'energy', text: 'leve para sua energia', points: 3 }]);
    const med = suggest(input({ missions: [heavy], energy: 'medium' }));
    expect(med.primary!.score).toBe(-5);
    const none = suggest(input({ missions: [heavy] }));
    expect(none.primary!.reasons).toEqual([]);
  });

  it('8. hard day', () => {
    const imp = mk({ id: 'imp', important: true, energy: 'heavy', durationMin: 90 });
    const light = mk({ id: 'light', energy: 'light', durationMin: 90 });
    const quick = mk({ id: 'quick', durationMin: 15 });
    const nodur = mk({ id: 'nodur' });
    const big = mk({ id: 'big', durationMin: 30, energy: 'medium' });
    const out = suggest(input({ hardDay: true, missions: [imp, light, quick, nodur, big] }));
    expect(ids(out.ranked).sort()).toEqual(['imp', 'light', 'quick']);
  });

  it('9. journeys', () => {
    const j = mkJourney({ id: 'J' });
    const arch = mkJourney({ id: 'X', status: 'archived' });
    const m0 = mk({ id: 'm0', journeyId: 'J', journeyOrder: 0 });
    const m1 = mk({ id: 'm1', journeyId: 'J', journeyOrder: 1 });
    const x = mk({ id: 'x', journeyId: 'X', journeyOrder: 0 });
    let out = suggest(input({ journeys: [j, arch], missions: [m1, m0, x] }));
    expect(ids(out.ranked)).toEqual(['m0']);
    const m1today = { ...m1, date: TODAY };
    out = suggest(input({ journeys: [j, arch], missions: [m1today, m0, x] }));
    expect(ids(out.ranked).sort()).toEqual(['m0', 'm1']);
  });

  it('10. exclusions', () => {
    const missions = [
      mk({ id: 'ok' }),
      mk({ snoozedUntil: NOW + 1000 }),
      mk({ notBefore: '2026-11-12' }),
      mk({ date: '2026-11-12' }),
      mk({ deleted: true }),
      mk({ status: 'done' }),
      mk({ status: 'dropped' }),
      mk({ id: 'snoozedPast', snoozedUntil: NOW - 1000 }),
      mk({ id: 'nbToday', notBefore: TODAY }),
    ];
    const out = suggest(input({ missions }));
    expect(ids(out.ranked).sort()).toEqual(['nbToday', 'ok', 'snoozedPast']);
  });

  it('11. skipIds move to the end', () => {
    const a = mk({ id: 'a', important: true });
    const b = mk({ id: 'b' });
    const c = mk({ id: 'c' });
    const out = suggest(input({ missions: [a, b, c], skipIds: ['a'] }));
    expect(ids(out.ranked)).toEqual(['b', 'c', 'a']);
    expect(out.primary!.mission.id).toBe('b');
    const two = suggest(input({ missions: [a, b, c], skipIds: ['b', 'a'] }));
    expect(ids(two.ranked)).toEqual(['c', 'b', 'a']);
  });

  it('12. postponedHint', () => {
    const out = suggest(input({ missions: [mk({ id: 'p', postponeCount: 3 }), mk({ id: 'q', postponeCount: 2 })] }));
    const p = out.ranked.find((s) => s.mission.id === 'p')!;
    const q = out.ranked.find((s) => s.mission.id === 'q')!;
    expect(p.postponedHint).toBe(true);
    expect(p.score).toBe(0);
    expect(q.postponedHint).toBe(false);
  });

  it('13. neglect', () => {
    const last = new Date(2026, 10, 3, 12, 0).getTime();
    const out = suggest(input({ missions: [mk({ areaId: 'a1' })], lastCompletionByArea: { a1: last } }));
    expect(out.primary!.reasons).toEqual([{ code: 'neglect', text: 'área esquecida há 8 dias', points: 5 }]);
    const recent = suggest(input({ missions: [mk({ areaId: 'a1' })], lastCompletionByArea: { a1: NOW - 3600000 } }));
    expect(recent.primary!.reasons).toEqual([]);
    const never = suggest(input({ missions: [mk({ areaId: 'a1' })] }));
    expect(never.primary!.reasons).toEqual([{ code: 'neglect', text: 'área ainda sem conquistas', points: 5 }]);
  });

  it('15. day boundary at 02:00', () => {
    const now = new Date(2026, 10, 12, 2, 0).getTime();
    const m = mk({ id: 'm', date: TODAY });
    const tomorrow = mk({ id: 't', date: '2026-11-12' });
    const out = suggest(input({ now, missions: [m, tomorrow] }));
    expect(ids(out.ranked)).toEqual(['m']);
    expect(out.freeMinutes).toBe(0);
    expect(out.currentCommitment).toBeUndefined();
    expect(out.primary!.reasons).toEqual([{ code: 'planned', text: 'planejada para hoje', points: 20 }]);
  });

  it('a commitment earlier than dayStartHour is on the next calendar morning of the day', () => {
    const now = new Date(2026, 10, 11, 23, 0).getTime();
    const night = mkCommitment({ id: 'night', date: TODAY, start: '02:00', end: '03:00' });
    const out = suggest(input({ now, dayEndHour: 3, commitments: [night] }));
    expect(out.currentCommitment).toBeUndefined();
    expect(out.nextCommitment?.commitment.id).toBe('night');
    expect(out.nextCommitment?.startTs).toBe(new Date(2026, 10, 12, 2, 0).getTime());
    expect(out.freeMinutes).toBe(180);
    // Still bounded by dayEndHour.
    expect(suggest(input({ now, dayEndHour: 1, commitments: [night] })).freeMinutes).toBe(120);
    expect(suggest(input({ now, dayEndHour: 23, commitments: [night] })).freeMinutes).toBe(0);
  });

  it('dayEndHour 0 means midnight after today', () => {
    expect(suggest(input({ dayEndHour: 0 })).freeMinutes).toBe(840);
  });
});

describe('occurrencesOn', () => {
  it('4. weekly commitments', () => {
    const w = mkCommitment({ date: '2026-11-02', weekdays: [3] });
    const occ = occurrencesOn([w], TODAY);
    expect(occ.length).toBe(1);
    expect(occ[0]!.date).toBe(TODAY);
    expect(occ[0]!.startTs).toBe(new Date(2026, 10, 11, 14, 0).getTime());
    expect(occurrencesOn([{ ...w, untilDate: '2026-11-10' }], TODAY)).toEqual([]);
    expect(occurrencesOn([w], '2026-11-12')).toEqual([]);
    expect(occurrencesOn([w], '2026-10-28')).toEqual([]);
  });
  it('sorted, excludes deleted, end before start rolls over', () => {
    const late = mkCommitment({ id: 'late', start: '22:00', end: '01:00' });
    const early = mkCommitment({ id: 'early', start: '08:00', end: '09:00' });
    const del = mkCommitment({ id: 'del', deleted: true });
    const occ = occurrencesOn([late, del, early], TODAY);
    expect(occ.map((o) => o.commitment.id)).toEqual(['early', 'late']);
    expect(occ[1]!.endTs).toBe(new Date(2026, 10, 12, 1, 0).getTime());
  });
  it('with dayStartHour, early-morning occurrences come after the evening ones', () => {
    const night = mkCommitment({ id: 'night', start: '02:00', end: '05:00' });
    const late = mkCommitment({ id: 'late', start: '22:00', end: '01:00' });
    const occ = occurrencesOn([night, late], TODAY, 4);
    expect(occ.map((o) => o.commitment.id)).toEqual(['late', 'night']);
    expect(occ[0]!.endTs).toBe(new Date(2026, 10, 12, 1, 0).getTime());
    expect(occ[1]!.startTs).toBe(new Date(2026, 10, 12, 2, 0).getTime());
    expect(occ[1]!.endTs).toBe(new Date(2026, 10, 12, 5, 0).getTime());
    expect(occ[1]!.date).toBe(TODAY);
    // Without dayStartHour the old calendar behaviour stays.
    expect(occurrencesOn([night], TODAY)[0]!.startTs).toBe(new Date(2026, 10, 11, 2, 0).getTime());
  });
});

describe('todayList / needsReview', () => {
  it('14. ordering', () => {
    const none1 = mk({ id: 'none1', date: '2026-11-10' });
    const ord1 = mk({ id: 'ord1', date: TODAY, dayOrder: 1 });
    const ord0 = mk({ id: 'ord0', date: TODAY, dayOrder: 0 });
    const doing = mk({ id: 'doing', status: 'doing' });
    const none2 = mk({ id: 'none2', date: TODAY });
    const future = mk({ id: 'future', date: '2026-11-12' });
    const del = mk({ id: 'del', date: TODAY, deleted: true });
    const done = mk({ id: 'done', date: TODAY, status: 'done' });
    const list = todayList([none2, future, del, done, doing, ord1, none1, ord0], TODAY, NOW);
    expect(list.map((m) => m.id)).toEqual(['ord0', 'ord1', 'doing', 'none1', 'none2']);
  });
  it('14b. needsReview', () => {
    const yest = mk({ id: 'yest', date: '2026-11-10' });
    const older = mk({ id: 'older', date: '2026-11-08' });
    const doing = mk({ id: 'doing', date: '2026-11-09', status: 'doing' });
    const dl = mk({ id: 'dl', deadline: '2026-11-10' });
    const todayM = mk({ id: 'today', date: TODAY });
    const del = mk({ id: 'del', date: '2026-11-01', deleted: true });
    const out = needsReview([yest, older, doing, dl, todayM, del], TODAY);
    expect(out.map((m) => m.id).sort()).toEqual(['dl', 'older', 'yest']);
    expect(out[0]!.id).toBe('older');
  });
});

describe('energy edge cases', () => {
  it('low energy × medium mission gets no energy reason', () => {
    const medium = mk({ id: 'medium', energy: 'medium' });
    const out = suggest(input({ missions: [medium], energy: 'low' }));
    expect(out.primary!.reasons).toEqual([]);
    expect(out.primary!.score).toBe(0);
  });
});
