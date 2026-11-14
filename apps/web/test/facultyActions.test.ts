import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEMESTER_GRADE, type Commitment, type Journey } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { newRecord, put } from '../src/db/repo';
import {
  FacultyValidationError, addTopic, createAssessment, deleteProblemSet, pickSubject, restoreProblemSet,
  saveProblemSet, setTopicLevel, setupSemester,
} from '../src/domain/facultyActions';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

const live = async <T extends { deleted: boolean }>(rows: Promise<T[]>): Promise<T[]> => (await rows).filter((r) => !r.deleted);

describe('setupSemester', () => {
  it('cria a área, as 5 disciplinas e as 5 aulas; repetir não cria nada', async () => {
    const first = await setupSemester([...SEMESTER_GRADE]);
    expect(first).toEqual({ journeys: 5, classes: 5 });
    const area = await db.areas.get('area-facul');
    expect(area?.name).toBe('Faculdade');
    const journeys = await live(db.journeys.toArray());
    const subjects = journeys.filter((j) => j.subject === true);
    expect(subjects).toHaveLength(5);
    expect(subjects.every((j) => j.areaId === 'area-facul')).toBe(true);
    const classes = (await live(db.commitments.toArray())).filter((c) => c.weekdays?.length === 1);
    expect(classes.filter((c) => c.title !== 'Aula')).toHaveLength(5);
    const alg = classes.find((c) => c.title === 'Estruturas de Dados');
    expect(alg).toMatchObject({ start: '19:30', end: '22:30', weekdays: [1] });
    expect(classes.find((c) => c.title === 'Engenharia de Software')?.weekdays).toEqual([5]);

    expect(await setupSemester([...SEMESTER_GRADE])).toEqual({ journeys: 0, classes: 0 });
    expect((await live(db.journeys.toArray())).filter((j) => j.subject === true)).toHaveLength(5);
  });

  it('reaproveita a jornada e a aula que já existem', async () => {
    await put('journeys', newRecord<Journey>({ id: 'j-calc', title: 'Matematica Discreta', status: 'active', order: 0 }));
    await put('commitments', newRecord<Commitment>({ id: 'c-alg', title: 'Estruturas de Dados', date: '2026-08-03', start: '19:30', end: '22:30', weekdays: [1], remind: true }));
    const r = await setupSemester([...SEMESTER_GRADE]);
    expect(r).toEqual({ journeys: 4, classes: 4 });
    const calc = await db.journeys.get('j-calc');
    expect(calc).toMatchObject({ subject: true, areaId: 'area-facul', title: 'Matematica Discreta' });
    const all = await live(db.journeys.toArray());
    expect(all.filter((j) => /matem[aá]tica discreta/i.test(j.title))).toHaveLength(1);
    expect((await live(db.commitments.toArray())).filter((c) => c.title === 'Estruturas de Dados')).toHaveLength(1);
  });

  it('valida nome e horário', async () => {
    await expect(setupSemester([{ title: '  ', weekdays: [1], start: '19:30', end: '22:30' }])).rejects.toThrow(new FacultyValidationError('Dê um nome à disciplina.'));
    await expect(setupSemester([{ title: 'X', weekdays: [1], start: '22:30', end: '19:30' }])).rejects.toThrow('O fim da aula precisa ser depois do início.');
  });
});

describe('createAssessment', () => {
  it('cria a missão com data e prazo', async () => {
    await setupSemester([...SEMESTER_GRADE]);
    const calc = (await live(db.journeys.toArray())).find((j) => j.title === 'Matemática Discreta')!;
    const m = await createAssessment({ kind: 'prova', journeyId: calc.id, date: '2026-12-03' });
    expect(m).toMatchObject({ title: 'Prova de Matemática Discreta', date: '2026-12-03', deadline: '2026-12-03', assessment: 'prova', areaId: 'area-facul', journeyId: calc.id });
    await expect(createAssessment({ kind: 'prova', journeyId: calc.id, date: '' })).rejects.toThrow('Escolha a data.');
  });
});

describe('exercícios', () => {
  it('valida, grava, edita, apaga e restaura', async () => {
    await put('journeys', newRecord<Journey>({ id: 'j1', title: 'Matemática Discreta', status: 'active', order: 0, subject: true }));
    await expect(saveProblemSet({ journeyId: 'j1', day: '2026-11-13', title: 'Lista 4', done: 8, total: 6 }))
      .rejects.toThrow('Total: um número inteiro, maior ou igual aos feitos.');
    const p = await saveProblemSet({ journeyId: 'j1', day: '2026-11-13', title: ' Lista 4 ', done: 8, total: 10, unaided: 5 });
    expect(p.title).toBe('Lista 4');
    const edited = await saveProblemSet({ id: p.id, journeyId: 'j1', day: '2026-11-13', title: 'Lista 4', done: 9, total: 10 });
    expect(edited.id).toBe(p.id);
    expect((await db.problemSets.get(p.id))?.done).toBe(9);
    expect(await db.problemSets.count()).toBe(1);
    const gone = await deleteProblemSet(p.id);
    expect(gone?.id).toBe(p.id);
    expect((await db.problemSets.get(p.id))?.deleted).toBe(true);
    await restoreProblemSet(p.id);
    expect((await db.problemSets.get(p.id))?.deleted).toBe(false);
  });
});

describe('assuntos', () => {
  it('acrescenta marcas e não repete a mesma', async () => {
    const t = await addTopic('j1', '  Integrais ');
    expect(t.name).toBe('Integrais');
    await expect(addTopic('j1', '   ')).rejects.toThrow('Dê um nome ao assunto.');
    await setTopicLevel(t.id, 'vi');
    await setTopicLevel(t.id, 'entendi');
    await setTopicLevel(t.id, 'entendi');
    const stored = await db.subjectTopics.get(t.id);
    expect(stored?.marks.map((m) => m.level)).toEqual(['vi', 'entendi']);
  });
});

describe('pickSubject', () => {
  it('grava e remove a escolha do bloco', async () => {
    await pickSubject('b3', 'j2');
    expect((await db.dayState.get('2026-11-13'))?.subjectPicks).toEqual({ b3: 'j2' });
    await pickSubject('b3', null);
    expect((await db.dayState.get('2026-11-13'))?.subjectPicks).toEqual({});
  });
});
