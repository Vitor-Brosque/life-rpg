import type { DayKey } from './types';
import { ASSIST_LIMITS, ASSIST_RULES, PASTE_NOTEBOOK_RULE, type AssistContext } from './assist';
import { PROPOSAL_SCHEMA } from './assistSchema';
import { NOTEBOOK_LIMITS } from './notebook';
import type { SubjectContext } from './subjectContext';

// "Sem conector": the same proposal, moved by copy and paste instead of by an MCP connector. The person copies the
// request into any chat, talks there, and pastes the chat's JSON answer back; the app validates it exactly like a
// proposal sent by a connector.

/**
 * The text the person pastes into any chat (pt-BR). Compact: schema and context are one-line JSON. With `subject`
 * (the "Copiar pedido de estudo" of a subject's page) it opens asking for what this conversation taught, as `study`,
 * and `memory` (the same view as `ler_disciplina`, with only the newest `NOTEBOOK_LIMITS.pasteCards` cards) closes it,
 * so a chat without the connector also gets the subject's caderno. Its PDFs go with title and pages only (no text, no id:
 * there is no ler_material in a copied request).
 */
export function pasteRequestText(context: AssistContext, today: DayKey, subject?: string, memory?: SubjectContext): string {
  // No tools in a copied request: the rule that names them is left out or told without them.
  const { howItWorks: _skip, notebook: _tool, ...rest } = ASSIST_RULES;
  void _skip; void _tool;
  const rules = { ...rest, notebook: PASTE_NOTEBOOK_RULE };
  const intro = subject
    ? [
      `Quero mandar para a disciplina "${subject}" do LIFE RPG, meu app pessoal de rotina, estudo e treino em forma de jogo, o que estudamos nesta conversa.`,
      `Responda com a seção study, num pacote com subject "${subject}" (use subjects só se essa disciplina ainda não existir no app). Coloque só o que foi de fato visto ou combinado aqui: assuntos (seen: true nos que já estudamos), cards, provas e trabalhos com data e tarefas. No notebook, mande as seções do caderno atualizadas (o texto novo substitui o antigo) e, em nextChat, o que o próximo chat precisa saber; em docs, as apostilas que eu pedir.`,
    ]
    : ['Você vai me ajudar a personalizar o LIFE RPG, meu app pessoal de rotina, estudo e treino em forma de jogo.'];
  // ler_disciplina carries up to 150 cards; a pasted message competes with the conversation, so it keeps the newest 60.
  const pasted = memory && {
    ...memory,
    files: memory.files.map((f) => ({ title: f.title, pages: f.pages })),
    cards: { ...memory.cards, items: memory.cards.items.slice(0, NOTEBOOK_LIMITS.pasteCards) },
  };
  const cardsPart = pasted && pasted.cards.items.length < pasted.cards.total
    ? `os ${pasted.cards.items.length} cards mais recentes de ${pasted.cards.total}`
    : 'cards';
  return [
    ...intro,
    '',
    'Como fazer:',
    '1. Primeiro converse comigo: pergunte o que precisar e só proponha o que eu pedir ou aceitar.',
    '2. Quando eu concordar, responda com UM único bloco JSON (```json … ```) no formato abaixo, sem texto dentro do bloco.',
    '3. Nunca invente dados meus. Se faltar informação, pergunte.',
    '4. Eu vou revisar tudo no app, desmarcar o que não quiser e aplicar. Nada muda antes disso.',
    '5. Itens com o mesmo nome de algo que já existe são reaproveitados, sem duplicar. Áreas, jornadas, objetivos e disciplinas são citados pelo nome.',
    '',
    `Hoje é ${today}.`,
    '',
    'Regras do app:',
    ...Object.values(rules).map((r) => `- ${r}`),
    '',
    'Formato do JSON (JSON Schema):',
    JSON.stringify(PROPOSAL_SCHEMA),
    '',
    'Como o LIFE RPG está montado agora:',
    JSON.stringify({ ...context, rules: undefined }),
    ...(pasted ? [
      '',
      `A memória da disciplina "${pasted.subject}" no LIFE RPG (caderno, perfil de estudo, assuntos, provas e trabalhos, apostilas, PDFs da aula e ${cardsPart}). Continue de onde o último chat parou:`,
      JSON.stringify(pasted),
    ] : []),
  ].join('\n');
}

export type PasteParse = { ok: true; value: unknown } | { ok: false; reason: 'empty' | 'too-big' | 'not-json' };

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/** Takes the proposal out of what a chat answered: a ```json fence, raw JSON, or from the first `{` to the last `}`. */
export function parsePastedProposal(text: string): PasteParse {
  if (text.trim() === '') return { ok: false, reason: 'empty' };
  if (utf8Bytes(text) > ASSIST_LIMITS.bodyBytes) return { ok: false, reason: 'too-big' };
  const candidates: string[] = [];
  const fenced = /```(?:json)?[ \t]*\r?\n?([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  candidates.push(text.trim());
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) candidates.push(text.slice(a, b + 1));
  for (const c of candidates) {
    try { return { ok: true, value: JSON.parse(c) as unknown }; } catch { /* try the next one */ }
  }
  return { ok: false, reason: 'not-json' };
}
