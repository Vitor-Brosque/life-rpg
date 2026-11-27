import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';
import { FacultyValidationError, createSubject, setSubjectChatUrl } from '../src/domain/facultyActions';
import { SubjectDetailScreen } from '../src/features/faculty/SubjectDetailScreen';
import { ToastHost, useToast } from '../src/ui/Toast';

// Estudo pelos chats (spec 2026-11-25-estudo-pelos-chats §2.8, §2.9): the subject's chat link and the study request.

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 25, 10, 0));
  await db.delete(); await db.open();
  await ensureSeed();
  useToast.getState().dismiss();
});
afterEach(() => { vi.useRealTimers(); });

const LINK = 'https://chatgpt.com/g/g-p-exemplo-banco-de-dados/project';
const bd = () => createSubject({ title: 'Banco de Dados', weekdays: [3], start: '19:30', end: '22:30' });

function renderSubject(id: string) {
  const loc = memoryLocation({ path: `/estudo/materias/${id}`, record: true });
  render(<Router hook={loc.hook}><SubjectDetailScreen id={id} /><ToastHost /></Router>);
  return { get path() { return loc.history![loc.history!.length - 1]!; } };
}

describe('setSubjectChatUrl', () => {
  it('saves an https:// link up to 500 characters, an empty one removes it, anything else is refused', async () => {
    const subject = await bd();
    await expect(setSubjectChatUrl(subject.id, 'http://chatgpt.com/c/1')).rejects.toThrow(new FacultyValidationError('O link precisa começar com https://.'));
    await expect(setSubjectChatUrl(subject.id, `https://chatgpt.com/${'x'.repeat(500)}`)).rejects.toThrow('O link pode ter até 500 caracteres.');
    expect((await db.journeys.get(subject.id))!.chatUrl).toBeUndefined();
    await setSubjectChatUrl(subject.id, `  ${LINK} `);
    expect((await db.journeys.get(subject.id))!.chatUrl).toBe(LINK);
    await setSubjectChatUrl(subject.id, '');
    expect((await db.journeys.get(subject.id))!.chatUrl).toBeUndefined();
  });
});

describe('Chat da disciplina', () => {
  it('sits above Caderno, Apostilas and Avaliações; saves the link, opens it in a new tab, changes and removes it', async () => {
    const subject = await bd();
    const user = userEvent.setup();
    renderSubject(subject.id);
    await screen.findByRole('heading', { name: 'Chat da disciplina' });
    await screen.findByRole('heading', { name: 'Caderno' });
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.slice(headings.indexOf('Chat da disciplina'), headings.indexOf('Avaliações') + 1))
      .toEqual(['Chat da disciplina', 'Caderno', 'PDFs', 'Apostilas', 'Avaliações']);
    expect(screen.getByText('Com o conector ligado, peça no chat: manda para o LIFE RPG o que vimos aqui.')).toBeInTheDocument();

    const field = screen.getByLabelText('Link do chat ou do projeto');
    await user.type(field, 'chatgpt.com/c/123');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('O link precisa começar com https://.');
    expect((await db.journeys.get(subject.id))!.chatUrl).toBeUndefined();

    await user.clear(field);
    await user.type(field, LINK);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    const open = await screen.findByRole('link', { name: 'Abrir chat' });
    expect(open).toHaveAttribute('href', LINK);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(await screen.findByText('Link do chat salvo.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Link do chat ou do projeto')).toBeNull();
    expect((await db.journeys.get(subject.id))!.chatUrl).toBe(LINK);

    await user.click(screen.getByRole('button', { name: 'Trocar link' }));
    const again = screen.getByLabelText('Link do chat ou do projeto');
    expect(again).toHaveValue(LINK);
    await user.clear(again);
    await user.type(again, 'https://claude.ai/project/exemplo');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.queryByLabelText('Link do chat ou do projeto')).toBeNull());
    expect(screen.getByRole('link', { name: 'Abrir chat' })).toHaveAttribute('href', 'https://claude.ai/project/exemplo');

    await user.click(screen.getByRole('button', { name: 'Trocar link' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('link', { name: 'Abrir chat' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Trocar link' }));
    await user.clear(screen.getByLabelText('Link do chat ou do projeto'));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Link do chat removido.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull());
    expect(screen.queryByRole('link', { name: 'Abrir chat' })).toBeNull();
    expect((await db.journeys.get(subject.id))!.chatUrl).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(await screen.findByRole('link', { name: 'Abrir chat' })).toHaveAttribute('href', 'https://claude.ai/project/exemplo');
    expect((await db.journeys.get(subject.id))!.chatUrl).toBe('https://claude.ai/project/exemplo');
  });

  it('"Copiar pedido de estudo" copies the request focused on this subject', async () => {
    const subject = await bd();
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderSubject(subject.id);
    await user.click(await screen.findByRole('button', { name: 'Copiar pedido de estudo' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = String((writeText.mock.calls[0] as unknown[])[0]);
    expect(text.startsWith('Quero mandar para a disciplina "Banco de Dados" do LIFE RPG')).toBe(true);
    expect(await screen.findByText('Pedido copiado. Cole no chat da disciplina.')).toBeInTheDocument();
  });

  it('the link never goes into the study request', async () => {
    const subject = await bd();
    await setSubjectChatUrl(subject.id, LINK);
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderSubject(subject.id);
    await user.click(await screen.findByRole('button', { name: 'Copiar pedido de estudo' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String((writeText.mock.calls[0] as unknown[])[0])).not.toContain('chatgpt.com/g/');
  });

  it('"Colar resposta do chat" stores the pasted study proposal and opens its review', async () => {
    const subject = await bd();
    const user = userEvent.setup();
    const location = renderSubject(subject.id);
    await user.click(await screen.findByRole('button', { name: 'Colar resposta do chat' }));
    const box = await screen.findByLabelText('Resposta do chat');
    await user.click(box);
    await user.paste(`\`\`\`json\n${JSON.stringify({
      title: 'Aula de normalização', summary: 'O que vimos hoje.',
      study: [{ subject: 'Banco de Dados', topics: [{ name: 'Normalização', seen: true }], cards: [{ type: 'basic', front: 'O que é a 3FN?', back: 'Sem dependência transitiva.' }] }],
    })}\n\`\`\``);
    await user.click(screen.getByRole('button', { name: 'Revisar proposta' }));
    await waitFor(async () => expect(await db.proposals.count()).toBe(1));
    const [p] = await db.proposals.toArray();
    expect(p).toMatchObject({ source: 'Colada de um chat', status: 'pending', payload: { study: [{ subject: 'Banco de Dados' }] } });
    await waitFor(() => expect(location.path).toBe(`/propostas/${p!.id}?from=${encodeURIComponent(`/estudo/materias/${subject.id}`)}`));
  });

  it('a pasted answer for an unknown subject lists the problem and stores nothing', async () => {
    const subject = await bd();
    const user = userEvent.setup();
    renderSubject(subject.id);
    await user.click(await screen.findByRole('button', { name: 'Colar resposta do chat' }));
    const box = await screen.findByLabelText('Resposta do chat');
    await user.click(box);
    await user.paste(JSON.stringify({ title: 'X', summary: 'Y', study: [{ subject: 'Cálculo I', topics: [{ name: 'Limites' }] }] }));
    await user.click(screen.getByRole('button', { name: 'Revisar proposta' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('listitem')).toHaveTextContent('study.0.subject: Disciplina "Cálculo I" não existe.');
    expect(await db.proposals.count()).toBe(0);
  });
});
