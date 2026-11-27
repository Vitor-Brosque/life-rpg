import { PROPOSAL_SCHEMA, STUDY_FILE_LIMITS, SUBJECT_TITLE_MAX } from '@life/shared';

// The MCP tools (spec 2026-11-25 §5, caderno 2026-11-26 §4). Descriptions are what the assistant reads, so they are in
// Portuguese and say what the person will see. The proposal schema mirrors `validateProposal` (the server validates
// again anyway). The reading tools (ler_material: PDFs da aula 2026-11-26 §3) sit under the existing reading scope.

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const TOOLS = [
  {
    name: 'ler_contexto',
    title: 'Ler o LIFE RPG',
    description: 'Lê como o LIFE RPG da pessoa está montado (perfil, áreas, rotina, compromissos fixos, jornadas, objetivos, temporada, missões abertas, plano de treino, disciplinas com os assuntos, as provas e trabalhos ainda abertos, se o caderno tem algo e quantas apostilas tem), um resumo em números das últimas 4 semanas, o que aconteceu com as propostas anteriores e as regras do app. Use antes de propor. Para estudar uma disciplina (caderno, perfil de estudo, apostilas e cards), use ler_disciplina. Não traz diário, sono, nutrição, check-ins, energia nem estratégias.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Ler o LIFE RPG', ...READ_ONLY },
  },
  {
    name: 'ler_disciplina',
    title: 'Ler uma disciplina do LIFE RPG',
    description: 'Lê a memória de uma disciplina: o caderno (plano de ensino, o que já foi estudado, dificuldades, o que o próximo chat precisa saber e a bibliografia), o perfil de estudo da pessoa (como ela aprende melhor, comum a todas as disciplinas), os assuntos com o nível atual, as provas e trabalhos, a lista de apostilas (sem o texto; leia uma com ler_apostila), os PDFs da aula em files (slides, plano de ensino, capítulos: título, páginas e se têm texto; leia o texto com ler_material) e até 150 cards dos baralhos da disciplina. Chame antes de ensinar ou de propor estudo dessa disciplina: o caderno é a memória entre as conversas, e um chat novo continua de onde o outro parou. Não traz diário, sono, nutrição, check-ins, energia, estratégias, baralhos fora das disciplinas nem PDFs fora das disciplinas.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['disciplina'],
      properties: { disciplina: { type: 'string', description: 'O nome de uma disciplina do app (veja ler_contexto).', maxLength: SUBJECT_TITLE_MAX } },
    },
    annotations: { title: 'Ler uma disciplina do LIFE RPG', ...READ_ONLY },
  },
  {
    name: 'ler_apostila',
    title: 'Ler uma apostila do LIFE RPG',
    description: 'Lê uma apostila de uma disciplina inteira: título, disciplina e o texto em Markdown. Use o id que ler_disciplina mostra em docs, por exemplo para revisar ou continuar uma apostila (mande a versão nova em study.docs com o mesmo título).',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: { id: { type: 'string', description: 'O id da apostila (veja docs em ler_disciplina).', maxLength: 64 } },
    },
    annotations: { title: 'Ler uma apostila do LIFE RPG', ...READ_ONLY },
  },
  {
    name: 'ler_material',
    title: 'Ler um PDF da aula no LIFE RPG',
    description: `Lê o texto de um PDF da aula de uma disciplina (slides, plano de ensino, capítulo de livro), página por página, com o número de cada página. Use o id que ler_disciplina mostra em files. Sem fromPage, começa na página 1; sem toPage, vai até o fim. Traz no máximo ${STUDY_FILE_LIMITS.materialChars.toLocaleString('pt-BR')} caracteres por chamada: se o intervalo passar disso, para na última página inteira que couber e diz em nextPage de onde continuar. Leia antes de montar apostilas, cards ou o caderno a partir do PDF e cite a página. PDFs sem disciplina não são lidos.`,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: {
        id: { type: 'string', description: 'O id do PDF (veja files em ler_disciplina).', maxLength: 64 },
        fromPage: { type: 'integer', minimum: 1, description: 'A primeira página (padrão: 1).' },
        toPage: { type: 'integer', minimum: 1, description: 'A última página (padrão: a última do PDF).' },
      },
    },
    annotations: { title: 'Ler um PDF da aula no LIFE RPG', ...READ_ONLY },
  },
  {
    name: 'enviar_proposta',
    title: 'Enviar uma proposta ao LIFE RPG',
    description: 'Envia uma proposta para personalizar o LIFE RPG: áreas, rotina em blocos, compromissos fixos, jornadas com missões, missões avulsas, objetivos, temporada, plano de treino, disciplinas, o estudo de cada disciplina (assuntos, cards, provas e trabalhos, tarefas, o caderno da disciplina e apostilas), o perfil de estudo e início e fim do dia. Nada muda na hora: a pessoa revisa no app, desmarca o que não quiser e aplica. Proponha só o que combinou com a pessoa na conversa. Quando a pessoa pedir para mandar ao LIFE RPG o que estudaram na conversa, use study com a disciplina dela, só com o que foi de fato visto ou combinado, e mande em notebook as seções do caderno atualizadas (o texto novo substitui o antigo) e em nextChat o que o próximo chat precisa saber. Se algo vier errado, a resposta lista o que corrigir.',
    inputSchema: PROPOSAL_SCHEMA,
    annotations: { title: 'Enviar uma proposta ao LIFE RPG', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
] as const;

export const SERVER_INSTRUCTIONS = 'LIFE RPG é um app pessoal de rotina, estudo e treino em forma de jogo. Chame ler_contexto antes de propor qualquer coisa. Antes de ensinar ou propor estudo de uma disciplina, chame ler_disciplina: o caderno dela é a memória entre as conversas. Para montar apostilas a partir dos PDFs da aula, leia o texto deles com ler_material e cite a página. Converse com a pessoa e só envie com enviar_proposta o que ela pediu ou aceitou. Toda proposta é revisada e aplicada pela pessoa no app; você nunca altera nada diretamente. Não invente dados da pessoa.';
