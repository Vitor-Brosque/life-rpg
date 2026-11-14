import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { rateCard, saveDeck, saveNote, saveStudySettings } from '../src/domain/studyActions';
import { studySync, useStudyReminders } from '../src/features/reminders/reminders';
import { StudyPrefsSheet } from '../src/features/study/StudyPrefsSheet';

const push = vi.hoisted(() => ({ schedulePush: vi.fn(async () => true), cancelPush: vi.fn(async () => true) }));
vi.mock('../src/timer/push', () => push);

function Harness() { useStudyReminders(); return null; }

beforeEach(async () => {
  studySync.debounceMs = 0;
  push.schedulePush.mockClear(); push.cancelPush.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 12, 10, 0)); // Thursday
  await db.delete(); await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

async function cards(n: number) {
  const d = await saveDeck({ name: 'SQL' });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(`${(await saveNote({ deckId: d.id, type: 'basic', front: `p${i}`, back: 'r' })).id}-0`);
  return ids;
}
const scheduled = () => push.schedulePush.mock.calls as unknown as unknown[][];

describe('study reminder scheduling', () => {
  it('turning it on schedules today; turning it off cancels; goal met cancels today', async () => {
    const ids = await cards(8);
    await saveStudySettings({ budgetMin: 5 });
    render(<Harness />);
    await new Promise((r) => setTimeout(r, 50));
    expect(push.schedulePush).not.toHaveBeenCalled();

    await saveStudySettings({ reminderAt: '18:00' });
    await vi.waitFor(() => expect(scheduled().map((c) => c[0])).toContain('study:2026-11-12'));
    const todays = scheduled().find((c) => c[0] === 'study:2026-11-12')!;
    expect(todays[1]).toBe(new Date(2026, 10, 12, 18, 0).getTime());
    expect(todays[2]).toBe('LIFE RPG');
    expect(todays[3]).toMatch(/^Revisão de hoje: \d+ cards, uns \d+ min\.$/);

    // Turning it off cancels what was scheduled.
    await saveStudySettings({ reminderAt: undefined });
    await vi.waitFor(() => expect(push.cancelPush).toHaveBeenCalledWith('study:2026-11-12'));
    expect((await db.settings.get('settings'))!.study!.reminderAt).toBeUndefined();

    // On again, then the goal is met: today's notice is cancelled.
    push.schedulePush.mockClear(); push.cancelPush.mockClear();
    await saveStudySettings({ reminderAt: '18:00' });
    await vi.waitFor(() => expect(scheduled().map((c) => c[0])).toContain('study:2026-11-12'));
    for (const id of ids.slice(0, 5)) await rateCard(id, 3, { durationMs: 60_000, wrote: false });
    await vi.waitFor(() => expect(push.cancelPush).toHaveBeenCalledWith('study:2026-11-12'));
  });
});

describe('study reminder debounce', () => {
  it('várias respostas seguidas reagendam o lembrete de hoje uma vez só', async () => {
    const ids = await cards(8);
    await saveStudySettings({ budgetMin: 30, reminderAt: '18:00' });
    render(<Harness />);
    await vi.waitFor(() => expect(scheduled().map((c) => c[0])).toContain('study:2026-11-12'));
    studySync.debounceMs = 300;
    push.schedulePush.mockClear();
    for (const id of ids.slice(0, 4)) await rateCard(id, 3, { durationMs: 1000, wrote: false });
    expect(push.schedulePush).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(scheduled().filter((c) => c[0] === 'study:2026-11-12')).toHaveLength(1), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 500));
    expect(scheduled().filter((c) => c[0] === 'study:2026-11-12')).toHaveLength(1);
  });
});

describe('StudyPrefsSheet reminder switch', () => {
  it('has a named switch, defaults to 18:00 when turned on and saves reminderAt', async () => {
    const user = userEvent.setup();
    render(<StudyPrefsSheet open onClose={() => undefined} />);
    const sw = await screen.findByRole('switch', { name: 'Lembrete de estudo' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Um aviso por dia de estudo, só se houver cards para hoje e a meta ainda não foi cumprida. No iPhone, só funciona com o app na Tela de Início.')).toBeInTheDocument();
    await user.click(sw);
    expect(screen.getByLabelText('Horário do lembrete de estudo')).toHaveValue('18:00');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await vi.waitFor(async () => expect((await db.settings.get('settings'))!.study!.reminderAt).toBe('18:00'));
  });

  it('turning it off and saving clears reminderAt', async () => {
    const user = userEvent.setup();
    await saveStudySettings({ reminderAt: '19:30' });
    render(<StudyPrefsSheet open onClose={() => undefined} />);
    const sw = await screen.findByRole('switch', { name: 'Lembrete de estudo' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Horário do lembrete de estudo')).toHaveValue('19:30');
    await user.click(sw);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await vi.waitFor(async () => expect((await db.settings.get('settings'))!.study!.reminderAt).toBeUndefined());
  });

  it('saving other preferences keeps the reminder', async () => {
    await saveStudySettings({ reminderAt: '19:30' });
    await saveStudySettings({ budgetMin: 25 });
    expect((await db.settings.get('settings'))!.study!.reminderAt).toBe('19:30');
  });
});
