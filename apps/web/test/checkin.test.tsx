import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { createMission, saveCheckin, updateMission } from '../src/domain/actions';
import { AgoraScreen } from '../src/features/agora/AgoraScreen';
import { CheckinCardHost } from '../src/features/agora/CheckinCard';
import { ResumePromptHost, useResumePrompt } from '../src/features/agora/ResumePrompt';
import { CHECKIN_OFF_PREFIX, useCheckinCard, wantsCheckin } from '../src/features/agora/startWithCheckin';
import { useAgoraSession } from '../src/features/agora/useAgora';
import { PHRASES, renderPhrase } from '../src/features/companion/phrases';
import { useCompanion } from '../src/features/companion/store';
import { MissionSheetHost, useMissionSheet } from '../src/features/mission/MissionSheet';
import { SettingsScreen } from '../src/features/settings/SettingsScreen';
import { useSyncStatus } from '../src/sync/status';
import { TimerBar } from '../src/timer/TimerBar';
import { TimerHost, useTimerSheet } from '../src/timer/TimerSheet';
import { TIMER_IDLE, useTimer } from '../src/timer/store';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at, pastXp, seedBlocks, xpBy } from './blockFixture';

const MIN = 60_000;
const FEELINGS = ['Ansiedade', 'Tédio', 'Incerteza', 'Cansaço', 'Medo de errar', 'Outro'];

beforeEach(async () => {
  // Only Date is faked: fake-indexeddb needs the real setImmediate/setTimeout.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(11, 9, 30));
  localStorage.clear();
  useTimer.setState({ ...TIMER_IDLE });
  useTimerSheet.setState({ isOpen: false, step: undefined });
  useResumePrompt.setState({ request: undefined });
  useCheckinCard.setState({ request: undefined });
  useMissionSheet.setState({ openId: undefined });
  useAgoraSession.setState({ reviewDismissedDay: undefined, greetedDay: '2026-11-11', emptyDay: undefined });
  useCompanion.getState().clear();
  useToast.getState().dismiss();
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

const renderAgora = () => render(
  <><AgoraScreen /><CheckinCardHost /><MissionSheetHost /><ResumePromptHost /><ToastHost /></>,
);
const mainCard = () => screen.findByRole('region', { name: 'Missão agora' });
const checkinCard = () => screen.findByRole('dialog', { name: 'Antes de começar' });
const noCheckinCard = () => expect(screen.queryByRole('dialog', { name: 'Antes de começar' })).not.toBeInTheDocument();
const clickStart = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(await within(await mainCard()).findByRole('button', { name: 'Começar' }));
const statusOf = async (id: string) => (await db.missions.get(id))?.status;
const totalXp = async () => (await db.xpEvents.toArray()).filter((x) => !x.deleted).reduce((s, x) => s + x.amount, 0);

describe('start card trigger', () => {
  it('appears on Começar for a mission postponed twice, and nothing starts before a choice', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Relatório de estágio', postponeCount: 2, firstStep: 'Abrir o modelo' });
    renderAgora();
    await clickStart(user);

    const card = await checkinCard();
    expect(within(card).getByText('O que aparece agora?')).toBeInTheDocument();
    for (const label of FEELINGS) {
      expect(within(card).getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    }
    expect(within(card).getByRole('textbox', { name: 'O que o pensamento diz?' }))
      .toHaveAttribute('placeholder', 'ex.: não sei por onde começar');
    expect(within(card).getByText('Experimento: só 10 minutos para abrir o modelo')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Começar 10 min' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Só começar' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Pular' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Não mostrar de novo hoje' })).toBeInTheDocument();
    expect(await statusOf(m.id)).toBe('open');
    expect(useTimer.getState().status).toBe('idle');
  });

  it('does not appear for a fresh light mission: Começar starts it right away', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Responder e-mail', energy: 'light' });
    renderAgora();
    await clickStart(user);
    expect(await screen.findByRole('dialog', { name: 'Missão' })).toBeInTheDocument();
    await waitFor(async () => expect(await statusOf(m.id)).toBe('doing'));
    noCheckinCard();
  });

  it('the mission sheet\'s Começar goes through the same check (heavy); Pular starts without a record', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Estudar cálculo', energy: 'heavy' });
    render(<><MissionSheetHost /><CheckinCardHost /><ToastHost /></>);
    act(() => useMissionSheet.getState().open(m.id));
    const sheet = await screen.findByRole('dialog', { name: 'Missão' });
    await user.click(within(sheet).getByRole('button', { name: 'Começar' }));

    const card = await checkinCard();
    // Without a first step the experiment names the mission.
    expect(within(card).getByText('Experimento: só 10 minutos para estudar cálculo')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Pular' }));
    await waitFor(async () => expect(await statusOf(m.id)).toBe('doing'));
    noCheckinCard();
    expect(await db.checkins.count()).toBe(0);
    expect(await xpBy('checkin')).toBe(0);
    expect(useTimer.getState().status).toBe('idle');
  });

  it('closing the card starts nothing', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Relatório', postponeCount: 3 });
    renderAgora();
    await clickStart(user);
    await user.click(within(await checkinCard()).getByRole('button', { name: 'Fechar' }));
    await waitFor(noCheckinCard);
    expect(await statusOf(m.id)).toBe('open');
    expect(await db.checkins.count()).toBe(0);
  });
});

describe('start card copy', () => {
  const openCard = async (firstStep: string) => {
    const m = await createMission({ title: 'Relatório', firstStep });
    render(<CheckinCardHost />);
    act(() => useCheckinCard.getState().open({ mission: m }));
    return checkinCard();
  };

  it('the willingness line names the feeling that was picked', async () => {
    const user = userEvent.setup();
    const card = await openCard('Abrir o modelo');
    const helper = () => within(card).getByText(/^(Nomear|Dá para)/);
    await user.click(within(card).getByRole('button', { name: 'Medo de errar' }));
    expect(helper()).toHaveTextContent('Dá para começar com o medo junto — errar faz parte do experimento.');
    await user.click(within(card).getByRole('button', { name: 'Ansiedade' }));
    expect(helper()).toHaveTextContent('Dá para começar com a ansiedade junto.');
    await user.click(within(card).getByRole('button', { name: 'Ansiedade' }));
    await user.click(within(card).getByRole('button', { name: 'Medo de errar' }));
    expect(helper()).toHaveTextContent('Nomear ajuda a seguir.');
  });

  it('keeps a proper noun or acronym at the start of the first step', async () => {
    expect(await within(await openCard('API do jornal: ler a doc'))
      .findByText('Experimento: só 10 minutos para API do jornal: ler a doc')).toBeInTheDocument();
  });
});

describe('start card answers', () => {
  it('"Começar 10 min" saves the check-in (+2 XP once), starts the mission and a 10-min countdown', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Relatório', postponeCount: 2, firstStep: 'Abrir o modelo' });
    renderAgora();
    await clickStart(user);
    const card = await checkinCard();

    expect(within(card).getByText('Nomear ajuda a seguir.')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Ansiedade' }));
    expect(within(card).getByRole('button', { name: 'Ansiedade' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(card).getByText('Dá para começar com a ansiedade junto.')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Medo de errar' }));
    await user.type(within(card).getByRole('textbox', { name: 'O que o pensamento diz?' }), 'vai ficar ruim');
    await user.click(within(card).getByRole('button', { name: 'Começar 10 min' }));

    await waitFor(() => expect(useTimer.getState()).toMatchObject({
      status: 'running', mode: 'countdown', targetMs: 10 * MIN, missionId: m.id,
    }));
    const [first] = await db.checkins.toArray();
    expect(first).toMatchObject({
      kind: 'start', feelings: ['ansiedade', 'medo de errar'], thought: 'vai ficar ruim', experimentMin: 10, missionId: m.id,
    });
    expect(useTimer.getState().checkinId).toBe(first!.id);
    await waitFor(async () => expect(await statusOf(m.id)).toBe('doing'));
    expect(await xpBy('checkin')).toBe(2);
    expect(await screen.findByText(/Check-in · \+2 XP/)).toBeInTheDocument();

    // Once per mission per day: a second card the same day is recorded but awards nothing.
    act(() => {
      useMissionSheet.getState().close();
      useTimer.setState({ ...TIMER_IDLE });
      useToast.getState().dismiss();
    });
    await updateMission(m.id, { status: 'open' });
    await clickStart(user);
    const again = await checkinCard();
    await user.click(within(again).getByRole('button', { name: 'Cansaço' }));
    await user.click(within(again).getByRole('button', { name: 'Só começar' }));
    await waitFor(async () => expect(await db.checkins.count()).toBe(2));
    await waitFor(async () => expect(await statusOf(m.id)).toBe('doing'));
    const second = (await db.checkins.toArray()).find((c) => c.id !== first!.id);
    expect(second).toMatchObject({ kind: 'start', feelings: ['cansaço'], missionId: m.id });
    expect(second?.experimentMin).toBeUndefined();
    expect(await xpBy('checkin')).toBe(2);
    expect(useTimer.getState().status).toBe('idle');
    expect(screen.queryByText(/Check-in · \+2 XP/)).not.toBeInTheDocument();
  });

  it('"Não mostrar de novo hoje" starts the mission and hides the card for the rest of the day', async () => {
    const user = userEvent.setup();
    const m = await createMission({ title: 'Relatório', postponeCount: 2 });
    renderAgora();
    await clickStart(user);
    await user.click(within(await checkinCard()).getByRole('button', { name: 'Não mostrar de novo hoje' }));
    await waitFor(async () => expect(await statusOf(m.id)).toBe('doing'));
    noCheckinCard();
    expect(localStorage.getItem(`${CHECKIN_OFF_PREFIX}2026-11-11`)).not.toBeNull();
    expect(await db.checkins.count()).toBe(0);

    act(() => useMissionSheet.getState().close());
    await updateMission(m.id, { status: 'open' });
    await clickStart(user);
    await waitFor(async () => expect(await statusOf(m.id)).toBe('doing'));
    noCheckinCard();

    // Only for today: tomorrow it is offered again.
    const mission = (await db.missions.get(m.id))!;
    const settings = await db.settings.get('settings');
    expect(wantsCheckin({ ...mission, status: 'open' }, settings, '2026-11-11')).toBe(false);
    expect(wantsCheckin({ ...mission, status: 'open' }, settings, '2026-11-12')).toBe(true);
  });

  it('turning the card off in Ajustes starts avoided missions right away', async () => {
    const user = userEvent.setup();
    useSyncStatus.setState({ state: 'disabled', pending: 0, lastSync: undefined, error: undefined });
    const { hook } = memoryLocation({ path: '/ajustes' });
    const settingsView = render(<Router hook={hook}><SettingsScreen /></Router>);
    const toggle = await screen.findByRole('checkbox', { name: 'Card de início ao começar algo adiado' });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toBeChecked(); // absent = on
    await user.click(toggle);
    await waitFor(async () => expect((await db.settings.get('settings'))?.checkinCard).toBe(false));
    settingsView.unmount();

    const m = await createMission({ title: 'Relatório', energy: 'heavy', postponeCount: 4 });
    renderAgora();
    await clickStart(user);
    await waitFor(async () => expect(await statusOf(m.id)).toBe('doing'));
    noCheckinCard();
  });
});

describe('experiment end (timer sheet)', () => {
  const startExperiment = async () => {
    const m = await createMission({
      title: 'Relatório', postponeCount: 2, checklist: [{ id: 'a', text: 'Escrever a introdução', done: false }],
    });
    const { id } = await saveCheckin({ feelings: ['ansiedade'], experimentMin: 10, missionId: m.id });
    useTimer.getState().start('countdown', { missionId: m.id, targetMin: 10, checkinId: id });
    vi.setSystemTime(Date.now() + 10 * MIN + 5000);
    return { m, id };
  };
  const renderTimer = () => render(<><TimerHost /><ResumePromptHost /><ToastHost /></>);
  const openTimer = () => {
    act(() => useTimerSheet.getState().open());
    return screen.findByRole('dialog', { name: 'Cronômetro' });
  };

  it('"Parar aqui — já valeu" records "stopped", finishes the countdown and asks where you stopped', async () => {
    const user = userEvent.setup();
    const { m, id } = await startExperiment();
    renderTimer();
    const sheet = await openTimer();
    expect(within(sheet).getByRole('button', { name: 'Continuar' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Parar aqui — já valeu' }));

    await waitFor(async () => expect((await db.checkins.get(id))?.outcome).toBe('stopped'));
    const prompt = await screen.findByRole('dialog', { name: 'Onde parou?' });
    expect(within(prompt).getByRole('textbox')).toHaveValue('Escrever a introdução');
    expect(useTimer.getState().status).toBe('idle');
    const sessions = await db.focusSessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ mode: 'countdown', activeMs: 10 * MIN, missionId: m.id, outcome: 'finished' });
  });

  it('"Continuar" records "continued" and offers Pomodoro or Livre for the same mission', async () => {
    const user = userEvent.setup();
    const { m, id } = await startExperiment();
    renderTimer();
    const sheet = await openTimer();
    await user.click(within(sheet).getByRole('button', { name: 'Continuar' }));
    await waitFor(async () => expect((await db.checkins.get(id))?.outcome).toBe('continued'));
    expect(within(sheet).getByRole('button', { name: 'Livre' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Pomodoro' }));

    await waitFor(() => expect(useTimer.getState()).toMatchObject({ status: 'running', mode: 'pomodoro', missionId: m.id }));
    expect(useTimer.getState().checkinId).toBeUndefined();
    await waitFor(async () => expect(await db.focusSessions.count()).toBe(1));
    expect(screen.queryByRole('dialog', { name: 'Onde parou?' })).not.toBeInTheDocument();
  });

  it('a plain countdown at zero offers no experiment choice', async () => {
    const m = await createMission({ title: 'Relatório' });
    useTimer.getState().start('countdown', { missionId: m.id, targetMin: 10 });
    vi.setSystemTime(Date.now() + 11 * MIN);
    renderTimer();
    const sheet = await openTimer();
    expect(within(sheet).getByRole('button', { name: 'Concluir' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Parar aqui — já valeu' })).not.toBeInTheDocument();
  });
});

describe('"Escapei"', () => {
  const said = async () => {
    const p = await db.profile.get('me');
    return PHRASES.escape.map((t) => renderPhrase(t, { name: p?.name, companion: p?.companionName }));
  };

  it('from the block banner: asks where to, logs the escape and shows the first step; XP unchanged', async () => {
    const user = userEvent.setup();
    await seedBlocks();
    await pastXp('2026-11-10');
    const m = await createMission({ title: 'Parser de notícias', journeyId: 'j-tech', firstStep: 'Abrir o arquivo do parser' });
    const before = await totalXp();
    renderAgora();
    await within(await mainCard()).findByText('Parser de notícias');
    const banner = await screen.findByRole('region', { name: 'Bloco atual' });
    await user.click(within(banner).getByRole('button', { name: 'Escapei' }));

    const dialog = await screen.findByRole('dialog', { name: 'Para onde?' });
    for (const where of ['YouTube', 'Redes', 'Outro']) expect(within(dialog).getByRole('button', { name: where })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'YouTube' }));

    expect(await within(dialog).findByText('O primeiro passo continua aqui: Abrir o arquivo do parser')).toBeInTheDocument();
    const checkins = await db.checkins.toArray();
    expect(checkins).toHaveLength(1);
    expect(checkins[0]).toMatchObject({ kind: 'escape', escapedTo: 'youtube', feelings: [], blockId: 'b1', missionId: m.id });
    const phrases = await said();
    await waitFor(() => expect(phrases).toContain(useCompanion.getState().message));

    await user.click(within(dialog).getByRole('button', { name: 'Voltar agora' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await totalXp()).toBe(before);
  });

  it('from the timer bar: logs the escape and never pauses the timer', async () => {
    const user = userEvent.setup();
    await pastXp('2026-11-10');
    const m = await createMission({ title: 'Parser', firstStep: 'Rodar o teste' });
    useTimer.getState().start('free', { missionId: m.id });
    const before = await totalXp();
    render(<><TimerBar /><ToastHost /></>);
    await user.click(await screen.findByRole('button', { name: 'Escapei' }));

    const dialog = await screen.findByRole('dialog', { name: 'Para onde?' });
    await user.click(within(dialog).getByRole('button', { name: 'Redes' }));
    expect(await within(dialog).findByText('O primeiro passo continua aqui: Rodar o teste')).toBeInTheDocument();
    expect(await db.checkins.toArray()).toEqual([
      expect.objectContaining({ kind: 'escape', escapedTo: 'redes', missionId: m.id }),
    ]);
    expect(useTimer.getState().status).toBe('running');
    await user.click(within(dialog).getByRole('button', { name: 'Voltar agora' }));
    expect(useTimer.getState().status).toBe('running');
    expect(await totalXp()).toBe(before);
  });
});
