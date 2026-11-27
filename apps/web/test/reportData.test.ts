import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BlockSession, Card, CardSchedule, Goal, Mission, Review, Season, SpeechProgram, SpeechSession, SpeechSituation, Strategy,
} from '@life/shared';
import { REPORT_DEFAULTS, REPORT_LOOKBACK_DAYS, addDays, reportMarkdown, reportWeekPeriod } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put, softDelete } from '../src/db/repo';
import { readDiaryWeek } from '../src/db/diaryData';
import { readReportData } from '../src/db/reportData';
import { ensureSeed } from '../src/db/seed';
import { saveDiaryEntry } from '../src/domain/diaryActions';
import { at } from './blockFixture';

const WEEK = { start: '2026-11-09', end: '2026-11-15' };
const mission = (id: string, title: string): Mission => newRecord<Mission>({
  id, title, checklist: [], status: 'open', important: false, shrunk: false, postponeCount: 0,
});
const sessionOn = (day: string): BlockSession => newRecord<BlockSession>({ id: `bs-b1-${day}`, blockId: 'b1', day, version: 'normal', startedAt: at(10, 9) });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(16, 10));   // Monday 16/11
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('readReportData', () => {
  it('reads live records from 200 days before the range, the range diary entries as stored, link names and settings', async () => {
    const from = addDays(WEEK.start, -REPORT_LOOKBACK_DAYS);
    await put('missions', mission('m1', 'Escrever pauta'));
    await put('missions', mission('gone', 'Apagada'));
    await softDelete('missions', 'gone');
    await put('blockSessions', sessionOn(from));
    await put('blockSessions', sessionOn(addDays(from, -1)));
    await saveDiaryEntry('in', { text: 'Dia corrido.', day: '2026-11-10', at: at(10, 21), themes: [], links: [{ kind: 'mission', id: 'm1' }], private: false });
    await saveDiaryEntry('priv', { text: 'Só meu.', day: '2026-11-12', at: at(12, 22), themes: [], links: [], private: true });
    await saveDiaryEntry('out', { text: 'Outra semana.', day: '2026-11-16', at: at(16, 9), themes: [], links: [], private: false });

    const data = (await readReportData(WEEK, '2026-11-16'))!;
    expect(data.today).toBe('2026-11-16');
    expect([data.dayStartHour, data.dayEndHour]).toEqual([4, 23]);
    expect(data.restDays).toEqual([0, 6]);
    expect(data.watchDismissed).toEqual([]);
    expect(data.missions.map((m) => m.id)).toEqual(['m1']);
    expect(data.sessions.map((s) => s.day)).toEqual([from]);
    expect(data.diaryEntries.map((e) => e.id).sort()).toEqual(['in', 'priv']);
    expect(data.linkNames['mission:m1']).toBe('Escrever pauta');
    expect(data.areas).toHaveLength(6);
  });

  it('reading writes nothing', async () => {
    await saveDiaryEntry('in', { text: 'Dia corrido.', day: '2026-11-10', at: at(10, 21), themes: [], links: [], private: false });
    const counts = async () => [await db.outbox.count(), await db.diaryEntries.count(), await db.dayState.count()];
    const before = await counts();
    await readReportData(WEEK, '2026-11-16');
    expect(await counts()).toEqual(before);
  });

  it('never hands soft-deleted reviews, missions or cards to the pure report', async () => {
    const sched = { state: 'review', due: 0, stability: 1, difficulty: 1, reps: 1, lapses: 0 } as unknown as CardSchedule;
    const review = newRecord<Review>({ id: 'r-gone', cardId: 'c1-0', noteId: 'c1', at: at(10, 9), day: '2026-11-10', rating: 3 as Review['rating'], durationMs: 1000, wrote: true, before: sched, after: sched });
    await db.reviews.put(review);
    await db.cards.put(newRecord<Card>({ id: 'c1-0', noteId: 'c1', ord: 0, suspended: false, ...sched }));
    await put('missions', mission('m-gone', 'Apagada'));
    await softDelete('reviews', 'r-gone');
    await softDelete('cards', 'c1-0');
    await softDelete('missions', 'm-gone');
    const data = (await readReportData(WEEK, '2026-11-16'))!;
    expect(data.reviews).toEqual([]);
    expect(data.cards).toEqual([]);
    expect(data.missions).toEqual([]);
  });

  it('feeds reportMarkdown: the Comunicação oral report of the week', async () => {
    await saveDiaryEntry('c', { text: 'Apresentei o trabalho em sala.', day: '2026-11-12', at: at(12, 20), themes: ['comunicacao'], links: [], private: false });
    const data = (await readReportData(WEEK, '2026-11-16'))!;
    expect(reportMarkdown({ data, period: reportWeekPeriod('2026-11-09'), options: { ...REPORT_DEFAULTS, theme: 'comunicacao' } })).toBe([
      '# Relatório — Comunicação oral — 09/11 a 15/11/2026',
      'Exportado do LIFE RPG em 16/11/2026.',
      'Fatos vêm dos registros do app; percepções são minhas palavras; ausência de dado não é fracasso; interpretações são hipóteses.',
      '',
      '## Prática de fala',
      '**Sem dados:**',
      '- Ainda não há prática de fala registrada.',
      '',
      '## Diário',
      '**Minhas percepções:** entradas do diário, com as minhas palavras, sem edição.',
      '',
      '### Quinta-feira, 12/11 · 20:00',
      'Apresentei o trabalho em sala.',
      '',
      '_Temas: Comunicação_',
      '',
    ].join('\n'));
  });

  it('reads the strategies alive, trashed ones included, deleted ones out', async () => {
    const s = (id: string, p: Partial<Strategy> = {}): Strategy => newRecord<Strategy>({
      id, title: id, source: 'ideia', startDay: '2026-11-09', reviewDay: '2026-11-23', status: 'testando', ...p,
    });
    await put('strategies', s('alive'));
    await put('strategies', s('trashed', { trashedAt: 1 }));
    await put('strategies', s('gone', { deleted: true }));
    const data = (await readReportData(WEEK, '2026-11-16'))!;
    expect(data.strategies.map((x) => x.id).sort()).toEqual(['alive', 'trashed']);
    expect(reportMarkdown({ data, period: reportWeekPeriod('2026-11-09'), options: REPORT_DEFAULTS }))
      .toContain('Estratégias em teste neste período: "alive".');
  });

  it('reads the goals and seasons alive', async () => {
    await put('goals', newRecord<Goal>({ id: 'g1', title: 'Carreira', status: 'ativo', order: 0 }));
    await put('goals', newRecord<Goal>({ id: 'g2', title: 'Apagado', status: 'ativo', order: 1, deleted: true }));
    await put('seasons', newRecord<Season>({ id: 'se1', title: 'Consistência', focus: [], startDay: '2026-11-02', plannedWeeks: 6, status: 'ativa' }));
    const data = (await readReportData(WEEK, '2026-11-16'))!;
    expect(data.goals.map((g) => g.id)).toEqual(['g1']);
    expect(data.seasons.map((s) => s.id)).toEqual(['se1']);
  });

  it('reads the speech sessions, situations and programs alive', async () => {
    await put('speechSessions', newRecord<SpeechSession>({ id: 'sp1', day: '2026-11-10', kind: 'exercicio', exercise: 'ritmo', done: true, recordings: [], ratings: {} }));
    await put('speechSessions', newRecord<SpeechSession>({ id: 'sp2', day: '2026-11-10', kind: 'leitura', passage: 'feira', done: true, recordings: [], ratings: {} }));
    await softDelete('speechSessions', 'sp2');
    await put('speechSituations', newRecord<SpeechSituation>({ id: 'si1', day: '2026-11-11', at: at(11, 20), context: 'aula', repeats: 1 }));
    await put('speechPrograms', newRecord<SpeechProgram>({ id: 'pr1', startDay: '2026-11-02', week: 2, status: 'ativo', phaseNotes: {} }));
    const data = (await readReportData(WEEK, '2026-11-16'))!;
    expect(data.speechSessions.map((s) => s.id)).toEqual(['sp1']);
    expect(data.speechSituations.map((s) => s.id)).toEqual(['si1']);
    expect(data.speechPrograms.map((p) => p.id)).toEqual(['pr1']);
    const md = reportMarkdown({ data, period: reportWeekPeriod(WEEK.start), options: { ...REPORT_DEFAULTS, theme: 'comunicacao', diary: 'nenhuma' } });
    expect(md).toContain('- Sessões de fala: 1 — Exercício 1.');
    expect(md).toContain('- Pediram para repetir: 1 vez em 1 situação.');
  });

  it('the diary week shows a season review answered that week', async () => {
    await put('seasons', newRecord<Season>({
      id: 'se1', title: 'Consistência', focus: [], startDay: '2026-10-01', plannedWeeks: 6, status: 'encerrada', endedDay: '2026-11-12',
      review: { progress: 'Todo dia', obstacle: '', next: '', answeredAt: at(12, 21) },
    }));
    const groups = await readDiaryWeek('2026-11-09');
    expect(groups.flatMap((g) => g.reviews)).toEqual([
      expect.objectContaining({ kind: 'season', title: 'Temporada "Consistência"', day: '2026-11-12' }),
    ]);
  });
});
