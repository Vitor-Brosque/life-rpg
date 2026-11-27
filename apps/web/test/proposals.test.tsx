import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Block, Journey, Proposal, ProposalPayload } from '@life/shared';
import { proposalItems, topicLevelOf } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { addTopic, createAssessment, createSubject, setTopicLevel } from '../src/domain/facultyActions';
import { createGoal } from '../src/domain/goalActions';
import { createMission, dropMission } from '../src/domain/missionActions';
import { saveDeck, setDeckArchived } from '../src/domain/studyActions';
import { startSeason } from '../src/domain/seasonActions';
import { ProposalError, applyProposal, applyResultText, rejectProposal } from '../src/domain/proposalActions';
import { ProposalCard } from '../src/features/assist/ProposalCard';
import { ProposalScreen } from '../src/features/assist/ProposalScreen';
import { ToastHost, useToast } from '../src/ui/Toast';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 25, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
});
afterEach(() => { vi.useRealTimers(); });

const live = async <T extends { deleted: boolean }>(rows: Promise<T[]>): Promise<T[]> => (await rows).filter((r) => !r.deleted);

const payload: ProposalPayload = {
  title: 'Semestre', summary: 'Rotina para o fim do semestre.',
  preferences: { dayStartHour: 5 },
  renameAreas: [{ from: 'Trabalho', to: 'Estágio' }],
  areas: [{ name: 'Idiomas', attribute: 'Sabedoria' }, { name: 'estudo', attribute: 'Intelecto' }],
  goals: [{ title: 'Inglês B2', horizon: '2027' }],
  season: { title: 'Reta final', weeks: 6, focus: ['Provas'] },
  journeys: [{ title: 'Curso de inglês', area: 'Idiomas', goal: 'Inglês B2', missions: [{ title: 'Escolher o curso', durationMin: 30 }, { title: 'Fazer a aula 1' }] }],
  missions: [{ title: 'Revisar SQL', area: 'Estudo', durationMin: 60, date: '2026-11-27' }],
  routine: { mode: 'replace', blocks: [
    { name: 'Projeto', weekdays: [1, 2, 3, 4, 5], start: '08:00', durationMin: 120, minimumMin: 30, kind: 'focus', journey: 'Curso de inglês' },
    { name: 'Começo do dia', weekdays: [1, 2, 3, 4, 5], start: '07:00', durationMin: 30, minimumMin: 10, kind: 'routine', checklist: ['Água'] },
  ] },
  commitments: [{ title: 'Aula', weekdays: [1, 2, 3, 4, 5], start: '19:30', end: '22:30' }],
  training: { days: [{ weekday: 1, name: 'Peito', exercises: [{ name: 'Supino', sets: 3, repsMin: 6, repsMax: 8 }] }] },
  subjects: [{ title: 'Banco de Dados', weekday: 3, start: '19:30', end: '22:30' }],
};

const proposal = (p: Partial<Proposal> = {}) => put('proposals', newRecord<Proposal>({
  id: 'p1', source: 'ChatGPT', status: 'pending', payload, ...p,
}));

describe('applyProposal', () => {
  it('applies every checked item with the app actions, reusing what exists and never duplicating', async () => {
    const old = await put('blocks', newRecord<Block>({ name: 'Antigo', weekdays: [1], order: 0, targetStart: '09:00', durationMin: 60, minimumMin: 15, kind: 'focus', protected: false, checklist: [], archived: false }));
    await proposal();
    const r = await applyProposal('p1', (await import('@life/shared')).proposalItems(payload).map((i) => i.key));
    expect(r).toMatchObject({ status: 'applied', existed: 1, skipped: 0, unchecked: 0 });
    expect(applyResultText(r)).toBe(`${r.applied} itens aplicados, 1 já existia.`);

    expect((await db.settings.get('settings'))!.dayStartHour).toBe(5);
    const areas = await live(db.areas.toArray());
    expect(areas.find((a) => a.id === 'area-oficio')!.name).toBe('Estágio');
    expect(areas.filter((a) => a.name === 'Idiomas')).toHaveLength(1);
    expect(areas.filter((a) => a.name.toLowerCase() === 'estudo')).toHaveLength(1);
    const goal = (await live(db.goals.toArray())).find((g) => g.title === 'Inglês B2')!;
    expect((await live(db.seasons.toArray()))[0]).toMatchObject({ title: 'Reta final', plannedWeeks: 6, status: 'ativa' });
    const journey = (await live(db.journeys.toArray())).find((j) => j.title === 'Curso de inglês')!;
    expect(journey).toMatchObject({ goalId: goal.id, areaId: areas.find((a) => a.name === 'Idiomas')!.id });
    const missions = await live(db.missions.toArray());
    expect(missions.filter((m) => m.journeyId === journey.id).sort((x, y) => (x.journeyOrder ?? 0) - (y.journeyOrder ?? 0)).map((m) => [m.title, m.journeyOrder])).toEqual([['Escolher o curso', 0], ['Fazer a aula 1', 1]]);
    expect(missions.find((m) => m.title === 'Revisar SQL')).toMatchObject({ areaId: 'area-intelecto', durationMin: 60, date: '2026-11-27' });
    const blocks = await live(db.blocks.toArray());
    expect(blocks.find((b) => b.id === old.id)!.archived).toBe(true);
    expect(blocks.find((b) => b.name === 'Projeto')).toMatchObject({ journeyId: journey.id, targetStart: '08:00', archived: false });
    expect(blocks.find((b) => b.name === 'Começo do dia')!.checklist.map((c) => c.text)).toEqual(['Água']);
    expect((await live(db.commitments.toArray())).find((c) => c.title === 'Aula')).toMatchObject({ start: '19:30', end: '22:30', weekdays: [1, 2, 3, 4, 5] });
    expect((await db.trainingPlans.get('plan'))!.days[0]!.exercises[0]).toEqual({ name: 'Supino', sets: 3, repsMin: 6, repsMax: 8 });
    expect((await live(db.journeys.toArray())).find((j) => j.title === 'Banco de Dados')).toMatchObject({ subject: true });
    expect((await db.xpEvents.count())).toBe(0);
    const stored = (await db.proposals.get('p1'))!;
    expect(stored.status).toBe('applied');
    expect(stored.outcome!.find((o) => o.key === 'areas.1')).toEqual({ key: 'areas.1', result: 'existed' });
  });

  it('unchecked items are recorded; what no longer fits is skipped with the reason; the result is partial', async () => {
    await startSeason({ title: 'Já existe', focus: [{ text: '' }, { text: '' }], startDay: '2026-11-25', plannedWeeks: 6 });
    await createGoal({ title: 'inglês b2', why: '', horizon: '', status: 'ativo' });
    await proposal();
    const r = await applyProposal('p1', ['season', 'goals.0', 'missions.0']);
    expect(r).toMatchObject({ status: 'partial', applied: 1, existed: 1, skipped: 1 });
    const o = (await db.proposals.get('p1'))!.outcome!;
    expect(o.find((x) => x.key === 'season')).toEqual({ key: 'season', result: 'skipped', reason: 'já há uma temporada ativa' });
    expect(o.find((x) => x.key === 'routine.blocks.0')!.result).toBe('unchecked');
    expect((await live(db.blocks.toArray())).filter((b) => !b.archived)).toHaveLength(0);
  });

  it('a decided proposal cannot be applied or rejected again; reject changes only its state', async () => {
    await proposal();
    await rejectProposal('p1');
    expect((await db.proposals.get('p1'))!.status).toBe('rejected');
    await expect(applyProposal('p1', ['missions.0'])).rejects.toThrow(ProposalError);
    await expect(rejectProposal('p1')).rejects.toThrow('Esta proposta já foi decidida.');
    expect(await live(db.missions.toArray())).toHaveLength(0);
  });
});

describe('applyProposal: study (what a subject chat taught)', () => {
  const bd = () => createSubject({ title: 'Banco de Dados', weekdays: [3], start: '19:30', end: '22:30' });
  const studyProposal = (study: ProposalPayload['study'], extra: Partial<ProposalPayload> = {}) =>
    proposal({ payload: { title: 'Do chat de BD', summary: 'O que vimos.', study, ...extra } });
  const outcomeOf = async (key: string) => (await db.proposals.get('p1'))!.outcome!.find((o) => o.key === key);
  const allKeys = async () => proposalItems((await db.proposals.get('p1'))!.payload).map((i) => i.key);

  it('topics: new ones enter Assuntos ("Vi" when seen); an existing one is "já existia", goes up to "Vi" from "Nenhum" and is never lowered', async () => {
    const subject = await bd();
    const none = await addTopic(subject.id, 'Índices');
    const high = await addTopic(subject.id, 'Joins');
    await setTopicLevel(high.id, 'entendi');
    await studyProposal([{ subject: 'banco de dados', topics: [
      { name: 'Normalização', seen: true }, { name: 'Transações' }, { name: 'indices', seen: true }, { name: 'JOINS', seen: true },
    ] }]);
    const r = await applyProposal('p1', await allKeys());
    expect(r).toMatchObject({ status: 'applied', applied: 2, existed: 2 });
    const topics = await live(db.subjectTopics.toArray());
    expect(topics.filter((t) => t.journeyId === subject.id).map((t) => t.name).sort()).toEqual(['Joins', 'Normalização', 'Transações', 'Índices']);
    const level = (name: string) => topicLevelOf(topics.find((t) => t.name === name)!);
    expect(level('Normalização')).toBe('vi');
    expect(level('Transações')).toBe('nenhum');
    expect(level('Índices')).toBe('vi');
    expect(topics.find((t) => t.id === none.id)!.marks.map((m) => m.level)).toEqual(['vi']);
    expect(level('Joins')).toBe('entendi');
    expect(await outcomeOf('study.0.topics.2')).toEqual({ key: 'study.0.topics.2', result: 'existed' });
    expect(await db.xpEvents.count()).toBe(0);
  });

  it('cards: drafts in the subject deck, created with the subject name when there is none; the same front is "já existia"', async () => {
    const subject = await bd();
    await saveDeck({ name: 'Arquivado', journeyId: subject.id }).then((d) => setDeckArchived(d.id, true));
    await studyProposal([{ subject: 'Banco de Dados', cards: [
      { type: 'basic', front: 'O que é a 3FN?', back: 'Sem dependência transitiva.' },
      { type: 'topic', front: 'Formas normais', back: '1FN\n2FN\n3FN' },
    ] }]);
    expect(await applyProposal('p1', await allKeys())).toMatchObject({ applied: 2 });
    const decks = (await live(db.decks.toArray())).filter((d) => d.journeyId === subject.id && !d.archived);
    expect(decks.map((d) => d.name)).toEqual(['Banco de Dados']);
    const notes = (await live(db.notes.toArray())).sort((a, b) => a.type.localeCompare(b.type));
    expect(notes.map((n) => [n.type, n.front, n.back, n.draft, n.deckId])).toEqual([
      ['basic', 'O que é a 3FN?', 'Sem dependência transitiva.', true, decks[0]!.id],
      ['topic', 'Formas normais', '1FN\n2FN\n3FN', true, decks[0]!.id],
    ]);
    expect(await live(db.cards.toArray())).toHaveLength(0);

    await studyProposal([{ subject: 'Banco de Dados', cards: [
      { type: 'basic', front: '  o que e a  3fn? ', back: 'Outra resposta.' }, { type: 'basic', front: 'O que é a 2FN?', back: 'Sem dependência parcial.' },
    ] }], {});
    const again = await applyProposal('p1', await allKeys());
    expect(again).toMatchObject({ applied: 1, existed: 1 });
    expect((await live(db.decks.toArray())).filter((d) => d.journeyId === subject.id && !d.archived)).toHaveLength(1);
    expect((await live(db.notes.toArray())).filter((n) => n.deckId === decks[0]!.id)).toHaveLength(3);
    expect(await db.xpEvents.count()).toBe(0);
  });

  it('cards go to the first active deck already linked to the subject', async () => {
    const subject = await bd();
    const second = await saveDeck({ name: 'SQL', journeyId: subject.id });
    const first = await saveDeck({ name: 'Modelagem', journeyId: subject.id });
    await db.decks.update(first.id, { order: -1 });
    await studyProposal([{ subject: 'Banco de Dados', cards: [{ type: 'basic', front: 'Chave primária?', back: 'Identifica a linha.' }] }]);
    await applyProposal('p1', await allKeys());
    expect((await live(db.notes.toArray()))[0]).toMatchObject({ deckId: first.id, draft: true });
  });

  it('assessments enter Avaliações like the ones created by hand; the same kind on the same day is "já existia"', async () => {
    const subject = await bd();
    await createAssessment({ kind: 'prova', journeyId: subject.id, date: '2026-12-10' });
    await studyProposal([{ subject: 'Banco de Dados', assessments: [
      { kind: 'prova', date: '2026-12-10' }, { kind: 'trabalho', date: '2026-12-10', content: 'Modelo ER da biblioteca' },
    ] }]);
    expect(await applyProposal('p1', await allKeys())).toMatchObject({ status: 'applied', applied: 1, existed: 1 });
    const missions = (await live(db.missions.toArray())).filter((m) => m.journeyId === subject.id && m.assessment);
    expect(missions).toHaveLength(2);
    expect(missions.find((m) => m.assessment === 'trabalho')).toMatchObject({
      title: 'Trabalho de Banco de Dados', date: '2026-12-10', deadline: '2026-12-10', notes: 'Modelo ER da biblioteca', areaId: subject.areaId,
    });
    expect(await db.xpEvents.count()).toBe(0);
  });

  it('an assessment whose date has passed is skipped with "a data já passou"; a dropped one does not count as "já existia"', async () => {
    const subject = await bd();
    const dropped = await createAssessment({ kind: 'prova', journeyId: subject.id, date: '2026-12-10' });
    await dropMission(dropped.id);
    await studyProposal([{ subject: 'Banco de Dados', assessments: [
      { kind: 'prova', date: '2026-11-20' }, { kind: 'prova', date: '2026-12-10' },
    ] }]);
    expect(await applyProposal('p1', await allKeys())).toMatchObject({ applied: 1, existed: 0, skipped: 1 });
    expect(await outcomeOf('study.0.assessments.0')).toEqual({ key: 'study.0.assessments.0', result: 'skipped', reason: 'a data já passou' });
    const open = (await live(db.missions.toArray())).filter((m) => m.journeyId === subject.id && m.assessment && m.status !== 'dropped');
    expect(open).toHaveLength(1);
    expect(open[0]!.date).toBe('2026-12-10');
  });

  it('missions become missions of the subject journey; an open one with the same title is "já existia"', async () => {
    const subject = await bd();
    await createMission({ title: 'Fazer a lista 3', journeyId: subject.id, journeyOrder: 0 });
    await studyProposal([{ subject: 'Banco de Dados', missions: [
      { title: 'fazer a lista 3' }, { title: 'Perguntar ao professor sobre a 4FN', durationMin: 15, firstStep: 'Anotar a dúvida' },
    ] }]);
    expect(await applyProposal('p1', await allKeys())).toMatchObject({ applied: 1, existed: 1 });
    const added = (await live(db.missions.toArray())).find((m) => m.title === 'Perguntar ao professor sobre a 4FN')!;
    expect(added).toMatchObject({ journeyId: subject.id, areaId: subject.areaId, journeyOrder: 1, durationMin: 15, firstStep: 'Anotar a dúvida' });
    expect(subject.areaId).toBeTruthy();
    expect(added.assessment).toBeUndefined();
    expect(await db.xpEvents.count()).toBe(0);
  });

  it('a subject reused through the looser title match of createSubject still gets its study items', async () => {
    const existing = await createSubject({ title: 'Cálculo I', weekdays: [], start: '19:30', end: '22:30' });
    await studyProposal([{ subject: 'Cálculo', topics: [{ name: 'Limites' }] }], { subjects: [{ title: 'Cálculo' }] });
    const r = await applyProposal('p1', await allKeys());
    expect(r).toMatchObject({ status: 'applied', applied: 1, existed: 1, skipped: 0 });
    expect(await outcomeOf('study.0.topics.0')).toEqual({ key: 'study.0.topics.0', result: 'applied' });
    expect((await live(db.subjectTopics.toArray()))[0]).toMatchObject({ journeyId: existing.id, name: 'Limites' });
  });

  it('a subject created in the same proposal exists when its study is applied; without it the items are skipped with the reason', async () => {
    await studyProposal([{ subject: 'Cálculo I', topics: [{ name: 'Limites', seen: true }], missions: [{ title: 'Lista 1' }] }], {
      subjects: [{ title: 'Cálculo I' }],
    });
    const r = await applyProposal('p1', ['study.0.topics.0', 'study.0.missions.0']);
    expect(r).toMatchObject({ status: 'partial', applied: 0, skipped: 2, unchecked: 1 });
    expect(await outcomeOf('study.0.topics.0')).toEqual({ key: 'study.0.topics.0', result: 'skipped', reason: 'a disciplina Cálculo I não existe' });
    expect(await live(db.subjectTopics.toArray())).toHaveLength(0);

    await db.proposals.clear();
    await studyProposal([{ subject: 'Cálculo I', topics: [{ name: 'Limites', seen: true }] }], { subjects: [{ title: 'Cálculo I' }] });
    expect(await applyProposal('p1', await allKeys())).toMatchObject({ status: 'applied', applied: 2 });
    const subject = (await live(db.journeys.toArray())).find((j) => j.title === 'Cálculo I')!;
    expect(subject.subject).toBe(true);
    expect((await live(db.subjectTopics.toArray()))[0]).toMatchObject({ journeyId: subject.id, name: 'Limites' });
  });

  it('a plain journey with the subject name is not a subject: skipped', async () => {
    await put('journeys', newRecord<Journey>({ title: 'Banco de Dados', status: 'active', order: 0 }));
    await studyProposal([{ subject: 'Banco de Dados', topics: [{ name: 'SQL' }] }]);
    expect(await applyProposal('p1', await allKeys())).toMatchObject({ skipped: 1 });
  });
});

describe('review screen: the Estudo group', () => {
  it('lists the study items after the subjects, with the card back and the first step in the detail', async () => {
    await createSubject({ title: 'Banco de Dados', weekdays: [], start: '19:30', end: '22:30' });
    await proposal({ payload: { title: 'Do chat de BD', summary: 'O que vimos hoje.', study: [{
      subject: 'Banco de Dados',
      topics: [{ name: 'Normalização', seen: true }],
      cards: [{ type: 'basic', front: 'O que é a 3FN?', back: 'Sem dependência transitiva.' }],
      assessments: [{ kind: 'prova', date: '2026-12-10' }],
      missions: [{ title: 'Fazer a lista 3', durationMin: 60, firstStep: 'Abrir o enunciado' }],
    }] } });
    renderAt('/propostas/p1', <ProposalScreen id="p1" />);
    const group = await screen.findByRole('region', { name: 'Estudo' });
    expect(within(group).getByRole('checkbox', { name: 'Assunto · Banco de Dados: Normalização (já visto)' })).toBeChecked();
    expect(within(group).getByRole('checkbox', { name: 'Card · Banco de Dados: O que é a 3FN?' })).toBeInTheDocument();
    expect(within(group).getByText('Verso: Sem dependência transitiva.')).toBeInTheDocument();
    expect(within(group).getByRole('checkbox', { name: 'Prova · Banco de Dados · qui 10/12' })).toBeInTheDocument();
    expect(within(group).getByRole('checkbox', { name: 'Missão · Banco de Dados: Fazer a lista 3 · 1h' })).toBeInTheDocument();
    expect(within(group).getByText('Primeiro passo: Abrir o enunciado')).toBeInTheDocument();
  });
});

function renderAt(path: string, ui: React.ReactNode) {
  const { hook } = memoryLocation({ path });
  return render(<Router hook={hook}>{ui}<ToastHost /></Router>);
}

describe('review screen: back link', () => {
  const open = async (path: string) => {
    await proposal();
    const loc = memoryLocation({ path });
    render(<Router hook={loc.hook} searchHook={loc.searchHook}><ProposalScreen id="p1" /></Router>);
  };

  it('returns to the subject when opened from its "Colar resposta do chat"', async () => {
    await open('/propostas/p1?from=%2Festudo%2Fmaterias%2F01HABC');
    expect(await screen.findByRole('link', { name: '← Disciplina' })).toHaveAttribute('href', '/estudo/materias/01HABC');
    expect(screen.queryByRole('link', { name: '‹ Ajustes' })).toBeNull();
  });

  it('returns to the Agora when opened from its card', async () => {
    await open('/propostas/p1?from=%2F');
    expect(await screen.findByRole('link', { name: '‹ Agora' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: '‹ Ajustes' })).toBeNull();
  });

  it('returns to the Painel when opened from its card', async () => {
    await open('/propostas/p1?from=%2Fpainel');
    expect(await screen.findByRole('link', { name: '‹ Painel' })).toHaveAttribute('href', '/painel');
  });

  it('accepts only a subject path, the Agora or the Painel; anything else falls back to Ajustes', async () => {
    await open('/propostas/p1?from=https%3A%2F%2Fevil.example%2Festudo%2Fmaterias%2F1');
    expect(await screen.findByRole('link', { name: '‹ Ajustes' })).toHaveAttribute('href', '/ajustes');
    expect(screen.queryByRole('link', { name: '← Disciplina' })).toBeNull();
  });

  it('a look-alike of the Agora path falls back to Ajustes', async () => {
    await open('/propostas/p1?from=%2F%2Fevil.example');
    expect(await screen.findByRole('link', { name: '‹ Ajustes' })).toHaveAttribute('href', '/ajustes');
    expect(screen.queryByRole('link', { name: '‹ Agora' })).toBeNull();
  });

  it('without the parameter the link is Ajustes', async () => {
    await open('/propostas/p1');
    expect(await screen.findByRole('link', { name: '‹ Ajustes' })).toBeInTheDocument();
  });
});

describe('review screen and Agora card', () => {
  it('the card shows the newest pending proposal and hides it for the day on "Agora não"', async () => {
    const user = userEvent.setup();
    await proposal();
    renderAt('/', <ProposalCard today="2026-11-25" />);
    const card = await screen.findByRole('region', { name: 'Proposta do assistente · 13 itens' });
    expect(within(card).getByText('ChatGPT: Semestre')).toBeInTheDocument();
    // The review's back link returns to the screen the card is on.
    expect(within(card).getByRole('link', { name: 'Revisar' })).toHaveAttribute('href', '/propostas/p1?from=%2F');
    await user.click(within(card).getByRole('button', { name: 'Agora não' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: /Proposta do assistente/ })).not.toBeInTheDocument());
  });

  it('lists the items by group, warns about the replaced routine, applies only the checked ones', async () => {
    const user = userEvent.setup();
    await put('blocks', newRecord<Block>({ name: 'Antigo', weekdays: [1], order: 0, targetStart: '09:00', durationMin: 60, minimumMin: 15, kind: 'focus', protected: false, checklist: [], archived: false }));
    await proposal();
    renderAt('/propostas/p1', <ProposalScreen id="p1" />);
    expect(await screen.findByText('Rotina para o fim do semestre.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rotina' })).toBeInTheDocument();
    expect(await screen.findByText(/A rotina atual será arquivada .*Antigo \(seg 09:00\)/)).toBeInTheDocument();
    expect(screen.getByText('Nova área: estudo (atributo Intelecto)').closest('li')).toHaveTextContent('Já existe, será reaproveitado.');
    for (const cb of screen.getAllByRole('checkbox')) await user.click(cb);
    expect(screen.getByRole('button', { name: 'Aplicar selecionados' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Revisar SQL · 1h · área Estudo · sex 27/11' }));
    await user.click(screen.getByRole('button', { name: 'Aplicar selecionados' }));
    expect(await screen.findByText('1 item aplicado.')).toBeInTheDocument();
    expect(await screen.findByText(/Aplicada em parte/)).toBeInTheDocument();
    expect(screen.getByText(/— aplicado/)).toBeInTheDocument();
    expect((await live(db.missions.toArray())).map((m) => m.title)).toEqual(['Revisar SQL']);
  });
});

describe('Ajustes → Assistentes', () => {
  it('without sync it explains; with sync it turns on, shows the connector address and revokes', async () => {
    const { AssistSection } = await import('../src/features/assist/AssistSection');
    const { setMeta } = await import('../src/db/repo');
    const user = userEvent.setup();
    let status = { enabled: false, publicUrl: '', locked: false, clients: [] as { id: string; name: string; connectedAt: number }[] };
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'PUT') {
        const b = JSON.parse(String(init.body)) as { enabled: boolean; publicUrl?: string };
        status = { ...status, enabled: b.enabled, publicUrl: b.publicUrl ?? status.publicUrl, clients: [{ id: 'c1', name: 'ChatGPT', connectedAt: Date.now() }] };
      }
      if (init?.method === 'DELETE') status = { ...status, clients: [] };
      return new Response(JSON.stringify(status), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    try {
      const first = renderAt('/ajustes', <AssistSection />);
      expect(await screen.findByText(/Conecte a sincronização acima primeiro/)).toBeInTheDocument();
      first.unmount();
      await setMeta('syncToken', 'tok');
      renderAt('/ajustes', <AssistSection />);
      expect(await screen.findByText('tailscale funnel --bg --https=8443 http://127.0.0.1:8788')).toBeInTheDocument();
      await user.type(screen.getByLabelText('Endereço público (o https:// que o Funnel mostrou)'), 'https://exemplo.test:8443');
      await user.click(screen.getByRole('button', { name: 'Ligar assistentes' }));
      expect(await screen.findByText('https://exemplo.test:8443/mcp')).toBeInTheDocument();
      expect(calls.find((c) => c.init?.method === 'PUT')!.init!.headers).toMatchObject({ Authorization: 'Bearer tok' });
      await user.click(await screen.findByRole('button', { name: 'Revogar ChatGPT' }));
      expect(await screen.findByText('ChatGPT foi desconectado.')).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Sem conector', () => {
  const validJson = JSON.stringify({ title: 'Do chat', summary: 'Conversamos.', missions: [{ title: 'Ler um capítulo', area: 'Estudo' }] });
  const setup = async () => {
    const { AssistSection } = await import('../src/features/assist/AssistSection');
    const user = userEvent.setup();
    const loc = memoryLocation({ path: '/ajustes', record: true });
    render(<Router hook={loc.hook}><AssistSection /><ToastHost /></Router>);
    return { user, location: { get path() { return loc.history![loc.history!.length - 1]!; } } };
  };
  const openPaste = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Colar resposta do chat' }));
    return screen.findByLabelText('Resposta do chat');
  };

  it('renders without sync and stores a pasted proposal as pending, then opens its review', async () => {
    const { user, location } = await setup();
    expect(screen.getByRole('heading', { name: 'Sem conector' })).toBeInTheDocument();
    const box = await openPaste(user);
    await user.click(box);
    await user.paste(`Pronto:\n\`\`\`json\n${validJson}\n\`\`\``);
    await user.click(screen.getByRole('button', { name: 'Revisar proposta' }));
    await waitFor(async () => expect(await db.proposals.count()).toBe(1));
    const [p] = await db.proposals.toArray();
    expect(p).toMatchObject({ source: 'Colada de um chat', status: 'pending' });
    expect(p!.clientId).toBeUndefined();
    await waitFor(() => expect(location.path).toBe(`/propostas/${p!.id}`));
  });

  it('shows messages inline, keeps the text and stores nothing', async () => {
    const { user } = await setup();
    const box = await openPaste(user);
    await user.click(screen.getByRole('button', { name: 'Revisar proposta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cole a resposta do chat.');
    await user.click(box);
    await user.paste('sem proposta nenhuma');
    await user.click(screen.getByRole('button', { name: 'Revisar proposta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não encontrei a proposta nesse texto. Peça ao chat para responder só com o bloco JSON.');
    expect(box).toHaveValue('sem proposta nenhuma');
    expect(await db.proposals.count()).toBe(0);
  });

  it('lists validation issues', async () => {
    const { user } = await setup();
    const box = await openPaste(user);
    await user.click(box);
    await user.paste(JSON.stringify({ title: 'X', summary: 'Y', missions: [{ title: 'Ler', area: 'Inexistente' }] }));
    await user.click(screen.getByRole('button', { name: 'Revisar proposta' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('A proposta tem problemas. Mostre isto ao chat e peça para corrigir:');
    expect(within(alert).getByRole('listitem')).toHaveTextContent('missions.0.area: Área "Inexistente" não existe nem é criada nesta proposta.');
    expect(await db.proposals.count()).toBe(0);
  });

  it('copies the request, and falls back to a read-only text when the clipboard fails', async () => {
    const { user } = await setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Copiar pedido para o chat' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain('LIFE RPG');
    expect(await screen.findByText('Pedido copiado. Cole no chat e converse sobre o que mudar.')).toBeInTheDocument();

    writeText.mockRejectedValueOnce(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Copiar pedido para o chat' }));
    const area = await screen.findByRole('textbox', { name: 'Pedido para o chat' });
    expect(area).toHaveAttribute('readonly');
    expect((area as HTMLTextAreaElement).value).toContain('LIFE RPG');
  });
});
