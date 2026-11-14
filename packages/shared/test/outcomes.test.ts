import { describe, expect, it } from 'vitest';
import { BLOCKERS, BLOCK_OUTCOME_LABEL, SNOOZE_REASON_LABEL, blockerOption, isSnoozeReason, latestResult, oneLine } from '../src/outcomes';
import { postponeObserved } from '../src/postpone';
import { TODAY, emptyData, event, mission } from './patternFixture';

describe('outcomes', () => {
  it('oneLine collapses, trims and cuts; blank is undefined', () => {
    expect(oneLine('  dedupe   por URL\nfeito ')).toBe('dedupe por URL feito');
    expect(oneLine('   ')).toBeUndefined();
    expect(oneLine(undefined)).toBeUndefined();
    expect(oneLine('a'.repeat(200))).toHaveLength(140);
  });
  it('labels and blockers', () => {
    expect(BLOCK_OUTCOME_LABEL['nao-deu']).toBe('Não deu');
    expect(SNOOZE_REASON_LABEL['nao-sei-comecar']).toBe('Não sei por onde começar');
    expect(isSnoozeReason('sem-tempo')).toBe(true);
    expect(isSnoozeReason('preguiça')).toBe(false);
    expect(BLOCKERS.map((b) => b.offer)).toEqual(['step', 'step', 'shrink', 'step', 'experiment']);
    expect(blockerOption('falta-informacao').step).toBe('Anotar a dúvida e onde encontrar a resposta');
  });
  it('latestResult: the newest live event of the kinds; a newer blank clears it', () => {
    const evs = [
      event('result', 'm1', TODAY, '10:00', { result: 'primeira versão' }),
      event('partial', 'm1', TODAY, '11:00', { result: 'falta teste' }),
      event('result', 'm1', TODAY, '12:00', { result: 'versão final' }),
      { ...event('result', 'm1', TODAY, '13:00', { result: 'apagado' }), deleted: true },
      event('result', 'm2', TODAY, '14:00', { result: 'outra' }),
    ];
    expect(latestResult(evs, 'm1')).toMatchObject({ kind: 'result', result: 'versão final' });
    expect(latestResult(evs, 'm1', ['partial'])).toMatchObject({ kind: 'partial', result: 'falta teste' });
    expect(latestResult([...evs, event('result', 'm1', TODAY, '15:00', { result: '' })], 'm1')).toBeUndefined();
    expect(latestResult(evs, 'm3')).toBeUndefined();
  });
});

describe('postponeObserved: reasons', () => {
  it('counts the reasons marked on snoozed events of the window; partial events are not postponements', () => {
    const m = mission({ id: 'm1', title: 'Relatório' });
    const o = postponeObserved(emptyData({
      missions: [m],
      events: [
        event('snoozed', 'm1', TODAY, '09:00', { option: 'tomorrow', reason: 'sem-energia' }),
        event('snoozed', 'm1', '2026-11-12', '09:00', { option: 'later', reason: 'sem-tempo' }),
        event('snoozed', 'm1', '2026-11-11', '09:00', { option: 'later', reason: 'sem-energia' }),
        event('snoozed', 'm1', '2026-11-10', '09:00', { option: 'later' }),
        event('snoozed', 'm1', '2026-11-10', '10:00', { option: 'later', reason: 'inventado' }),
        event('snoozed', 'm1', '2026-09-01', '09:00', { option: 'later', reason: 'sem-tempo' }),
        event('partial', 'm1', TODAY, '15:00', { result: 'metade', option: 'tomorrow' }),
      ],
    }));
    expect(o.postponed).toBe(5);
    expect(o.reasons).toEqual([
      { key: 'sem-energia', label: 'Sem energia', count: 2 },
      { key: 'sem-tempo', label: 'Sem tempo', count: 1 },
    ]);
  });
  it('no reasons marked: empty list', () => {
    expect(postponeObserved(emptyData()).reasons).toEqual([]);
  });
});
