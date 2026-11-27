import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { DiaryEntry, DiaryLink, DiaryTheme, Journey, Profile, Week } from '@life/shared';
import { App } from '../src/app/App';
import { db } from '../src/db/db';
import { applyRemote, newRecord, patch, put } from '../src/db/repo';
import { ensureSeed } from '../src/db/seed';
import { saveDiaryEntry, trashDiaryEntry } from '../src/domain/diaryActions';
import { writeDiaryDraft } from '../src/features/diary/diaryDraft';
import { DiaryScreen } from '../src/features/diary/DiaryScreen';
import { at } from './blockFixture';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(13, 10));   // Friday 13/11/2026: the week of 09/11
  localStorage.clear();
  await db.delete();
  await db.open();
  await ensureSeed();
});
afterEach(() => { vi.useRealTimers(); });

const write = (id: string, day: number, h: number, text: string, p: { themes?: DiaryTheme[]; links?: DiaryLink[]; private?: boolean } = {}) =>
  saveDiaryEntry(id, {
    text, day: `2026-11-${String(day).padStart(2, '0')}`, at: at(day, h), themes: p.themes ?? [], links: p.links ?? [], private: p.private ?? false,
  });

function renderDiary(path = '/diario') {
  const loc = memoryLocation({ path, record: true });
  render(<Router hook={loc.hook}><DiaryScreen /></Router>);
  return loc;
}

describe('timeline', () => {
  it('the week by day (newest first), entries in time order, with their marks; opening writes nothing', async () => {
    const j = await put('journeys', newRecord<Journey>({ title: 'Tech News', status: 'active', order: 0 }));
    await write('a', 10, 21, 'Fechei o dia.');
    await patch<DiaryEntry>('diaryEntries', 'a', { kind: 'fechamento' });
    await write('b', 10, 8, 'Acordei cedo.\nCafé.\nÔnibus.\nAula.', { themes: ['sono'], private: true });
    await write('c', 12, 14, 'Reunião sobre o Tech News.', { links: [{ kind: 'journey', id: j.id }] });
    await write('old', 3, 9, 'Semana passada.');
    const queued = await db.outbox.count();
    renderDiary();
    expect(await screen.findByRole('heading', { name: 'Semana 09/11–15/11' })).toBeInTheDocument();
    const days = await screen.findAllByRole('heading', { level: 3 });
    expect(days.map((h) => h.textContent)).toEqual(['Quinta-feira, 12/11', 'Terça-feira, 10/11']);
    const tuesday = screen.getByRole('region', { name: 'Terça-feira, 10/11' });
    const opens = within(tuesday).getAllByRole('link');
    expect(opens.map((l) => l.getAttribute('href'))).toEqual(['/diario/b', '/diario/a']);
    expect(opens[0]).toHaveTextContent('08:00Acordei cedo. Café. Ônibus.…');
    expect(within(tuesday).getByText('fechamento do dia')).toBeInTheDocument();
    expect(within(tuesday).getByText('privada')).toBeInTheDocument();
    expect(within(tuesday).getByText('Sono')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Quinta-feira, 12/11' })).getByText('jornada: Tech News')).toBeInTheDocument();
    expect(screen.queryByText('Semana passada.')).not.toBeInTheDocument();
    expect(await db.outbox.count()).toBe(queued);
  });

  it('arrows, same week last month and back; Próxima semana stops at this week', async () => {
    const user = userEvent.setup();
    await write('old', 3, 9, 'Semana passada.');
    await saveDiaryEntry('oct', { text: 'Outubro.', day: '2026-10-07', at: new Date(2026, 9, 7, 9).getTime(), themes: [], links: [], private: false });
    const loc = renderDiary();
    expect(await screen.findByRole('button', { name: 'Próxima semana' })).toBeDisabled();
    expect(await screen.findByText('Nenhuma entrada nesta semana.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Semana anterior' }));
    expect(await screen.findByRole('heading', { name: 'Semana 02/11–08/11' })).toBeInTheDocument();
    expect(await screen.findByText('Semana passada.')).toBeInTheDocument();
    expect(loc.history!.at(-1)).toBe('/diario?semana=2026-11-02');
    await user.click(screen.getByRole('button', { name: 'Mesma semana, mês passado' }));
    expect(await screen.findByRole('heading', { name: 'Semana 28/09–04/10' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Próxima semana' }));
    expect(await screen.findByText('Outubro.')).toBeInTheDocument();
  });

  it('the Diário tab (no ?semana=) goes back to the current week', async () => {
    const loc = renderDiary('/diario?semana=2026-11-02');
    expect(await screen.findByRole('heading', { name: 'Semana 02/11–08/11' })).toBeInTheDocument();
    act(() => loc.navigate('/diario'));
    expect(await screen.findByRole('heading', { name: 'Semana 09/11–15/11' })).toBeInTheDocument();
  });

  it('?semana= opens that week; the reviews answered in it are read-only cards', async () => {
    await put('weeks', newRecord<Week>({ id: '2026-11-02', objectives: [], review: { worked: 'Blocos curtos.', obstacle: '', adjustment: '', answeredAt: at(3, 9) } }));
    renderDiary('/diario?semana=2026-11-04');
    expect(await screen.findByRole('heading', { name: 'Semana 02/11–08/11' })).toBeInTheDocument();
    const card = await screen.findByRole('article', { name: 'Nova semana · respondida em 03/11' });
    expect(within(card).getByText('O que funcionou')).toBeInTheDocument();
    expect(within(card).getByText('Blocos curtos.')).toBeInTheDocument();
  });
});

describe('focus', () => {
  it('never falls to the body: reaching this week and clearing the search', async () => {
    const user = userEvent.setup();
    renderDiary('/diario?semana=2026-11-02');
    await user.click(await screen.findByRole('button', { name: 'Próxima semana' }));
    expect(await screen.findByRole('heading', { name: 'Semana 09/11–15/11' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próxima semana' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Semana anterior' })).toHaveFocus();
    await user.type(screen.getByLabelText('Buscar no diário'), 'zzz');
    await user.click(await screen.findByRole('button', { name: 'Limpar busca' }));
    expect(screen.getByLabelText('Buscar no diário')).toHaveFocus();
  });
});

describe('search and filters', () => {
  it('a word across every week (accents and case ignored), by date; nothing found; clear', async () => {
    const user = userEvent.setup();
    await write('a', 10, 21, 'Reunião com a orientadora');
    await write('old', 3, 9, 'Outra REUNIAO antiga');
    await write('x', 11, 9, 'Treino de pernas');
    await trashDiaryEntry('x');
    renderDiary();
    await user.type(await screen.findByLabelText('Buscar no diário'), 'reuniao');
    expect(await screen.findByText('2 entradas encontradas')).toBeInTheDocument();
    const results = screen.getByRole('region', { name: 'Resultados' });
    expect(within(results).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/diario/a', '/diario/old']);
    expect(within(results).getByText('ter 10/11 · 21:00')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Buscar no diário'));
    await user.type(screen.getByLabelText('Buscar no diário'), 'pernas');
    expect(await screen.findByText('Nada encontrado com esse filtro.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Limpar busca' }));
    expect(await screen.findByRole('heading', { name: 'Semana 09/11–15/11' })).toBeInTheDocument();
  });

  it('filters by theme, by link and only private', async () => {
    const user = userEvent.setup();
    const j = await put('journeys', newRecord<Journey>({ title: 'Tech News', status: 'active', order: 0 }));
    await write('a', 10, 21, 'Sobre o projeto', { links: [{ kind: 'journey', id: j.id }] });
    await write('b', 11, 22, 'Dormi mal', { themes: ['sono'], private: true });
    await write('c', 12, 9, 'Dia comum');
    renderDiary();
    await user.click(await screen.findByText('Filtros'));
    await user.click(screen.getByRole('button', { name: 'Sono' }));
    expect(await screen.findByText('1 entrada encontrada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Dormi mal/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sono' }));
    await user.selectOptions(screen.getByLabelText('Vínculo'), 'jornada: Tech News');
    expect(await screen.findByRole('link', { name: /Sobre o projeto/ })).toBeInTheDocument();
    expect(screen.getByText('1 entrada encontrada')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Vínculo'), 'Todos');
    await user.click(screen.getByRole('button', { name: 'Só privadas' }));
    expect(await screen.findByRole('link', { name: /Dormi mal/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Dia comum/ })).not.toBeInTheDocument();
  });

  it('Apagadas recentemente shows only when something is there', async () => {
    await write('a', 10, 21, 'Some');
    renderDiary();
    await screen.findByRole('heading', { name: 'Semana 09/11–15/11' });
    expect(screen.queryByRole('link', { name: /Apagadas recentemente/ })).not.toBeInTheDocument();
    await trashDiaryEntry('a');
    expect(await screen.findByRole('link', { name: 'Apagadas recentemente (1)' })).toHaveAttribute('href', '/diario/apagadas');
  });
});

describe('texts kept on this device', () => {
  const kept = (text: string) => ({ text, day: '2026-11-12', at: at(12, 9), themes: [], links: [], private: false });

  it('one line per kept draft whose words are not in its entry (missing, deleted, changed since or not), newest first', async () => {
    vi.setSystemTime(at(13, 8));
    const same = (await write('same', 12, 9, 'Salvo antes'))!;
    const deleted = (await write('deleted', 12, 9, 'Apagado em outro aparelho'))!;
    vi.setSystemTime(at(13, 9));
    writeDiaryDraft('gone', kept('Nunca salvo'));
    vi.setSystemTime(at(13, 9, 10));
    writeDiaryDraft('same', kept('Salvo antes e mais'), same.updatedAt);   // the app closed before it was saved
    vi.setSystemTime(at(13, 9, 20));
    writeDiaryDraft('deleted', kept('Apagado, e mais'), deleted.updatedAt);
    vi.setSystemTime(at(13, 9, 30));
    writeDiaryDraft('newer', kept('Velho'));
    writeDiaryDraft('equal', kept('Já salvo'));
    vi.setSystemTime(at(13, 9, 40));
    await write('newer', 12, 10, 'Editado depois, em outro aparelho');
    await write('equal', 12, 10, 'Já salvo');
    await applyRemote({ table: 'diaryEntries', record: { ...deleted, text: '', themes: [], links: [], deleted: true, updatedAt: at(13, 9, 50) } });
    const queued = await db.outbox.count();
    renderDiary();
    const list = await screen.findByRole('list', { name: 'Textos não salvos' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Texto não salvo de 13/11 09:30Continuar', 'Texto não salvo de 13/11 09:20Continuar',
      'Texto não salvo de 13/11 09:10Continuar', 'Texto não salvo de 13/11 09:00Continuar',
    ]);
    expect(within(list).getAllByRole('link').map((l) => [l.getAttribute('href'), l.getAttribute('aria-label')])).toEqual([
      ['/diario/newer', 'Continuar o texto de 13/11 09:30'], ['/diario/deleted', 'Continuar o texto de 13/11 09:20'],
      ['/diario/same', 'Continuar o texto de 13/11 09:10'], ['/diario/gone', 'Continuar o texto de 13/11 09:00'],
    ]);
    expect(within(list).getByRole('link', { name: 'Continuar o texto de 13/11 09:30' })).toBeInTheDocument();
    expect(await db.outbox.count()).toBe(queued);
  });

  it('nothing kept, no line', async () => {
    renderDiary();
    await screen.findByRole('heading', { name: 'Semana 09/11–15/11' });
    expect(screen.queryByRole('list', { name: 'Textos não salvos' })).not.toBeInTheDocument();
  });
});

describe('navigation', () => {
  const renderApp = async (path: string) => {
    await patch<Profile>('profile', 'me', { onboarded: true });
    const loc = memoryLocation({ path, record: true });
    render(<Router hook={loc.hook}><App /></Router>);
    return loc;
  };

  it('Diário is a tab; Escrever opens a new entry', async () => {
    const user = userEvent.setup();
    const loc = await renderApp('/diario');
    const nav = await screen.findByRole('navigation', { name: 'Navegação principal' });
    expect(within(nav).getByRole('link', { name: 'Diário' })).toHaveAttribute('aria-current', 'page');
    await user.click(await screen.findByRole('button', { name: 'Escrever' }));
    await waitFor(() => expect(loc.history!.at(-1)).toMatch(/^\/diario\/[0-9A-Z]{26}$/));
    expect(await screen.findByRole('heading', { name: 'Nova entrada' })).toBeInTheDocument();
  });

  it('/jornadas opens Planejar on Jornadas, with the Planejar tab lit', async () => {
    const loc = await renderApp('/jornadas');
    expect(await screen.findByRole('tab', { name: 'Objetivos', selected: true })).toBeInTheDocument();
    expect(loc.history!.at(-1)).toBe('/planejar?aba=jornadas');
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
    expect(within(nav).getByRole('link', { name: 'Planejar' })).toHaveAttribute('aria-current', 'page');
  });
});
