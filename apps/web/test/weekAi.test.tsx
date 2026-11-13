import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockSession, WeekRequest, XpEvent } from '@life/shared';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { useCompanion } from '../src/features/companion/store';
import { WeekCard } from '../src/features/week/WeekCard';
import { at, seedBlocks } from './blockFixture';
import { enableAi, fail, mockFetch, ok, resetAi } from './aiFixture';

// Monday 2026-11-16 (week '2026-11-16'); the numbers describe 2026-11-09 … 15.
const WEEK = '2026-11-16';
const base = { createdAt: 1, updatedAt: 1, deleted: false };
const session = (blockId: string, d: number, version: 'normal' | 'minimum' = 'normal'): BlockSession => {
  const day = `2026-11-${String(d).padStart(2, '0')}`;
  return { ...base, id: `bs-${blockId}-${day}`, blockId, day, startedAt: at(d, 9), endedAt: at(d, 9, 40), version };
};
const xp = (id: string, dayKey: string): XpEvent => ({ ...base, id, at: 1, amount: 5, reason: 'block', dayKey });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(16, 9, 30));
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
  await seedBlocks();
  await db.blockSessions.bulkPut([session('b1', 9), session('b1', 10, 'minimum')]);
  await db.xpEvents.bulkPut([xp('x1', '2026-11-09'), xp('x2', '2026-11-10')]);
  useCompanion.getState().clear();
  resetAi();
});
afterEach(() => { resetAi(); vi.useRealTimers(); });

const SUMMARY = { observed: 'Você iniciou 2 blocos, um na versão mínima.', hypothesis: '', suggestion: 'Se quiser, teste começar às 9h.' };
const renderCard = () => render(<WeekCard today={WEEK} weekId={WEEK} onLater={() => {}} onDone={() => {}} />);
const card = () => screen.findByRole('region', { name: 'Nova semana' });
const aiRegion = () => screen.findByRole('region', { name: /Resumo da semana/ });
/** The observed rows exactly as the card shows them. */
const shownFacts = (c: HTMLElement) =>
  [...c.querySelectorAll('.week-stat')].map((row) => ({
    label: row.querySelector('dt')!.textContent!, value: row.querySelector('dd')!.textContent!,
  }));

describe('WeekAiSummary', () => {
  it('nothing without the aid', async () => {
    await enableAi({ hints: true });
    renderCard();
    await within(await card()).findByRole('heading', { name: 'Sua leitura' });
    expect(screen.queryByRole('region', { name: /Resumo da semana/ })).toBeNull();
  });

  it('after the reading; sends only the numbers by default', async () => {
    await enableAi({ weekly: true });
    const { requests } = mockFetch(() => ok(SUMMARY));
    renderCard();
    const c = await card();
    const region = await aiRegion();
    const reading = within(c).getByRole('heading', { name: 'Sua leitura' });
    const save = within(c).getByRole('button', { name: 'Salvar e continuar' });
    expect(reading.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const include = within(region).getByRole('checkbox', { name: 'Incluir minhas respostas acima' });
    expect(include).not.toBeChecked();
    expect(include).toBeDisabled();
    const pre = region.querySelector('pre')!;
    expect(pre.textContent).toContain('Semana de 09/11 a 15/11');
    expect(pre.textContent).toContain('Números observados pelo app:');
    expect(pre.textContent).not.toContain('Leitura');

    await userEvent.click(within(region).getByRole('button', { name: 'Resumir a semana' }));
    expect(await within(region).findByText(SUMMARY.observed)).toBeInTheDocument();
    const body = requests[0]!.body as WeekRequest;
    expect(body).toEqual({ weekStart: '2026-11-09', facts: shownFacts(c) });
    expect('reading' in body).toBe(false);
    expect(within(region).getByText('Observado')).toBeInTheDocument();
    expect(within(region).queryByText('Hipótese')).toBeNull();
    expect(within(region).getByText('Sugestão')).toBeInTheDocument();
    expect(within(region).getByText('Gerado por IA a partir dos números. Pode errar; discorde à vontade.')).toBeInTheDocument();
  });

  it('includes the answers only when ticked', async () => {
    await enableAi({ weekly: true });
    const { requests } = mockFetch(() => ok(SUMMARY));
    renderCard();
    const c = await card();
    await userEvent.type(within(c).getByLabelText('O que funcionou?'), 'manhãs');
    const region = await aiRegion();
    const include = within(region).getByRole('checkbox', { name: 'Incluir minhas respostas acima' });
    expect(include).toBeEnabled();
    await userEvent.click(include);
    expect(region.querySelector('pre')!.textContent).toContain('Leitura do próprio estudante:\n- O que funcionou: manhãs');
    await userEvent.click(within(region).getByRole('button', { name: 'Resumir a semana' }));
    await within(region).findByText(SUMMARY.observed);
    expect((requests[0]!.body as WeekRequest).reading).toEqual({ worked: 'manhãs', obstacle: '', adjustment: '' });
  });

  it('kept on this device, and erasable', async () => {
    await enableAi({ weekly: true });
    mockFetch(() => ok(SUMMARY));
    const first = renderCard();
    await userEvent.click(within(await aiRegion()).getByRole('button', { name: 'Resumir a semana' }));
    await screen.findByText(SUMMARY.observed);
    expect(localStorage.getItem(`life-rpg-week-ai:${WEEK}`)).not.toBeNull();
    first.unmount();

    renderCard();
    const region = await aiRegion();
    expect(within(region).getByText(SUMMARY.observed)).toBeInTheDocument();
    await userEvent.click(within(region).getByRole('button', { name: 'Apagar resumo' }));
    expect(within(region).queryByText(SUMMARY.observed)).toBeNull();
    expect(within(region).getByRole('button', { name: 'Resumir a semana' })).toBeInTheDocument();
    expect(localStorage.getItem(`life-rpg-week-ai:${WEEK}`)).toBeNull();
  });

  it('an error is one kind sentence', async () => {
    await enableAi({ weekly: true });
    mockFetch(() => fail(502, 'bad_output'));
    renderCard();
    const region = await aiRegion();
    await userEvent.click(within(region).getByRole('button', { name: 'Resumir a semana' }));
    expect(await within(region).findByRole('alert')).toHaveTextContent('A IA respondeu num formato inesperado. Tente de novo.');
  });

  it('saving the review stays as before (the summary is not stored in it)', async () => {
    await enableAi({ weekly: true });
    mockFetch(() => ok(SUMMARY));
    renderCard();
    const c = await card();
    await userEvent.click(within(await aiRegion()).getByRole('button', { name: 'Resumir a semana' }));
    await screen.findByText(SUMMARY.observed);
    await userEvent.type(within(c).getByLabelText('O que funcionou?'), 'manhãs');
    await userEvent.click(within(c).getByRole('button', { name: 'Salvar e continuar' }));
    await waitFor(async () => expect((await db.weeks.get(WEEK))?.review?.worked).toBe('manhãs'));
    expect(Object.keys((await db.weeks.get(WEEK))!.review!).sort()).toEqual(['adjustment', 'answeredAt', 'obstacle', 'worked']);
  });
});

describe('WeekAiSummary focus and safety', () => {
  it('keeps focus on a control after asking, asking again and erasing', async () => {
    await enableAi({ weekly: true });
    mockFetch(() => ok(SUMMARY));
    renderCard();
    const region = await aiRegion();
    await userEvent.click(within(region).getByRole('button', { name: 'Resumir a semana' }));
    await within(region).findByText(SUMMARY.observed);
    await waitFor(() => expect(document.activeElement).toBe(within(region).getByRole('button', { name: 'Resumir de novo' })));
    await userEvent.click(within(region).getByRole('button', { name: 'Apagar resumo' }));
    await waitFor(() => expect(document.activeElement).toBe(within(region).getByRole('button', { name: 'Resumir a semana' })));
  });

  it('a stored summary that is not valid is ignored', async () => {
    await enableAi({ weekly: true });
    localStorage.setItem(`life-rpg-week-ai:${WEEK}`, JSON.stringify({ summary: { observed: 5 }, at: 1 }));
    renderCard();
    const region = await aiRegion();
    expect(within(region).getByRole('button', { name: 'Resumir a semana' })).toBeInTheDocument();
  });

  it('writing one week drops the other weeks', async () => {
    const { writeWeekSummary } = await import('../src/features/week/weekCycle');
    const s = { summary: SUMMARY, at: 1 };
    writeWeekSummary('2026-11-09', s);
    writeWeekSummary('2026-11-16', s);
    expect(localStorage.getItem('life-rpg-week-ai:2026-11-09')).toBeNull();
    expect(localStorage.getItem('life-rpg-week-ai:2026-11-16')).not.toBeNull();
  });
});
