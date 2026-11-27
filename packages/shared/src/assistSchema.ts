import { AI_LIMITS } from './ai';
import { ASSIST_LIMITS, BLOCK_KINDS, MISSION_DURATIONS } from './assist';
import { SUBJECT_TITLE_MAX, TOPIC_NAME_MAX } from './faculty';
import { BIB_KINDS, NOTEBOOK_LIMITS } from './notebook';

// JSON Schema of a proposal (spec 2026-11-25 §5). It mirrors `validateProposal`; shared by the MCP tool and the
// copy-and-paste request, so both ask assistants for exactly the same format.

const str = (description: string, maxLength: number) => ({ type: 'string', description, maxLength });
const why = str('Por que este item (curto). Aparece para a pessoa na revisão.', ASSIST_LIMITS.why);
const weekdays = { type: 'array', description: 'Dias da semana: 0 = domingo, 1 = segunda … 6 = sábado.', items: { type: 'integer', minimum: 0, maximum: 6 }, minItems: 1, maxItems: 7, uniqueItems: true };
const hhmm = (description: string) => ({ type: 'string', description: `${description} (HH:mm, 24 h)`, pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' });
const areaRef = str('Nome de uma área que já existe (veja ler_contexto) ou criada nesta proposta.', ASSIST_LIMITS.areaName * 2);

const missionProps = (withArea: boolean) => ({
    title: str('Título curto e concreto.', ASSIST_LIMITS.missionTitle),
    ...(withArea ? { area: areaRef } : {}),
    durationMin: { type: 'integer', enum: [...MISSION_DURATIONS], description: 'Duração estimada em minutos.' },
    energy: { type: 'string', enum: ['light', 'medium', 'heavy'], description: 'Energia que pede.' },
    important: { type: 'boolean' },
    date: { type: 'string', description: `Dia planejado (AAAA-MM-DD), de hoje até ${ASSIST_LIMITS.dateAheadDays} dias.` },
    firstStep: str('A primeira ação, bem pequena.', ASSIST_LIMITS.firstStep),
    why,
});
const mission = { type: 'object', additionalProperties: false, required: ['title'], properties: missionProps(true) };
/** Study missions take the subject's area when applied, so they have no `area`. */
const studyMission = { type: 'object', additionalProperties: false, required: ['title'], properties: missionProps(false) };

export const PROPOSAL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'summary'],
  properties: {
    title: str('Título da proposta.', ASSIST_LIMITS.title),
    summary: str('O raciocínio em poucas frases: o que você propõe e por quê. Aparece no topo da revisão.', ASSIST_LIMITS.summary),
    areas: { type: 'array', maxItems: ASSIST_LIMITS.areas, description: 'Áreas novas da vida (cada uma vira um atributo do personagem).', items: {
      type: 'object', additionalProperties: false, required: ['name', 'attribute'],
      properties: { name: str('Nome da área.', ASSIST_LIMITS.areaName), attribute: str('Nome do atributo do personagem (ex.: Vigor, Intelecto).', ASSIST_LIMITS.attribute), why },
    } },
    renameAreas: { type: 'array', maxItems: ASSIST_LIMITS.renames, description: 'Renomear áreas que já existem.', items: {
      type: 'object', additionalProperties: false, required: ['from', 'to'],
      properties: { from: str('Nome atual.', ASSIST_LIMITS.areaName * 2), to: str('Nome novo.', ASSIST_LIMITS.areaName), why },
    } },
    goals: { type: 'array', maxItems: ASSIST_LIMITS.goals, description: 'Objetivos de médio prazo.', items: {
      type: 'object', additionalProperties: false, required: ['title'],
      properties: { title: str('O objetivo, em uma linha.', 80), why: str('Por que importa.', ASSIST_LIMITS.goalWhy), horizon: str('Horizonte em texto livre (ex.: julho de 2027).', ASSIST_LIMITS.horizon) },
    } },
    season: { type: 'object', additionalProperties: false, required: ['title', 'weeks'], description: 'Uma temporada de 6 a 8 semanas com até 2 focos.', properties: {
      title: str('Nome da temporada.', 80), weeks: { type: 'integer', enum: [6, 7, 8] },
      focus: { type: 'array', maxItems: 2, items: str('Um foco.', ASSIST_LIMITS.focusText) }, why,
    } },
    journeys: { type: 'array', maxItems: ASSIST_LIMITS.journeys, description: 'Projetos com missões em sequência.', items: {
      type: 'object', additionalProperties: false, required: ['title', 'missions'],
      properties: {
        title: str('Nome da jornada.', ASSIST_LIMITS.title), area: areaRef,
        outcome: str('Resultado esperado.', ASSIST_LIMITS.outcome),
        goal: str('Objetivo que ela serve (nome de um objetivo existente ou desta proposta).', 80),
        missions: { type: 'array', maxItems: ASSIST_LIMITS.journeyMissions, items: mission }, why,
      },
    } },
    missions: { type: 'array', maxItems: ASSIST_LIMITS.missions, description: 'Missões avulsas (fora de jornadas).', items: mission },
    routine: { type: 'object', additionalProperties: false, required: ['mode', 'blocks'], description: 'Blocos da rotina da semana.', properties: {
      mode: { type: 'string', enum: ['add', 'replace'], description: 'add soma à rotina atual; replace arquiva os blocos atuais (sem apagar).' },
      blocks: { type: 'array', minItems: 1, maxItems: ASSIST_LIMITS.blocks, items: {
        type: 'object', additionalProperties: false, required: ['name', 'weekdays', 'start', 'durationMin', 'minimumMin', 'kind'],
        properties: {
          name: str('Nome do bloco.', ASSIST_LIMITS.blockName), weekdays, start: hhmm('Início'),
          durationMin: { type: 'integer', minimum: 5, maximum: 480, description: 'Duração normal em minutos.' },
          minimumMin: { type: 'integer', minimum: 5, maximum: 480, description: 'Versão mínima em minutos (dia difícil), até a duração.' },
          kind: { type: 'string', enum: [...BLOCK_KINDS], description: 'focus, study, body, light ou routine.' },
          protected: { type: 'boolean', description: 'Protegido: não some em dia de recuperação.' },
          area: areaRef, journey: str('Jornada ligada ao bloco (existente ou desta proposta).', ASSIST_LIMITS.title),
          checklist: { type: 'array', maxItems: ASSIST_LIMITS.checklistMax, items: str('Item de checklist (blocos de rotina).', ASSIST_LIMITS.checklistItem) },
          why,
        },
      } },
    } },
    commitments: { type: 'array', maxItems: ASSIST_LIMITS.commitments, description: 'Compromissos fixos semanais (aula, trabalho).', items: {
      type: 'object', additionalProperties: false, required: ['title', 'weekdays', 'start', 'end'],
      properties: { title: str('Título.', ASSIST_LIMITS.commitmentTitle), weekdays, start: hhmm('Início'), end: hhmm('Fim'), why },
    } },
    training: { type: 'object', additionalProperties: false, required: ['days'], description: 'Plano de treino da semana (substitui o atual) e, se quiser, um bloco.', properties: {
      days: { type: 'array', minItems: 1, maxItems: 7, items: {
        type: 'object', additionalProperties: false, required: ['weekday', 'name', 'exercises'],
        properties: {
          weekday: { type: 'integer', minimum: 0, maximum: 6 }, name: str('Nome do treino do dia.', 40),
          exercises: { type: 'array', maxItems: 20, items: {
            type: 'object', additionalProperties: false, required: ['name'],
            properties: {
              name: str('Exercício.', 80), sets: { type: 'integer', minimum: 1, maximum: 10 },
              repsMin: { type: 'integer', minimum: 1, maximum: 100 }, repsMax: { type: 'integer', minimum: 1, maximum: 100 },
              restMinSec: { type: 'integer', minimum: 15, maximum: 600 }, restMaxSec: { type: 'integer', minimum: 15, maximum: 600 },
              note: str('Observação de técnica.', 120),
            },
          } },
        },
      } },
      block: { type: 'object', additionalProperties: false, required: ['startDay', 'weeks'], description: 'Bloco (mesociclo).', properties: {
        startDay: { type: 'string', description: 'Início (AAAA-MM-DD).' },
        weeks: { type: 'array', minItems: 1, maxItems: 8, items: {
          type: 'object', additionalProperties: false, required: ['rirMin', 'rirMax'],
          properties: {
            rirMin: { type: 'integer', minimum: 0, maximum: 5 }, rirMax: { type: 'integer', minimum: 0, maximum: 5 },
            cardioMin: { type: 'integer', minimum: 1, maximum: 300 }, cardioMax: { type: 'integer', minimum: 1, maximum: 300 },
          },
        } },
      } },
      why,
    } },
    subjects: { type: 'array', maxItems: ASSIST_LIMITS.subjects, description: 'Disciplinas da faculdade, com a aula semanal.', items: {
      type: 'object', additionalProperties: false, required: ['title'],
      properties: { title: str('Nome da disciplina.', 60), weekday: { type: 'integer', minimum: 0, maximum: 6 }, start: hhmm('Início da aula'), end: hhmm('Fim da aula'), why },
    } },
    study: { type: 'array', maxItems: ASSIST_LIMITS.study, description: 'O que a pessoa estudou na conversa, um pacote por disciplina. Use quando ela pedir para mandar ao LIFE RPG o que vocês estudaram, só com o que foi de fato visto ou combinado.', items: {
      type: 'object', additionalProperties: false, required: ['subject'], minProperties: 2,
      description: 'Pacote de uma disciplina: pelo menos um de topics, cards, assessments, missions, notebook ou docs.',
      properties: {
        subject: str('Nome de uma disciplina que já existe (veja ler_contexto) ou criada em subjects nesta proposta.', SUBJECT_TITLE_MAX),
        topics: { type: 'array', maxItems: ASSIST_LIMITS.studyTopics, description: 'Assuntos da disciplina (não repita os que o contexto já mostra).', items: {
          type: 'object', additionalProperties: false, required: ['name'],
          properties: {
            name: str('Nome do assunto.', TOPIC_NAME_MAX),
            seen: { type: 'boolean', description: 'true quando o assunto já foi estudado nesta conversa (marca o nível "Vi").' },
            why,
          },
        } },
        cards: { type: 'array', maxItems: ASSIST_LIMITS.studyCards, description: 'Cards de revisão. Entram como rascunho para a pessoa conferir.', items: {
          type: 'object', additionalProperties: false, required: ['type', 'front', 'back'],
          properties: {
            type: { type: 'string', enum: ['basic', 'topic'], description: 'basic: pergunta e resposta; topic: tema na frente e pontos-chave no verso, um por linha.' },
            front: str('Frente: a pergunta ou o tema.', AI_LIMITS.cardField),
            back: str('Verso: a resposta ou os pontos-chave (um por linha).', AI_LIMITS.cardField),
            why,
          },
        } },
        assessments: { type: 'array', maxItems: ASSIST_LIMITS.studyAssessments, description: 'Provas e trabalhos com data (não repita os que o contexto já mostra).', items: {
          type: 'object', additionalProperties: false, required: ['kind', 'date'],
          properties: {
            kind: { type: 'string', enum: ['prova', 'trabalho'] },
            date: { type: 'string', description: `Dia (AAAA-MM-DD), de hoje até ${ASSIST_LIMITS.assessmentAheadDays} dias.` },
            content: str('O que cai ou o que entregar.', ASSIST_LIMITS.assessmentContent),
            why,
          },
        } },
        missions: { type: 'array', maxItems: ASSIST_LIMITS.studyMissions, description: 'Tarefas da disciplina (viram missões da jornada dela).', items: studyMission },
        notebook: { type: 'object', additionalProperties: false, minProperties: 1, description: 'O caderno da disciplina, a memória entre as conversas. Cada seção que vier substitui a atual inteira (mande a seção completa); a bibliografia é mesclada pelo título.', properties: {
          plan: str('Plano de ensino: ementa, objetivos, cronograma e critérios de avaliação (Markdown).', NOTEBOOK_LIMITS.plan),
          studied: str('O que já foi estudado (Markdown).', NOTEBOOK_LIMITS.studied),
          difficulties: str('Dificuldades da pessoa nesta disciplina (Markdown).', NOTEBOOK_LIMITS.difficulties),
          nextChat: str('O que um chat novo precisa saber para continuar, inclusive como ensinar a pessoa (Markdown).', NOTEBOOK_LIMITS.nextChat),
          bibliography: { type: 'array', maxItems: NOTEBOOK_LIMITS.bibliography, description: 'Livros e materiais da disciplina (um livro com o mesmo título é atualizado).', items: {
            type: 'object', additionalProperties: false, required: ['title', 'kind'],
            properties: {
              title: str('Título.', NOTEBOOK_LIMITS.bibTitle),
              authors: str('Autores.', NOTEBOOK_LIMITS.bibAuthors),
              kind: { type: 'string', enum: [...BIB_KINDS], description: 'basica, complementar ou outra.' },
              url: { type: 'string', description: 'Link https:// (opcional).', maxLength: NOTEBOOK_LIMITS.bibUrl, pattern: '^https://' },
              note: str('Observação curta (capítulos, edição).', NOTEBOOK_LIMITS.bibNote),
            },
          } },
        } },
        docs: { type: 'array', maxItems: NOTEBOOK_LIMITS.docs, description: 'Apostilas que você escreveu para a pessoa (resumo, explicação, lista de exercícios). Uma apostila com o mesmo título na disciplina tem o texto substituído.', items: {
          type: 'object', additionalProperties: false, required: ['title', 'markdown'],
          properties: {
            title: str('Título da apostila.', NOTEBOOK_LIMITS.docTitle),
            markdown: str('O texto em Markdown: títulos com #, listas, **negrito**, fórmulas entre $ (ou $$ em linha própria) e código entre crases triplas.', NOTEBOOK_LIMITS.docMarkdown),
            why,
          },
        } },
      },
    } },
    studyProfile: { type: 'object', additionalProperties: false, required: ['text'], description: 'O perfil de estudo da pessoa, comum a todas as disciplinas: como ela aprende melhor, horários, o que funciona. Substitui o atual (mande o texto completo).', properties: {
      text: str('O perfil de estudo (Markdown).', NOTEBOOK_LIMITS.studyProfile), why,
    } },
    preferences: { type: 'object', additionalProperties: false, description: 'Início e fim do dia lógico.', properties: {
      dayStartHour: { type: 'integer', minimum: 0, maximum: 6, description: 'Hora em que o dia começa (0 a 6).' },
      dayEndHour: { type: 'integer', enum: [20, 21, 22, 23, 0], description: 'Hora em que o dia termina (0 = meia-noite).' },
      why,
    } },
  },
} as const;
