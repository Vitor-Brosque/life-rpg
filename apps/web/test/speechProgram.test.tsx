import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings, SpeechProgram } from '@life/shared';
import { db } from '../src/db/db';
import { newRecord, patch, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { savePhaseNote } from '../src/domain/speechActions';
import { PROGRAM_COPY } from '../src/features/speech/ProgramCard';
import { VOCAL_NOTE } from '../src/features/speech/VocalNote';
import { SpeechScreen } from '../src/features/speech/SpeechScreen';
import { ToastHost, useToast } from '../src/ui/Toast';
import { at } from './blockFixture';

vi.mock('../src/domain/speechActions', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/domain/speechActions')>();
  return { ...m, savePhaseNote: vi.fn(m.savePhaseNote) };
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(23, 10));
  await db.delete();
  await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
});
afterEach(() => {
  vi.useRealTimers();
  window.history.pushState({}, '', '/');
});

const renderFala = () => {
  window.history.pushState({}, '', '/estudo/fala');
  return render(<><SpeechScreen /><ToastHost /></>);
};
const dismissNote = () => patch<Settings>('settings', 'settings', { speech: { noteDismissed: true } });
const seedProgram = (week: number, extra: Partial<SpeechProgram> = {}) =>
  put('speechPrograms', newRecord<SpeechProgram>({ startDay: '2026-11-16', week, status: 'ativo', phaseNotes: {}, ...extra }));
const programs = () => db.speechPrograms.toArray();

describe('Vocal note', () => {
  it('points first to an otolaryngologist, then to a speech therapist (the order of the cited guideline)', () => {
    expect(VOCAL_NOTE.startsWith('Rouquidão que não melhora em cerca de 4 semanas, dor ao falar, perda de voz ou esforço constante para ser '
      + 'ouvido são motivos para procurar avaliação de um otorrinolaringologista ou de um fonoaudiólogo. Se a dificuldade de ser '
      + 'entendido continuar frequente apesar da prática, uma avaliação fonoaudiológica é o caminho para saber o que está acontecendo.')).toBe(true);
  });
  it('shows once: "Entendi" keeps only the always-available "Saúde vocal e limites"', async () => {
    const user = userEvent.setup();
    renderFala();
    const ok = await screen.findByRole('button', { name: 'Entendi' });
    expect(screen.getAllByText(VOCAL_NOTE)).toHaveLength(2);
    await user.click(ok);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Entendi' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Fala' })));
    expect((await db.settings.get('settings'))!.speech).toEqual({ noteDismissed: true });
    expect(screen.getByText('Saúde vocal e limites')).toBeInTheDocument();
    expect(screen.getAllByText(VOCAL_NOTE)).toHaveLength(1);
  });
});

describe('Programa de 12 semanas', () => {
  it('starts, follows the week in "Hoje", and moves week by week', async () => {
    await dismissNote();
    const user = userEvent.setup();
    renderFala();
    expect(await screen.findByText(PROGRAM_COPY.none)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Começar programa' }));
    expect(await screen.findByText('Programa começou: semana 1 de 12.')).toBeInTheDocument();
    expect(await screen.findByText('Semana 1 de 12 · Fase 1: Observar e criar referências')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Semana anterior' })).toBeDisabled();
    expect(screen.getByText('Semana 1 · Gravar as primeiras referências, sem tentar mudar nada.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Começar: 5 min, Leitura de referência · A feira de sábado' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Próxima semana' }));
    expect(await screen.findByText('Semana 2 de 12 · Fase 1: Observar e criar referências')).toBeInTheDocument();
    expect(screen.getByLabelText('Fim da fase 1: o que mudou nas situações reais? (opcional)')).toBeInTheDocument();
  });

  it('his phase answer is kept when the week changes, and comes back', async () => {
    await dismissNote();
    await seedProgram(2);
    const user = userEvent.setup();
    renderFala();
    await user.type(await screen.findByLabelText('Fim da fase 1: o que mudou nas situações reais? (opcional)'), 'Pergunto mais em aula');
    await user.click(screen.getByRole('button', { name: 'Próxima semana' }));
    expect(await screen.findByText(/^Semana 3 de 12/)).toBeInTheDocument();
    await waitFor(async () => expect((await programs())[0]!.phaseNotes?.[1]?.text).toBe('Pergunto mais em aula'));
    await user.click(screen.getByRole('button', { name: 'Semana anterior' }));
    expect(await screen.findByDisplayValue('Pergunto mais em aula')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar resposta' })).toBeDisabled();
  });

  it('saves the answer with its own button and a toast', async () => {
    await dismissNote();
    await seedProgram(2);
    const user = userEvent.setup();
    renderFala();
    await user.type(await screen.findByLabelText('Fim da fase 1: o que mudou nas situações reais? (opcional)'), 'Falei mais devagar');
    await user.click(screen.getByRole('button', { name: 'Salvar resposta' }));
    expect(await screen.findByText('Resposta da fase guardada.')).toBeInTheDocument();
    expect((await programs())[0]!.phaseNotes?.[1]?.text).toBe('Falei mais devagar');
  });

  it('ends with Desfazer; focus goes to "Começar programa"', async () => {
    await dismissNote();
    await seedProgram(1);
    const user = userEvent.setup();
    renderFala();
    await user.click(await screen.findByRole('button', { name: 'Encerrar programa' }));
    expect(await screen.findByText('Programa encerrado. Pode começar de novo quando quiser.')).toBeInTheDocument();
    const start = await screen.findByRole('button', { name: 'Começar programa' });
    await waitFor(() => expect(document.activeElement).toBe(start));
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(await screen.findByText(/^Semana 1 de 12/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Fala' })).toHaveFocus());
  });

  it('opening writes nothing', async () => {
    await dismissNote();
    await seedProgram(5);
    renderFala();
    const outbox = await db.outbox.count();
    expect(await screen.findByText(/^Semana 5 de 12/)).toBeInTheDocument();
    expect(await db.outbox.count()).toBe(outbox);
  });

  it('"Começar programa" moves focus to the program title', async () => {
    await dismissNote();
    const user = userEvent.setup();
    renderFala();
    await user.click(await screen.findByRole('button', { name: 'Começar programa' }));
    await screen.findByText(/^Semana 1 de 12/);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Programa de 12 semanas' })).toHaveFocus());
  });

  it('week buttons that become disabled hand focus to the program title (both ends)', async () => {
    await dismissNote();
    await seedProgram(2);
    const user = userEvent.setup();
    renderFala();
    await user.click(await screen.findByRole('button', { name: 'Semana anterior' }));
    await screen.findByText(/^Semana 1 de 12/);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Programa de 12 semanas' })).toHaveFocus());
    await db.speechPrograms.clear();
    await seedProgram(11);
    await user.click(await screen.findByRole('button', { name: 'Próxima semana' }));
    await screen.findByText(/^Semana 12 de 12/);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Programa de 12 semanas' })).toHaveFocus());
  });

  it('after "Salvar resposta" focus is in the textarea', async () => {
    await dismissNote();
    await seedProgram(2);
    const user = userEvent.setup();
    renderFala();
    const field = await screen.findByLabelText('Fim da fase 1: o que mudou nas situações reais? (opcional)');
    await user.type(field, 'Mais calma');
    await user.click(screen.getByRole('button', { name: 'Salvar resposta' }));
    await screen.findByText('Resposta da fase guardada.');
    await waitFor(() => expect(field).toHaveFocus());
  });

  it('a refused save keeps his text and the week; trying again works', async () => {
    await dismissNote();
    await seedProgram(2);
    vi.mocked(savePhaseNote).mockRejectedValueOnce(new Error('disk'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    renderFala();
    const field = await screen.findByLabelText('Fim da fase 1: o que mudou nas situações reais? (opcional)');
    await user.type(field, 'Mais calma');
    await user.click(screen.getByRole('button', { name: 'Próxima semana' }));
    expect(await screen.findByText('Algo não funcionou. Tente de novo.')).toBeInTheDocument();
    expect(screen.getByLabelText('Fim da fase 1: o que mudou nas situações reais? (opcional)')).toHaveValue('Mais calma');
    expect(screen.getByText(/^Semana 2 de 12/)).toBeInTheDocument();
    expect((await programs())[0]!.week).toBe(2);
    await user.click(screen.getByRole('button', { name: 'Próxima semana' }));
    expect(await screen.findByText(/^Semana 3 de 12/)).toBeInTheDocument();
    expect((await programs())[0]!.phaseNotes?.[1]?.text).toBe('Mais calma');
  });

  it('"Encerrar programa" keeps an unsaved phase answer', async () => {
    await dismissNote();
    await seedProgram(2);
    const user = userEvent.setup();
    renderFala();
    await user.type(await screen.findByLabelText('Fim da fase 1: o que mudou nas situações reais? (opcional)'), 'Mais calma');
    await user.click(screen.getByRole('button', { name: 'Encerrar programa' }));
    expect(await screen.findByText(PROGRAM_COPY.ended)).toBeInTheDocument();
    const [p] = await programs();
    expect(p).toMatchObject({ status: 'encerrado' });
    expect(p!.phaseNotes?.[1]?.text).toBe('Mais calma');
  });

  describe('the phase answer survives leaving the screen', () => {
    const LABEL = 'Fim da fase 1: o que mudou nas situações reais? (opcional)';
    const setVisibility = (state: DocumentVisibilityState) =>
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    afterEach(() => { delete (document as { visibilityState?: unknown }).visibilityState; });
    const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

    it('a typed answer is saved quietly when the screen goes away', async () => {
      await dismissNote();
      await seedProgram(2);
      const user = userEvent.setup();
      const view = renderFala();
      await user.type(await screen.findByLabelText(LABEL), 'Saí no meio');
      view.unmount();
      await waitFor(async () => expect((await programs())[0]!.phaseNotes?.[1]?.text).toBe('Saí no meio'));
    });

    it('hidden and pagehide in a row save it once, with the field and focus as they were; leaving afterwards writes nothing more', async () => {
      await dismissNote();
      await seedProgram(2);
      const user = userEvent.setup();
      const view = renderFala();
      const field = await screen.findByLabelText(LABEL);
      await user.type(field, 'Mais calma');
      vi.mocked(savePhaseNote).mockClear();
      setVisibility('hidden');
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('pagehide'));
      });
      await waitFor(async () => expect((await programs())[0]!.phaseNotes?.[1]?.text).toBe('Mais calma'));
      expect(field).toHaveValue('Mais calma');
      expect(field).toHaveFocus();
      view.unmount();
      await flush();
      expect(savePhaseNote).toHaveBeenCalledTimes(1);
    });

    it('nothing is written when the text did not change', async () => {
      await dismissNote();
      await seedProgram(2, { phaseNotes: { 1: { text: 'Já respondi', day: '2026-11-20', answeredAt: at(20, 10) } } });
      const outboxBefore = await db.outbox.count();
      const user = userEvent.setup();
      const view = renderFala();
      const field = await screen.findByLabelText(LABEL);
      expect(field).toHaveValue('Já respondi');
      await user.type(field, ' ');
      vi.mocked(savePhaseNote).mockClear();
      setVisibility('hidden');
      act(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); });
      view.unmount();
      await flush();
      expect(savePhaseNote).not.toHaveBeenCalled();
      expect(await db.outbox.count()).toBe(outboxBefore);
    });

    it('an answer saved with its button is not written again on leaving', async () => {
      await dismissNote();
      await seedProgram(2);
      const user = userEvent.setup();
      const view = renderFala();
      await user.type(await screen.findByLabelText(LABEL), 'Pelo botão');
      await user.click(screen.getByRole('button', { name: 'Salvar resposta' }));
      expect(await screen.findByText(PROGRAM_COPY.noteSaved)).toBeInTheDocument();
      vi.mocked(savePhaseNote).mockClear();
      view.unmount();
      await flush();
      expect(savePhaseNote).not.toHaveBeenCalled();
    });
  });
});
