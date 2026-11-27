import type {
  DayKey, ID, SituationContext, SituationRepeats, SpeechContent, SpeechExercise, SpeechKind, SpeechPhase, SpeechProgram,
  SpeechRatingKey, SpeechRecording, SpeechScore, SpeechSession, SpeechSimulation, SpeechSize,
} from './types';
import { diffDays } from './dates';

// Comunicação oral (2026-11-23): practice sessions with recordings, the reference readings (the only place with a speed),
// the optional 12-week program, real situations and which recordings may leave this device. Rules only: nothing here
// reads or writes the database, nothing scores the speech, and nothing is inferred from the audio (no volume, no
// transcription). Speaking slower is never presented as better.

// ------------------------------------------------------------------ labels and limits

export const SPEECH_SIZES: readonly SpeechSize[] = [5, 15, 30];
export const SPEECH_SIZE_LABEL: Record<SpeechSize, string> = { 5: '5 min', 15: '15 min', 30: '25–30 min' };
export const SPEECH_KINDS: readonly SpeechKind[] = ['leitura', 'explicacao', 'exercicio', 'simulacao'];
export const SPEECH_KIND_LABEL: Record<SpeechKind, string> = {
  leitura: 'Leitura de referência', explicacao: 'Explicação espontânea', exercicio: 'Exercício', simulacao: 'Simulação',
};
export const SPEECH_EXERCISES: readonly SpeechExercise[] = ['pausas', 'ritmo', 'enfase', 'articulacao'];
export const SPEECH_EXERCISE_LABEL: Record<SpeechExercise, string> = {
  pausas: 'Pausas', ritmo: 'Ritmo', enfase: 'Ênfase', articulacao: 'Articulação',
};
export const SPEECH_SIMULATIONS: readonly SpeechSimulation[] = ['entrevista', 'apresentacao', 'pergunta'];
export const SPEECH_SIMULATION_LABEL: Record<SpeechSimulation, string> = {
  entrevista: 'Entrevista', apresentacao: 'Apresentação', pergunta: 'Pergunta em aula',
};
export const SPEECH_RATING_KEYS: readonly SpeechRatingKey[] = ['clareza', 'ritmo', 'pausas', 'conforto'];
export const SPEECH_RATING_LABEL: Record<SpeechRatingKey, string> = {
  clareza: 'Clareza percebida', ritmo: 'Ritmo', pausas: 'Pausas', conforto: 'Conforto vocal',
};
export const SPEECH_SCORES: readonly SpeechScore[] = [1, 2, 3, 4, 5];
export const SPEECH_CONTENTS: readonly SpeechContent[] = ['sim', 'em-parte', 'nao'];
export const SPEECH_CONTENT_LABEL: Record<SpeechContent, string> = { sim: 'Sim', 'em-parte': 'Em parte', nao: 'Não' };
export const SITUATION_CONTEXTS: readonly SituationContext[] = ['aula', 'conversa', 'entrevista', 'apresentacao', 'outra'];
export const SITUATION_CONTEXT_LABEL: Record<SituationContext, string> = {
  aula: 'Aula', conversa: 'Conversa', entrevista: 'Entrevista', apresentacao: 'Apresentação', outra: 'Outra',
};
export const SITUATION_REPEATS: readonly SituationRepeats[] = [0, 1, 2, 3];
/** The chips of "Pediram para repetir?". */
export const SITUATION_REPEATS_LABEL: Record<SituationRepeats, string> = { 0: '0', 1: '1', 2: '2', 3: '3+' };
/** The same answer inside a sentence. */
export const SITUATION_REPEATS_TEXT: Record<SituationRepeats, string> = {
  0: 'nenhuma vez', 1: '1 vez', 2: '2 vezes', 3: '3 ou mais vezes',
};

/** Speech recordings stop by themselves at 3 minutes (the card recordings keep AUDIO_MAX_MS, 2 minutes). */
export const SPEECH_AUDIO_MAX_MS = 180_000;
export const SPEECH_XP = 8;
/** At most this many sessions earn speech XP per logical day. */
export const SPEECH_DAILY_SESSIONS = 2;
export const SPEECH_TOPIC_MAX = 120;
export const SPEECH_NOTES_MAX = 2000;
export const SITUATION_NOTE_MAX = 140;
export const SPEECH_PHASE_NOTE_MAX = 1000;
/** A recording without "Guardar" (and not a reference reading) may leave this device from this many days on. */
export const SPEECH_KEEP_DAYS = 30;
/** Shorter recordings get no speed (a stray tap is not a reading). */
export const WPM_MIN_MS = 10_000;
export const SPEECH_PROGRAM_WEEKS = 12;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();
const pad2 = (n: number): string => String(n).padStart(2, '0');
/** "10/11". */
const ddmm = (day: DayKey): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** 65 000 → "1:05" (minutes and seconds, rounded down). */
export function speechClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

// ------------------------------------------------------------------ reference readings

export interface SpeechReading { id: string; title: string; text: string }

/** Written for the app (not quotations): neutral, about 130 words, with commas and full stops to pause on. */
export const SPEECH_READINGS: readonly SpeechReading[] = [
  {
    id: 'feira',
    title: 'A feira de sábado',
    text: 'Todo sábado de manhã, a praça do bairro vira uma feira. Antes das sete, as barracas já estão montadas, e o cheiro '
      + 'de café se mistura ao das frutas. Há quem chegue cedo para escolher os tomates mais firmes; há quem prefira o fim da '
      + 'manhã, quando os preços caem. Dona Rosa vende queijos há vinte anos e sabe o nome de quase todos os fregueses. Ao lado '
      + 'dela, um rapaz oferece pastéis recém-fritos e conversa sobre futebol com quem passa. Crianças correm entre as bancas, '
      + 'cachorros esperam algum pedaço que caia no chão, e um senhor toca sanfona perto da fonte. Perto do meio-dia, o '
      + 'movimento diminui. As lonas são dobradas, as caixas voltam para os caminhões, e a praça, aos poucos, fica silenciosa '
      + 'outra vez, à espera do próximo sábado.',
  },
  {
    id: 'biblioteca',
    title: 'A biblioteca',
    text: 'Uma biblioteca pública guarda muito mais do que livros. Nas estantes há revistas, jornais antigos, mapas e discos, '
      + 'organizados por assunto para que qualquer pessoa encontre o que procura. Cada obra recebe um número, e esse número '
      + 'indica a prateleira onde ela deve ficar. Quando alguém devolve um livro, um funcionário confere o estado das páginas e '
      + 'o coloca de volta no lugar certo. Parece simples, mas um único volume fora de ordem pode ficar perdido por meses. Por '
      + 'isso, muitas bibliotecas pedem que os leitores deixem os livros consultados sobre a mesa, em vez de guardá-los '
      + 'sozinhos. Além do acervo, há salas de estudo, computadores e, em alguns lugares, oficinas de leitura para crianças. '
      + 'Tudo isso funciona de graça, mantido pela cidade, para quem quiser entrar.',
  },
  {
    id: 'trem',
    title: 'Uma viagem de trem',
    text: 'O trem saiu da estação pontualmente às oito e quinze. Pela janela, os prédios foram ficando baixos, depois deram '
      + 'lugar a galpões e, por fim, a campos abertos, verdes e amarelos. No vagão, cada passageiro arrumou o seu canto: uma '
      + 'mulher abriu um livro grosso, dois estudantes dividiram um par de fones, e um senhor de chapéu cochilou antes da '
      + 'segunda parada. O cobrador passou conferindo as passagens, devagar, cumprimentando um por um. Em certo trecho, o '
      + 'trilho acompanha um rio largo, e quase todos se viram para olhar. A água brilhava sob o sol, e barcos pequenos '
      + 'pareciam parados no meio da correnteza. Depois de duas horas, o trem diminuiu a velocidade, apitou longamente e '
      + 'entrou na cidade, onde o dia já estava quente e barulhento.',
  },
];
export const READING_SOURCE = 'Texto de referência do app (original)';

export const readingOf = (id: string | undefined): SpeechReading | undefined => SPEECH_READINGS.find((r) => r.id === id);

/** Words of a fixed text: whitespace-separated pieces with at least one letter or digit ("—" alone is not a word). */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * Words per minute of a reference reading: the passage's words ÷ the recording's duration, rounded. Undefined for
 * an unknown passage, a recording stopped by the cap (the reading may not have ended) or one shorter than 10 s.
 */
export function readingWpm(passage: string | undefined, rec: Pick<SpeechRecording, 'durationMs' | 'capped'>): number | undefined {
  const r = readingOf(passage);
  // At the 3-minute limit the reading may not have finished, flagged or not: no speed.
  if (!r || rec.capped || rec.durationMs >= SPEECH_AUDIO_MAX_MS || !(rec.durationMs >= WPM_MIN_MS)) return undefined;
  return Math.round(wordCount(r.text) / (rec.durationMs / 60_000));
}

/** The speed of a recording, only in a reference reading: never for spontaneous speech. */
export const sessionWpm = (s: Pick<SpeechSession, 'kind' | 'passage'>, rec: Pick<SpeechRecording, 'durationMs' | 'capped'>): number | undefined =>
  (s.kind === 'leitura' ? readingWpm(s.passage, rec) : undefined);

// ------------------------------------------------------------------ sessions

/** "Leitura de referência · A feira de sábado", "Exercício · Pausas", "Explicação espontânea · explicar um JOIN". */
export function speechSessionTitle(s: Pick<SpeechSession, 'kind' | 'exercise' | 'simulation' | 'passage' | 'topic'>): string {
  const detail = s.kind === 'leitura' ? readingOf(s.passage)?.title
    : s.kind === 'exercicio' ? (s.exercise ? SPEECH_EXERCISE_LABEL[s.exercise] : undefined)
    : s.kind === 'simulacao' ? (s.simulation ? SPEECH_SIMULATION_LABEL[s.simulation] : undefined)
    : undefined;
  const topic = s.kind !== 'leitura' ? flat(s.topic ?? '') : '';
  return [SPEECH_KIND_LABEL[s.kind], detail, topic].filter(Boolean).join(' · ');
}

/** The content question is asked only where there is something to explain. */
export const asksContent = (kind: SpeechKind | undefined): boolean => kind === 'explicacao' || kind === 'simulacao';

/** A stored session with every list present (records from another version may lack one). */
export function normalizeSpeechSession(s: SpeechSession): SpeechSession {
  return { ...s, recordings: Array.isArray(s.recordings) ? s.recordings : [], ratings: s.ratings ?? {} };
}

/** Sessions that count in lists and reports: closed, recorded or marked done (an untouched draft never exists). */
export const speechCounted = (s: SpeechSession): boolean =>
  !s.deleted && (s.closedAt !== undefined || (s.recordings ?? []).length > 0 || s.done === true);

/** XP of effort: at least one recording or "Fiz a atividade" (never for the ratings or the size). */
export const earnsSpeechXp = (s: Pick<SpeechSession, 'recordings' | 'done'>): boolean =>
  (s.recordings ?? []).length > 0 || s.done === true;

const XP_PREFIX = 'xp-speech-';
export const speechXpId = (id: ID): string => `${XP_PREFIX}${id}`;

/** Another session may earn speech XP today: fewer than SPEECH_DAILY_SESSIONS already did (ids of today's speech XP). */
export function speechXpAllowed(todayIds: readonly string[], sessionId: ID): boolean {
  const ids = new Set(todayIds.filter((x) => x.startsWith(XP_PREFIX)).map((x) => x.slice(XP_PREFIX.length)));
  return ids.has(sessionId) || ids.size < SPEECH_DAILY_SESSIONS;
}

/** The list with the recording added at the end; the same file twice stays once. */
export function withRecording(list: readonly SpeechRecording[], rec: SpeechRecording): SpeechRecording[] {
  return list.some((r) => r.hash === rec.hash) ? [...list] : [...list, rec];
}

/**
 * The recordings of one session seen by two devices (sync): `base` plus the recordings of `other` whose hash `base`
 * lacks. A hash on both sides keeps `base`'s entry (so Guardar follows the version that wins: turning it off on one device
 * is not undone by the other), with `capped` true when either side has it. Ordered by `at` (stable). A recording is never
 * dropped by a merge.
 */
export function unionRecordings(base: readonly SpeechRecording[], other: readonly SpeechRecording[]): SpeechRecording[] {
  const theirs = new Map(other.map((r) => [r.hash, r]));
  const out = base.map((r) => {
    const o = theirs.get(r.hash);
    if (!o) return r;
    return o.capped && !r.capped ? { ...r, capped: true } : r;
  });
  const have = new Set(base.map((r) => r.hash));
  for (const r of other) {
    if (!have.has(r.hash)) { have.add(r.hash); out.push(r); }
  }
  return out.map((r, i) => ({ r, i })).sort((x, y) => x.r.at - y.r.at || x.i - y.i).map(({ r }) => r);
}

/** "Guardar" on or off for one recording (off removes the field). */
export function withKeep(list: readonly SpeechRecording[], hash: string, keep: boolean): SpeechRecording[] {
  return list.map((r) => {
    if (r.hash !== hash) return r;
    const { keep: _old, ...rest } = r;
    return keep ? { ...rest, keep: true } : rest;
  });
}

// ------------------------------------------------------------------ the session sheet (draft and changes)

export interface SpeechPreset {
  kind: SpeechKind;
  size?: SpeechSize;
  exercise?: SpeechExercise;
  simulation?: SpeechSimulation;
  passage?: string;
  topic?: string;
}

export interface SpeechDraft {
  kind?: SpeechKind;
  size?: SpeechSize;
  exercise?: SpeechExercise;
  simulation?: SpeechSimulation;
  passage?: string;
  topic: string;
  ratings: Partial<Record<SpeechRatingKey, SpeechScore>>;
  content?: SpeechContent;
  notes: string;
  done: boolean;
}
export type SpeechField = 'kind' | 'size' | 'exercise' | 'simulation' | 'passage' | 'topic' | 'ratings' | 'content' | 'notes' | 'done';
/** The preset's fields: a suggestion or a bridge tapped by him counts as chosen. */
export const presetFields = (p: SpeechPreset): SpeechField[] =>
  (['kind', 'size', 'exercise', 'simulation', 'passage', 'topic'] as const).filter((k) => p[k] !== undefined && p[k] !== '');

export function newSpeechDraft(preset?: SpeechPreset): SpeechDraft {
  return {
    ...(preset?.kind ? { kind: preset.kind } : {}),
    ...(preset?.size ? { size: preset.size } : {}),
    ...(preset?.exercise ? { exercise: preset.exercise } : {}),
    ...(preset?.simulation ? { simulation: preset.simulation } : {}),
    ...(preset?.passage ? { passage: preset.passage } : {}),
    topic: flat(preset?.topic ?? '').slice(0, SPEECH_TOPIC_MAX),
    ratings: {}, notes: '', done: false,
  };
}

export function speechDraftOf(s: SpeechSession): SpeechDraft {
  return {
    kind: s.kind,
    ...(s.size ? { size: s.size } : {}),
    ...(s.exercise ? { exercise: s.exercise } : {}),
    ...(s.simulation ? { simulation: s.simulation } : {}),
    ...(s.passage ? { passage: s.passage } : {}),
    topic: s.topic ?? '', ratings: { ...(s.ratings ?? {}) }, ...(s.content ? { content: s.content } : {}),
    notes: s.notes ?? '', done: s.done === true,
  };
}

/** What a save writes: only touched fields that differ; ratings key by key (undefined clears a key). */
export interface SpeechSessionPatch {
  kind?: SpeechKind;
  size?: SpeechSize | undefined;
  exercise?: SpeechExercise | undefined;
  simulation?: SpeechSimulation | undefined;
  passage?: string | undefined;
  topic?: string | undefined;
  ratings?: Partial<Record<SpeechRatingKey, SpeechScore | undefined>>;
  content?: SpeechContent | undefined;
  notes?: string | undefined;
  done?: boolean | undefined;
}

const cleanTopic = (t: string): string | undefined => flat(t).slice(0, SPEECH_TOPIC_MAX).trim() || undefined;
const cleanNotes = (t: string): string | undefined => t.trim().slice(0, SPEECH_NOTES_MAX).trim() || undefined;

export function speechChanges(initial: SpeechDraft, draft: SpeechDraft, touched: ReadonlySet<SpeechField>): SpeechSessionPatch {
  const out: SpeechSessionPatch = {};
  for (const k of ['size', 'exercise', 'simulation', 'passage', 'content'] as const) {
    if (touched.has(k) && draft[k] !== initial[k]) (out as Record<string, unknown>)[k] = draft[k];
  }
  if (touched.has('kind') && draft.kind && draft.kind !== initial.kind) out.kind = draft.kind;
  if (touched.has('topic') && cleanTopic(draft.topic) !== cleanTopic(initial.topic)) out.topic = cleanTopic(draft.topic);
  if (touched.has('notes') && cleanNotes(draft.notes) !== cleanNotes(initial.notes)) out.notes = cleanNotes(draft.notes);
  if (touched.has('done') && draft.done !== initial.done) out.done = draft.done || undefined;
  if (touched.has('ratings')) {
    const r: Partial<Record<SpeechRatingKey, SpeechScore | undefined>> = {};
    for (const k of SPEECH_RATING_KEYS) if (draft.ratings[k] !== initial.ratings[k]) r[k] = draft.ratings[k];
    if (Object.keys(r).length > 0) out.ratings = r;
  }
  return out;
}

export const hasSpeechChanges = (p: SpeechSessionPatch): boolean => Object.keys(p).length > 0;

/** The fields a patch writes over the stored session: ratings merged key by key (a cleared key is removed). */
export function mergeSpeechPatch(prev: Pick<SpeechSession, 'ratings'>, p: SpeechSessionPatch): Partial<SpeechSession> {
  const { ratings, ...rest } = p;
  const out: Partial<SpeechSession> = { ...rest } as Partial<SpeechSession>;
  if (ratings) {
    const merged: Partial<Record<SpeechRatingKey, SpeechScore>> = { ...(prev.ratings ?? {}) };
    for (const k of SPEECH_RATING_KEYS) {
      if (!(k in ratings)) continue;
      const v = ratings[k];
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
    out.ratings = merged;
  }
  return out;
}

// ------------------------------------------------------------------ the 12-week program

export interface SpeechActivity {
  size: SpeechSize;
  kind: SpeechKind;
  exercise?: SpeechExercise;
  simulation?: SpeechSimulation;
  passage?: string;
  text: string;
}
export interface SpeechWeek { week: number; phase: SpeechPhase; focus: string; activities: readonly SpeechActivity[] }

export const SPEECH_PHASES: readonly SpeechPhase[] = [1, 2, 3, 4];
export const SPEECH_PHASE_LABEL: Record<SpeechPhase, string> = {
  1: 'Observar e criar referências',
  2: 'Pausas, ritmo, articulação, ênfase e volume confortável',
  3: 'Explicações técnicas e simulações',
  4: 'Situações reais',
};
/** First and last week of each phase. */
export const SPEECH_PHASE_WEEKS: Record<SpeechPhase, readonly [number, number]> = { 1: [1, 2], 2: [3, 5], 3: [6, 8], 4: [9, 12] };

const a = (size: SpeechSize, kind: SpeechKind, text: string, extra: Partial<SpeechActivity> = {}): SpeechActivity =>
  ({ size, kind, ...extra, text });

export const SPEECH_WEEKS: readonly SpeechWeek[] = [
  { week: 1, phase: 1, focus: 'Gravar as primeiras referências, sem tentar mudar nada.', activities: [
    a(5, 'leitura', 'Ler “A feira de sábado” uma vez e ouvir.', { passage: 'feira' }),
    a(15, 'explicacao', 'Explicar em 1 a 2 minutos algo que você fez nesta semana.'),
    a(30, 'leitura', 'Ler os três textos de referência, um por gravação, e anotar o que percebeu.', { passage: 'feira' }),
  ] },
  { week: 2, phase: 1, focus: 'Ouvir com curiosidade: onde aparecem as pausas e onde a fala acelera, sem julgar.', activities: [
    a(5, 'explicacao', 'Explicar algo da rotina em 1 minuto e anotar uma coisa que percebeu ao ouvir.'),
    a(15, 'leitura', 'Ler “A biblioteca” e, depois, explicar em 2 minutos um card de tópico.', { passage: 'biblioteca' }),
    a(30, 'leitura', 'Ler “Uma viagem de trem”, explicar dois temas curtos e ouvir tudo com calma.', { passage: 'trem' }),
  ] },
  { week: 3, phase: 2, focus: 'Pausas: parar no fim de cada ideia, respirar e seguir.', activities: [
    a(5, 'exercicio', 'Ler um parágrafo fazendo uma pausa curta em cada ponto final.', { exercise: 'pausas' }),
    a(15, 'exercicio', 'Explicar um tema em 2 minutos com uma pausa entre as ideias.', { exercise: 'pausas' }),
    a(30, 'exercicio', 'Gravar duas versões de uma explicação, com e sem pausas marcadas, e ouvir as duas.', { exercise: 'pausas' }),
  ] },
  { week: 4, phase: 2, focus: 'Ritmo: variar a velocidade de propósito (mais lenta, mais rápida) e ouvir o que fica mais claro.', activities: [
    a(5, 'exercicio', 'Ler um parágrafo duas vezes, em ritmos diferentes, e ouvir qual ficou mais confortável.', { exercise: 'ritmo' }),
    a(15, 'exercicio', 'Explicar um tema destacando com calma as duas frases principais.', { exercise: 'ritmo' }),
    a(30, 'exercicio', 'Ler um texto de referência e explicar um tema técnico, cuidando do ritmo nos dois.', { exercise: 'ritmo' }),
  ] },
  { week: 5, phase: 2, focus: 'Articulação e ênfase num volume confortável: palavras inteiras e a palavra principal em destaque, sem forçar a voz.', activities: [
    a(5, 'exercicio', 'Ler uma frase longa abrindo bem as palavras, em ritmo e volume confortáveis.', { exercise: 'articulacao' }),
    a(15, 'exercicio', 'Explicar um tema destacando a palavra principal de cada frase.', { exercise: 'enfase' }),
    a(30, 'leitura', 'Ler “A feira de sábado” de novo e ouvir ao lado da primeira leitura.', { passage: 'feira' }),
  ] },
  { week: 6, phase: 3, focus: 'Explicar um conceito técnico em 2 minutos, com começo, meio e fim.', activities: [
    a(5, 'explicacao', 'Explicar em 1 minuto um conceito técnico (um JOIN, um índice).'),
    a(15, 'explicacao', 'Explicar em 2 minutos um card de tópico, sem olhar, e conferir o conteúdo depois.'),
    a(30, 'explicacao', 'Explicar duas vezes o mesmo conceito, a segunda já com o que percebeu na primeira.'),
  ] },
  { week: 7, phase: 3, focus: 'Responder a uma pergunta de entrevista em até 2 minutos.', activities: [
    a(5, 'simulacao', 'Responder em voz alta: “Fale sobre você”.', { simulation: 'entrevista' }),
    a(15, 'simulacao', 'Responder a duas perguntas técnicas de entrevista, uma gravação cada.', { simulation: 'entrevista' }),
    a(30, 'simulacao', 'Simular uma entrevista curta com três perguntas e ouvir as respostas.', { simulation: 'entrevista' }),
  ] },
  { week: 8, phase: 3, focus: 'Apresentar um projeto em 2 a 3 minutos, como o Tech News.', activities: [
    a(5, 'simulacao', 'Fazer uma pergunta em voz alta, como faria em aula.', { simulation: 'pergunta' }),
    a(15, 'simulacao', 'Apresentar um projeto em 2 a 3 minutos.', { simulation: 'apresentacao' }),
    a(30, 'simulacao', 'Apresentar um projeto, ouvir e apresentar de novo.', { simulation: 'apresentacao' }),
  ] },
  { week: 9, phase: 4, focus: 'Numa situação real da semana, usar uma pausa a mais. Registrar como foi.', activities: [
    a(5, 'exercicio', 'Antes da aula, ler um parágrafo com pausas, num volume confortável.', { exercise: 'pausas' }),
    a(15, 'explicacao', 'Ensaiar em voz alta o que quer dizer numa conversa desta semana.'),
    a(30, 'leitura', 'Ler “A biblioteca” e ouvir ao lado da leitura da semana 2.', { passage: 'biblioteca' }),
  ] },
  { week: 10, phase: 4, focus: 'Fazer uma pergunta ou um comentário em aula. Registrar a situação.', activities: [
    a(5, 'simulacao', 'Ensaiar em voz alta a pergunta que quer fazer.', { simulation: 'pergunta' }),
    a(15, 'explicacao', 'Explicar em 2 minutos o assunto da aula de hoje.'),
    a(30, 'simulacao', 'Ensaiar uma apresentação curta da faculdade ou do Tech News.', { simulation: 'apresentacao' }),
  ] },
  { week: 11, phase: 4, focus: 'Explicar algo a alguém de verdade, um colega ou um amigo. Registrar.', activities: [
    a(5, 'explicacao', 'Explicar em 1 minuto o que vai contar para a pessoa.'),
    a(15, 'simulacao', 'Responder a uma pergunta de entrevista, com calma.', { simulation: 'entrevista' }),
    a(30, 'explicacao', 'Explicar um conceito técnico em 2 minutos e conferir o conteúdo.'),
  ] },
  { week: 12, phase: 4, focus: 'Rever: ler de novo, ouvir ao lado da semana 1 e pensar no que mudou nas situações reais.', activities: [
    a(5, 'leitura', 'Ler “A feira de sábado” e ouvir ao lado da primeira gravação.', { passage: 'feira' }),
    a(15, 'leitura', 'Ler “Uma viagem de trem” e ouvir ao lado da primeira leitura desse texto.', { passage: 'trem' }),
    a(30, 'explicacao', 'Explicar o mesmo tema da semana 1 e comparar as duas gravações.'),
  ] },
];

/** Without a program (or after it): one activity per size, all optional. */
export const SPEECH_FREE_ACTIVITIES: readonly SpeechActivity[] = [
  a(5, 'leitura', 'Ler um texto de referência e ouvir.', { passage: 'feira' }),
  a(15, 'explicacao', 'Explicar em 2 minutos algo que você estudou.'),
  a(30, 'exercicio', 'Pausas: explicar um tema com uma pausa entre as ideias, gravar duas vezes e ouvir.', { exercise: 'pausas' }),
];

export const clampWeek = (n: number): number =>
  (Number.isInteger(n) ? Math.min(SPEECH_PROGRAM_WEEKS, Math.max(1, n)) : 1);
export const speechWeek = (n: number): SpeechWeek => SPEECH_WEEKS[clampWeek(n) - 1]!;
export const phaseOfWeek = (n: number): SpeechPhase => speechWeek(n).phase;
/** The last week of a phase: the program card asks what changed in real situations (optional). */
export const isPhaseEnd = (n: number): boolean => SPEECH_PHASES.some((p) => SPEECH_PHASE_WEEKS[p][1] === clampWeek(n));

/** The active program: one at a time; if the sync brought two, the latest start (then the newest created). */
export function activeProgram(list: readonly SpeechProgram[]): SpeechProgram | undefined {
  return list
    .filter((p) => !p.deleted && p.status === 'ativo')
    .sort((x, y) => cmp(y.startDay, x.startDay) || y.createdAt - x.createdAt)[0];
}

/** "Semana 3 de 12 · Fase 2: Pausas, ritmo, articulação, ênfase e volume confortável". */
export function programLine(p: Pick<SpeechProgram, 'week'>): string {
  const w = clampWeek(p.week);
  const phase = phaseOfWeek(w);
  return `Semana ${w} de ${SPEECH_PROGRAM_WEEKS} · Fase ${phase}: ${SPEECH_PHASE_LABEL[phase]}`;
}

/** Today's suggestions in Fala: the program week's focus and activities, else the free ones (no focus line). */
export function speechSuggestions(program: Pick<SpeechProgram, 'week'> | undefined): { focus?: string; activities: readonly SpeechActivity[] } {
  if (!program) return { activities: SPEECH_FREE_ACTIVITIES };
  const w = speechWeek(program.week);
  return { focus: w.focus, activities: w.activities };
}

export const presetOf = (x: SpeechActivity): SpeechPreset => ({
  kind: x.kind, size: x.size,
  ...(x.exercise ? { exercise: x.exercise } : {}),
  ...(x.simulation ? { simulation: x.simulation } : {}),
  ...(x.passage ? { passage: x.passage } : {}),
});

// ------------------------------------------------------------------ recordings: list, comparison, retention

export interface SpeechRecordingItem {
  key: string;              // `${sessionId}:${hash}`
  sessionId: ID;
  hash: string;
  day: DayKey;
  at: number;
  durationMs: number;
  kind: SpeechKind;
  passage?: string;
  title: string;            // speechSessionTitle
  wpm?: number;             // reference readings only
  ratings: Partial<Record<SpeechRatingKey, SpeechScore>>;
  reference: boolean;       // a reference reading: always kept
  keep: boolean;
}

/** Every recording of the live sessions, oldest first. */
export function speechRecordings(sessions: readonly SpeechSession[]): SpeechRecordingItem[] {
  const out: SpeechRecordingItem[] = [];
  for (const raw of sessions) {
    if (raw.deleted) continue;
    const s = normalizeSpeechSession(raw);
    for (const r of s.recordings) {
      const wpm = sessionWpm(s, r);
      out.push({
        key: `${s.id}:${r.hash}`, sessionId: s.id, hash: r.hash, day: s.day, at: r.at, durationMs: r.durationMs, kind: s.kind,
        ...(s.passage && s.kind === 'leitura' ? { passage: s.passage } : {}),
        title: speechSessionTitle(s), ...(wpm !== undefined ? { wpm } : {}), ratings: s.ratings,
        reference: s.kind === 'leitura', keep: r.keep === true,
      });
    }
  }
  return out.sort((x, y) => x.at - y.at || cmp(x.key, y.key));
}

/** "10/11 · Leitura de referência · A feira de sábado · 1:05". */
export const recordingLabel = (r: Pick<SpeechRecordingItem, 'day' | 'title' | 'durationMs'>): string =>
  `${ddmm(r.day)} · ${r.title} · ${speechClock(r.durationMs)}`;

/**
 * The two recordings "Comparar gravações" opens with: the first and the latest reading of the passage read most
 * recently, when it was read twice or more; else the oldest and the newest recording; nothing with fewer than two.
 */
export function compareDefaults(items: readonly SpeechRecordingItem[]): { a?: string; b?: string } {
  if (items.length < 2) return {};
  const readings = items.filter((r) => r.reference && r.passage);
  const last = readings[readings.length - 1];
  if (last) {
    const same = readings.filter((r) => r.passage === last.passage);
    if (same.length >= 2) return { a: same[0]!.key, b: same[same.length - 1]!.key };
  }
  return { a: items[0]!.key, b: items[items.length - 1]!.key };
}

export interface RetentionItem { hash: string; sessionId: ID; day: DayKey; title: string; durationMs: number }

/**
 * Recordings that MAY leave this device (the web side still checks that each one is here and already reached the
 * server, and that no card uses it): not a reference reading, not "Guardar", from a session 30 days old or more. A
 * file that some kept, reference or recent recording also uses is never offered. Oldest first, one per file.
 */
export function retentionCandidates(sessions: readonly SpeechSession[], today: DayKey): RetentionItem[] {
  const blocked = new Set<string>();
  const offered: RetentionItem[] = [];
  const live = sessions.filter((s) => !s.deleted).map(normalizeSpeechSession)
    .sort((x, y) => cmp(x.day, y.day) || x.createdAt - y.createdAt);
  for (const s of live) {
    const old = diffDays(s.day, today) >= SPEECH_KEEP_DAYS;
    for (const r of s.recordings) {
      if (s.kind === 'leitura' || r.keep || !old) blocked.add(r.hash);
      else offered.push({ hash: r.hash, sessionId: s.id, day: s.day, title: speechSessionTitle(s), durationMs: r.durationMs });
    }
  }
  const seen = new Set<string>();
  return offered.filter((x) => {
    if (blocked.has(x.hash) || seen.has(x.hash)) return false;
    seen.add(x.hash);
    return true;
  });
}
