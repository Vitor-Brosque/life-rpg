import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEMESTER_GRADE } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { createMission, setDayMode } from '../src/domain/actions';
import { createAssessment, setupSemester } from '../src/domain/facultyActions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { useCompanion } from '../src/features/companion/store';
import { ProblemSetSheetHost } from '../src/features/faculty/ProblemSetSheet';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at, seedBlocks } from './blockFixture';

const idOf = async (title: string): Promise<string> => (await db.journeys.toArray()).find((j) => j.title === title)!.id;
const PROB = 'Redes de Computadores';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 15, 30)); // Wednesday
  localStorage.clear();
  await db.delete(); await db.open();
  await ensureSeed();
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: '2026-11-11', emptyDay: undefined });
  useCompanion.getState().clear();
  useToast.getState().dismiss();
  await seedBlocks();
  await setupSemester([...SEMESTER_GRADE]);
  // The semester started in August: classes are older than "today".
  await db.commitments.toCollection().filter((c) => c.title !== 'Aula').modify({ date: '2026-08-03' });
  await createAssessment({ kind: 'prova', journeyId: await idOf(PROB), date: '2026-11-16' });
  await createMission({ title: 'Lista 3', journeyId: await idOf(PROB), journeyOrder: 0, areaId: 'area-facul' });
});
afterEach(() => { vi.useRealTimers(); });

const renderAgora = () => render(<><AgoraScreen /><ToastHost /><ProblemSetSheetHost /></>);
const suggestion = () => screen.findByRole('region', { name: 'Sugestão para este bloco' });
const SLOW = { timeout: 4000 };

describe('sugestão no bloco Faculdade', () => {
  it('mostra a primeira sugestão sem gravar nada', async () => {
    renderAgora();
    const card = await suggestion();
    expect(within(card).getByText(`${PROB} — Prova em 5 dias`)).toBeInTheDocument();
    expect((await db.dayState.get('2026-11-11'))?.subjectPicks).toBeUndefined();
  });

  it('"Trocar sugestão" percorre a lista em ciclo', async () => {
    const user = userEvent.setup();
    renderAgora();
    const card = await suggestion();
    await user.click(within(card).getByRole('button', { name: 'Trocar sugestão' }));
    expect(await within(card).findByText('Banco de Dados — Aula hoje à noite')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Trocar sugestão' }));
    expect(await within(card).findByText('Matemática Discreta — Revisar a aula de ontem')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Trocar sugestão' }));
    expect(await within(card).findByText(`${PROB} — Prova em 5 dias`)).toBeInTheDocument();
  });

  it('"Usar" grava a escolha, mostra a próxima missão e a põe no cartão principal; "Escolher outra" desfaz', async () => {
    const user = userEvent.setup();
    renderAgora();
    const card = await suggestion();
    await user.click(within(card).getByRole('button', { name: 'Usar' }));
    const picked = await screen.findByRole('region', { name: 'Disciplina deste bloco' }, SLOW);
    expect(await db.dayState.get('2026-11-11')).toMatchObject({ subjectPicks: { b3: await idOf(PROB) } });
    expect(await screen.findByText('Bloco com Redes de Computadores.')).toBeInTheDocument();
    expect(within(picked).getByText(PROB)).toBeInTheDocument();
    expect(within(picked).getByText('Próxima missão: Lista 3')).toBeInTheDocument();
    const main = await screen.findByRole('region', { name: 'Missão agora' });
    expect(within(main).getByText('Lista 3')).toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);

    await user.click(within(picked).getByRole('button', { name: 'Escolher outra' }));
    expect(await screen.findByRole('region', { name: 'Sugestão para este bloco' }, SLOW)).toBeInTheDocument();
    expect((await db.dayState.get('2026-11-11'))?.subjectPicks).toEqual({});
    expect(document.activeElement).not.toBe(document.body);
  });

  it('disciplina sem missão: "Sem missão aberta" e "Registrar exercícios" abre a folha', async () => {
    const user = userEvent.setup();
    renderAgora();
    const card = await suggestion();
    await user.click(within(card).getByRole('button', { name: 'Trocar sugestão' }));
    await user.click(within(card).getByRole('button', { name: 'Usar' }));
    const picked = await screen.findByRole('region', { name: 'Disciplina deste bloco' }, SLOW);
    expect(within(picked).getByText('Sem missão aberta em Banco de Dados.')).toBeInTheDocument();
    await user.click(within(picked).getByRole('button', { name: 'Registrar exercícios' }));
    expect(await screen.findByRole('dialog', { name: 'Registrar exercícios' })).toBeInTheDocument();
  });

  it('fora do bloco Faculdade não há card; sábado também não; dia Livre numa quarta também não', async () => {
    vi.setSystemTime(at(11, 10));
    const view = renderAgora();
    await screen.findByRole('region', { name: 'Bloco atual' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Sugestão para este bloco' })).toBeNull());
    view.unmount();

    vi.setSystemTime(at(14, 10)); // Saturday
    const sat = renderAgora();
    await screen.findByRole('region', { name: 'Dia livre' });
    expect(screen.queryByRole('region', { name: 'Sugestão para este bloco' })).toBeNull();
    sat.unmount();

    vi.setSystemTime(at(11, 15, 30));
    await setDayMode('free');
    renderAgora();
    await screen.findByRole('region', { name: 'Dia livre' });
    expect(screen.queryByRole('region', { name: 'Sugestão para este bloco' })).toBeNull();
  });
});
