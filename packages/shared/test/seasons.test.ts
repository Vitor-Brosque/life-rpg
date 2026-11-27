import { describe, expect, it } from 'vitest';
import type { Goal, Season, Strategy } from '../src/types';
import {
  activeSeason, newSeasonDraft, seasonChanges, seasonDraftOf, seasonFields, seasonFocusText, seasonFocusTexts, seasonIssue,
  seasonLine, seasonLinkFrom, seasonLinkValue, seasonObserved, seasonReviewOf, seasonSkippedNote, seasonWeek, seasonsInRange,
} from '../src/seasons';
import { atypicalWeek, base, block, emptyData, session, xp } from './patternFixture';

const season = (id: string, p: Partial<Season> = {}): Season => ({
  ...base, id, title: `Temporada ${id}`, focus: [], startDay: '2026-11-16', plannedWeeks: 6, status: 'ativa', ...p,
});
const NONE = new Set<string>();

describe('the active season', () => {
  it('one at a time: the latest start, then the newest created; ended and deleted ones out', () => {
    expect(activeSeason([])).toBeUndefined();
    expect(activeSeason([season('a', { status: 'encerrada', endedDay: '2026-11-20' })])).toBeUndefined();
    expect(activeSeason([
      season('a', { startDay: '2026-11-02' }), season('b', { startDay: '2026-11-09', createdAt: 5 }),
      season('c', { startDay: '2026-11-09', createdAt: 9 }), season('d', { startDay: '2026-11-30', deleted: true }),
    ])?.id).toBe('c');
  });
});

describe('the weeks of a season', () => {
  const s = { startDay: '2026-11-18', plannedWeeks: 6 };   // a Wednesday: its week (16/11) is week 1
  it('week N of M from the start week, Monday-based', () => {
    expect(seasonWeek(s, NONE, '2026-11-18')).toEqual({
      number: 1, planned: 6, atypicalNow: false, skipped: 0, lastWeek: '2026-12-21', over: false, reviewDue: false,
    });
    expect(seasonWeek(s, NONE, '2026-11-30').number).toBe(3);
    const last = seasonWeek(s, NONE, '2026-12-21');
    expect([last.number, last.reviewDue, last.over]).toEqual([6, true, false]);
    const after = seasonWeek(s, NONE, '2026-12-28');
    expect([after.number, after.reviewDue, after.over]).toEqual([7, true, true]);
  });
  it('an atypical week does not count and moves the planned end one week (also when marked ahead)', () => {
    const atypical = new Set(['2026-11-30']);
    const w = seasonWeek(s, atypical, '2026-12-07');
    expect(w).toEqual({ number: 3, planned: 6, atypicalNow: false, skipped: 1, lastWeek: '2026-12-28', over: false, reviewDue: false });
    expect(seasonWeek(s, atypical, '2026-12-01')).toMatchObject({ number: 2, atypicalNow: true, skipped: 1 });
    expect(seasonWeek(s, new Set(['2026-12-14']), '2026-11-18').lastWeek).toBe('2026-12-28');
  });
  it('the line never says "7 de 6"', () => {
    const t = { title: ' Consistência  no Tech ' };
    expect(seasonLine(t, seasonWeek(s, NONE, '2026-11-30'))).toBe('Temporada: Consistência no Tech · semana 3 de 6');
    expect(seasonLine(t, seasonWeek(s, new Set(['2026-11-30']), '2026-12-01')))
      .toBe('Temporada: Consistência no Tech · semana atípica, fora da conta');
    expect(seasonLine(t, seasonWeek(s, NONE, '2026-12-28'))).toBe('Temporada: Consistência no Tech · as 6 semanas planejadas terminaram');
  });
  it('the note about the weeks left out', () => {
    expect(seasonSkippedNote({ skipped: 0 })).toBeUndefined();
    expect(seasonSkippedNote({ skipped: 1 })).toBe('1 semana atípica ficou fora da conta.');
    expect(seasonSkippedNote({ skipped: 2 })).toBe('2 semanas atípicas ficaram fora da conta.');
  });
});

describe('the observed numbers of the season', () => {
  const tech = block({ id: 'tech', name: 'Tech', minimumMin: 30 });
  it('Padrões trend rules over the usual weeks up to yesterday; atypical weeks and the days before the start left out', () => {
    const data = emptyData({
      today: '2026-11-25',
      blocks: [tech],
      sessions: [
        session('tech', '2026-11-13'),                  // before the start
        session('tech', '2026-11-16'), session('tech', '2026-11-17', '09:00', 'minimum'),
        session('tech', '2026-11-24'),                  // atypical week
        session('tech', '2026-11-25'),                  // today: not read
      ],
      xpEvents: [xp('2026-11-16'), xp('2026-11-17'), xp('2026-11-17', { reason: 'resumption' })],
      weeks: [atypicalWeek('2026-11-23')],
    });
    expect(seasonObserved(data, { startDay: '2026-11-16' })).toEqual({
      from: '2026-11-16', to: '2026-11-24', weeks: 1, skipped: 1,
      lines: [
        { label: 'Blocos iniciados', value: '2 de 5 (versão mínima em 1)' },
        { label: 'Dias úteis ativos', value: '2 de 5' },
        { label: 'Retomadas', value: '1' },
      ],
    });
  });
  it('a season that ended earlier stops at its end; nothing recorded gives no line (never "0 de N")', () => {
    const data = emptyData({ today: '2026-11-25', blocks: [tech], sessions: [session('tech', '2026-11-16'), session('tech', '2026-11-18')] });
    expect(seasonObserved(data, { startDay: '2026-11-16', endedDay: '2026-11-17' }).lines)
      .toEqual([{ label: 'Blocos iniciados', value: '1 de 2' }]);
    expect(seasonObserved(emptyData({ today: '2026-11-25', blocks: [tech] }), { startDay: '2026-11-16' }).lines).toEqual([]);
  });
  it('started today: nothing to read yet', () => {
    expect(seasonObserved(emptyData({ today: '2026-11-25' }), { startDay: '2026-11-25' }))
      .toEqual({ from: '2026-11-25', to: '2026-11-24', weeks: 0, skipped: 0, lines: [] });
  });
});

describe('focus lines', () => {
  const goals = [{ ...base, id: 'g', title: 'Carreira em Dados', status: 'ativo', order: 0 } as Goal];
  const strategies = [
    { ...base, id: 's', title: 'Celular longe', source: 'ideia', startDay: '2026-11-16', reviewDay: '2026-11-30', status: 'testando' } as Strategy,
    { ...base, id: 't', title: 'Apagada', source: 'ideia', startDay: '2026-11-16', reviewDay: '2026-11-30', status: 'testando', trashedAt: 3 } as Strategy,
  ];
  const names = { goals, strategies };
  it('his words, the linked name, or both', () => {
    expect(seasonFocusText({ text: ' bloco  do Tech ' }, names)).toBe('bloco do Tech');
    expect(seasonFocusText({ link: { kind: 'goal', id: 'g' } }, names)).toBe('Carreira em Dados');
    expect(seasonFocusText({ text: 'Fase 1', link: { kind: 'strategy', id: 's' } }, names)).toBe('Fase 1 · Celular longe');
    expect(seasonFocusText({ link: { kind: 'strategy', id: 't' } }, names)).toBeUndefined();
    expect(seasonFocusText({ link: { kind: 'goal', id: 'nope' } }, names)).toBeUndefined();
    expect(seasonFocusTexts(season('a', { focus: [{ text: 'A' }, { link: { kind: 'goal', id: 'nope' } }] }), names)).toEqual(['A']);
  });
  it('the select value', () => {
    expect(seasonLinkValue(undefined)).toBe('');
    expect(seasonLinkValue({ kind: 'goal', id: 'g1' })).toBe('goal:g1');
    expect(seasonLinkFrom('strategy:s1')).toEqual({ kind: 'strategy', id: 's1' });
    expect(seasonLinkFrom('')).toBeUndefined();
    expect(seasonLinkFrom('journey:j1')).toBeUndefined();
    expect(seasonLinkFrom('goal:')).toBeUndefined();
  });
  it('the seasons of a report period (an active one runs until today)', () => {
    const list = [
      season('old', { startDay: '2026-09-01', status: 'encerrada', endedDay: '2026-10-10' }),
      season('end', { startDay: '2026-10-12', status: 'encerrada', endedDay: '2026-11-10' }),
      season('now', { startDay: '2026-11-16' }),
      season('gone', { startDay: '2026-11-16', deleted: true }),
    ];
    expect(seasonsInRange(list, { start: '2026-11-09', end: '2026-11-15' }, '2026-11-23').map((s) => s.id)).toEqual(['end']);
    expect(seasonsInRange(list, { start: '2026-11-09', end: '2026-11-22' }, '2026-11-23').map((s) => s.id)).toEqual(['end', 'now']);
  });
});

describe('the sheet', () => {
  it('a new draft: today, six weeks, two blank focus rows; a name is required and the start goes up to today', () => {
    const d = newSeasonDraft('2026-11-23');
    expect(d).toEqual({ title: '', focus: [{ text: '' }, { text: '' }], startDay: '2026-11-23', plannedWeeks: 6 });
    expect(seasonIssue(d, '2026-11-23')).toBe('title');
    expect(seasonIssue({ ...d, title: 'Consistência', startDay: '2026-11-24' }, '2026-11-23')).toBe('start');
    expect(seasonIssue({ ...d, title: 'Consistência', startDay: '' }, '2026-11-23')).toBe('start');
    expect(seasonIssue({ ...d, title: 'Consistência', startDay: '2026-11-02' }, '2026-11-23')).toBeUndefined();
  });
  it('the stored form drops blank focus rows and keeps a link alone', () => {
    const d = { ...newSeasonDraft('2026-11-23'), title: ' Consistência ', plannedWeeks: 9,
      focus: [{ text: '  ' }, { text: ' Fala: fase 1 ', link: { kind: 'goal' as const, id: 'g' } }] };
    expect(seasonFields(d)).toEqual({
      title: 'Consistência', focus: [{ text: 'Fala: fase 1', link: { kind: 'goal', id: 'g' } }], startDay: '2026-11-23', plannedWeeks: 6,
    });
    expect(seasonFields({ ...d, focus: [{ text: '', link: { kind: 'strategy', id: 's' } }, { text: '' }] }).focus)
      .toEqual([{ link: { kind: 'strategy', id: 's' } }]);
  });
  it('editing: the draft has two rows; only what changed is written', () => {
    const s = season('a', { title: 'Consistência', focus: [{ text: 'Tech' }], plannedWeeks: 7 });
    const initial = seasonDraftOf(s);
    expect(initial).toEqual({ title: 'Consistência', focus: [{ text: 'Tech' }, { text: '' }], startDay: '2026-11-16', plannedWeeks: 7 });
    expect(seasonChanges(initial, initial)).toEqual({});
    expect(seasonChanges(initial, { ...initial, plannedWeeks: 8 })).toEqual({ plannedWeeks: 8 });
    expect(seasonChanges(initial, { ...initial, focus: [{ text: 'Tech' }, { text: 'Fala' }] }))
      .toEqual({ focus: [{ text: 'Tech' }, { text: 'Fala' }] });
  });
  it('the review keeps his words; all blank is no review', () => {
    expect(seasonReviewOf({ progress: ' Comecei\ntodo dia ', obstacle: '', next: ' ' }, 5))
      .toEqual({ progress: 'Comecei\ntodo dia', obstacle: '', next: '', answeredAt: 5 });
    expect(seasonReviewOf({ progress: ' ', obstacle: '', next: '' }, 5)).toBeUndefined();
  });
});
