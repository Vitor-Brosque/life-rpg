import { describe, expect, it } from 'vitest';
import { DAY_STATE_KEYS, DAY_STATE_LEGEND, DAY_STATE_OPTIONS, pickChoices } from '../src/dayClose';
import { appDayLine, diaryAppDays } from '../src/diary';
import { base } from './patternFixture';
import { SYNC_TABLES } from '../src/types';

describe('estado do dia: the four choices', () => {
  it('legends and chips, in order', () => {
    expect(DAY_STATE_KEYS.map((k) => [DAY_STATE_LEGEND[k], DAY_STATE_OPTIONS[k].map((o) => o.label)])).toEqual([
      ['Cansaço durante o dia', ['Pouco', 'Médio', 'Muito']],
      ['Humor', ['Para baixo', 'Ok', 'Bem']],
      ['Sobrecarga', ['Leve', 'Média', 'Pesada']],
      ['Concentração', ['Difícil', 'Ok', 'Boa']],
    ]);
    expect(DAY_STATE_OPTIONS.mood.map((o) => o.value)).toEqual(['baixo', 'ok', 'bem']);
  });
  it('pickChoices keeps only the touched keys, an undefined one included (it clears)', () => {
    const picked = pickChoices({ tiredness: 'medio', mood: 'ok', load: undefined }, ['mood', 'load']);
    expect(Object.keys(picked)).toEqual(['mood', 'load']);
    expect(picked).toEqual({ mood: 'ok', load: undefined });
    expect(pickChoices({ mood: 'ok' }, [])).toEqual({});
  });
  it('the speech tables come right before the proposals, then the nutrition tables, the caderno tables and the PDFs close the list', () => {
    expect(SYNC_TABLES.slice(-15)).toEqual([
      'goals', 'seasons', 'speechSessions', 'speechSituations', 'speechPrograms', 'proposals',
      'foods', 'nutritionTargets', 'foodLogs', 'pantry', 'weighIns',
      'subjectNotebooks', 'studyDocs',
      'studyFiles', 'studyFileProgress',
    ]);
  });
});

describe('appDayLine with the new choices', () => {
  it('after cansaço: humor, sobrecarga, concentração', () => {
    expect(appDayLine({ tiredness: 'medio', mood: 'baixo', load: 'media', concentration: 'boa' }))
      .toBe('cansaço: médio · humor: para baixo · sobrecarga: média · concentração: boa');
    expect(appDayLine({ mood: 'ok' })).toBe('humor: ok');
  });
  it('diaryAppDays copies them from the day', () => {
    const days = diaryAppDays({
      days: ['2026-11-10'], dayStartHour: 4, dayEndHour: 0, blocks: [], commitments: [], sessions: [], dayPlans: [],
      trainingLogs: [], workouts: [], sleepLogs: [],
      dayStates: [{ ...base, id: '2026-11-10', hardDay: false, reviewDone: false, mood: 'bem', load: 'leve', concentration: 'dificil' }],
    });
    expect(days).toEqual({ '2026-11-10': { mood: 'bem', load: 'leve', concentration: 'dificil' } });
  });
});
