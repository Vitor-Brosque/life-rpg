import type { DayKey, SpeechProgram, SpeechRatingKey, SpeechScore, SpeechSession, SpeechSituation } from './types';
import {
  SITUATION_CONTEXTS, SITUATION_CONTEXT_LABEL, SITUATION_REPEATS, SITUATION_REPEATS_TEXT, SPEECH_CONTENTS, SPEECH_CONTENT_LABEL,
  SPEECH_EXERCISES, SPEECH_EXERCISE_LABEL, SPEECH_KINDS, SPEECH_KIND_LABEL, SPEECH_PHASES, SPEECH_PROGRAM_WEEKS,
  SPEECH_RATING_KEYS, SPEECH_RATING_LABEL, SPEECH_READINGS, SPEECH_SIMULATIONS, SPEECH_SIMULATION_LABEL, SPEECH_SIZES,
  SPEECH_SIZE_LABEL, activeProgram, clampWeek, normalizeSpeechSession, readingOf, sessionWpm, speechClock, speechCounted,
} from './speech';
import {
  SPEECH_NONE, reportCount, reportDay, reportDecimal, reportEmpty, reportList, reportQuote, reportSaid, type ReportBlock,
} from './report';

// Comunicação oral in the reports (2026-11-23): the "Prática de fala" section. Facts are taps and durations; the speed
// appears only for reference readings and is labelled as observation, not a target; self-assessments, the content
// check and his notes are perceptions; recordings appear as a list with dates, never as audio or text.

export interface SpeechReportInput {
  sessions: readonly SpeechSession[];
  situations: readonly SpeechSituation[];
  programs: readonly SpeechProgram[];
  range: { start: DayKey; end: DayKey };
}

export const SPEECH_WPM_NOTE = 'A duração vai do toque em Gravar ao toque em Parar. A velocidade é observação, não meta: '
  + 'mais devagar não é automaticamente melhor.';
export const SPEECH_REPEATS_NOTE = 'Pedidos de repetição dependem também do ambiente e de quem ouve: acompanham a transferência '
  + 'para situações reais, não medem a fala.';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** "Leitura de referência 1 · Explicação espontânea 2": each value with records, in the given order (never a zero). */
function counts<K extends string | number>(order: readonly K[], label: Record<K, string>, values: readonly K[]): string {
  return order.flatMap((k) => {
    const n = values.filter((v) => v === k).length;
    return n > 0 ? [`${label[k]} ${n}`] : [];
  }).join(' · ');
}

/** "Clareza percebida 3,5 (2 sessões) · Conforto vocal 4,0 (1 sessão)": means of the keys with values. */
function means(
  rows: ReadonlyArray<Partial<Record<string, SpeechScore>>>, keys: ReadonlyArray<{ key: string; label: string }>, one: string, many: string,
): string {
  return keys.flatMap(({ key, label }) => {
    const vs = rows.flatMap((r) => (r[key] !== undefined ? [r[key]!] : []));
    if (vs.length === 0) return [];
    return [`${label} ${reportDecimal(vs.reduce((s, v) => s + v, 0) / vs.length)} (${reportCount(vs.length, one, many)})`];
  }).join(' · ');
}

/** `Leitura de referência "A feira de sábado"`, `Explicação espontânea "explicar um JOIN"`, `Exercício (Pausas)`. */
function reportTitle(s: SpeechSession): string {
  const kind = SPEECH_KIND_LABEL[s.kind];
  if (s.kind === 'leitura') {
    const r = readingOf(s.passage);
    return r ? `${kind} ${reportQuote(r.title)}` : kind;
  }
  const detail = s.kind === 'exercicio' && s.exercise ? SPEECH_EXERCISE_LABEL[s.exercise]
    : s.kind === 'simulacao' && s.simulation ? SPEECH_SIMULATION_LABEL[s.simulation] : undefined;
  const topic = (s.topic ?? '').trim();
  return `${kind}${detail ? ` (${detail})` : ''}${topic ? ` ${reportQuote(topic)}` : ''}`;
}

const RATING_KEYS = SPEECH_RATING_KEYS.map((key: SpeechRatingKey) => ({ key, label: SPEECH_RATING_LABEL[key] }));
const SITUATION_KEYS = [{ key: 'clarity', label: 'Clareza' }, { key: 'comfort', label: 'Conforto' }];

/** The "Prática de fala" block of a report of `range` (already cut at today). */
export function speechReportBlock(p: SpeechReportInput): ReportBlock {
  const inRange = (d: DayKey): boolean => d >= p.range.start && d <= p.range.end;
  const sessions = p.sessions.filter((s) => speechCounted(s) && inRange(s.day)).map(normalizeSpeechSession)
    .sort((a, b) => cmp(a.day, b.day) || a.createdAt - b.createdAt);
  const situations = p.situations.filter((x) => !x.deleted && inRange(x.day)).sort((a, b) => a.at - b.at || cmp(a.id, b.id));
  const programs = p.programs.filter((x) => !x.deleted);
  const phaseNotes = programs
    .flatMap((prog) => SPEECH_PHASES.flatMap((ph) => {
      const n = prog.phaseNotes?.[ph];
      return n && n.text.trim() !== '' && inRange(n.day) ? [{ phase: ph, ...n }] : [];
    }))
    .sort((a, b) => a.answeredAt - b.answeredAt);
  if (sessions.length === 0 && situations.length === 0 && phaseNotes.length === 0) return reportEmpty(SPEECH_NONE);

  const facts: string[] = [];
  const mine: string[] = [];
  const missing: string[] = [];
  const ideas: string[] = [];

  const active = activeProgram(programs);
  const ended = programs.filter((x) => x.status === 'encerrado' && x.endedDay !== undefined && inRange(x.endedDay))
    .sort((a, b) => cmp(b.endedDay!, a.endedDay!))[0];
  if (active && active.startDay <= p.range.end) {
    facts.push(`Programa de fala desde ${reportDay(active.startDay)}; hoje na semana ${clampWeek(active.week)} de ${SPEECH_PROGRAM_WEEKS} `
      + '(a semana é escolhida por mim).');
  } else if (ended) {
    facts.push(`Programa de fala de ${reportDay(ended.startDay)} a ${reportDay(ended.endedDay!)}.`);
  }

  if (sessions.length === 0) missing.push('Nenhuma sessão de fala neste período.');
  else {
    facts.push(`Sessões de fala: ${sessions.length} — ${counts(SPEECH_KINDS, SPEECH_KIND_LABEL, sessions.map((s) => s.kind))}.`);
    const sizes = sessions.flatMap((s) => (s.size ? [s.size] : []));
    if (sizes.length > 0) facts.push(`Tamanho escolhido: ${counts(SPEECH_SIZES, SPEECH_SIZE_LABEL, sizes)}.`);
    const exercises = sessions.flatMap((s) => (s.kind === 'exercicio' && s.exercise ? [s.exercise] : []));
    if (exercises.length > 0) facts.push(`Exercícios: ${counts(SPEECH_EXERCISES, SPEECH_EXERCISE_LABEL, exercises)}.`);
    const sims = sessions.flatMap((s) => (s.kind === 'simulacao' && s.simulation ? [s.simulation] : []));
    if (sims.length > 0) facts.push(`Simulações: ${counts(SPEECH_SIMULATIONS, SPEECH_SIMULATION_LABEL, sims)}.`);
    const recs = sessions.flatMap((s) => [...s.recordings].sort((x, y) => x.at - y.at)
      .map((r) => `${reportDay(s.day)} ${reportTitle(s)} (${speechClock(r.durationMs)})`));
    if (recs.length > 0) facts.push(`Gravações (só a lista; o áudio fica no app): ${reportList(recs)}.`);

    let noSpeed = 0;
    for (const reading of SPEECH_READINGS) {
      const points: string[] = [];
      for (const s of sessions) {
        if (s.kind !== 'leitura' || s.passage !== reading.id) continue;
        for (const r of [...s.recordings].sort((x, y) => x.at - y.at)) {
          const wpm = sessionWpm(s, r);
          if (wpm === undefined) noSpeed += 1;
          else points.push(`${reportDay(s.day)} ${wpm}`);
        }
      }
      if (points.length > 0) {
        facts.push(`Velocidade na leitura de referência ${reportQuote(reading.title)} (palavras do texto ÷ duração da gravação): `
          + `${reportList(points)} palavras por minuto.`);
      }
    }
    if (facts.some((f) => f.startsWith('Velocidade na leitura'))) facts.push(SPEECH_WPM_NOTE);
    if (noSpeed > 0) {
      missing.push(`Leitura de referência sem velocidade em ${reportCount(noSpeed, 'gravação', 'gravações')} `
        + '(menos de 10 segundos ou parada no limite de 3 minutos).');
    }

    const rated = means(sessions.map((s) => s.ratings), RATING_KEYS, 'sessão', 'sessões');
    if (rated) mine.push(`Autoavaliação nas sessões (percepção, 1 a 5: quanto ficou como eu queria): ${rated}.`);
    const contents = sessions.flatMap((s) => (s.content ? [s.content] : []));
    if (contents.length > 0) {
      mine.push(`"Consegui explicar?" (conteúdo, separado da fala): ${counts(SPEECH_CONTENTS, SPEECH_CONTENT_LABEL, contents)}.`);
    }
    for (const s of sessions) {
      if ((s.notes ?? '').trim() !== '') mine.push(reportSaid(`Nota da sessão de ${reportDay(s.day)} (${reportTitle(s)})`, s.notes!));
    }
  }

  if (situations.length === 0) missing.push('Nenhuma situação real registrada neste período.');
  else {
    facts.push(`Situações reais registradas: ${situations.length} — `
      + `${counts(SITUATION_CONTEXTS, SITUATION_CONTEXT_LABEL, situations.map((x) => x.context))}.`);
    const answered = situations.flatMap((x) => (x.repeats !== undefined ? [x.repeats] : []));
    if (answered.length > 0) {
      const parts = SITUATION_REPEATS.flatMap((k) => {
        const n = answered.filter((v) => v === k).length;
        return n > 0 ? [`${SITUATION_REPEATS_TEXT[k]} em ${reportCount(n, 'situação', 'situações')}`] : [];
      });
      facts.push(`Pediram para repetir: ${parts.join(' · ')}.`);
      ideas.push(SPEECH_REPEATS_NOTE);
    }
    const unanswered = situations.length - answered.length;
    if (unanswered > 0) missing.push(`"Pediram para repetir?" sem resposta em ${reportCount(unanswered, 'situação', 'situações')}.`);
    const felt = means(situations.map((x) => ({ clarity: x.clarity, comfort: x.comfort })), SITUATION_KEYS, 'situação', 'situações');
    if (felt) mine.push(`Nas situações reais (percepção, 1 a 5): ${felt}.`);
    for (const x of situations) {
      if ((x.note ?? '').trim() !== '') {
        mine.push(reportSaid(`Situação real de ${reportDay(x.day)} (${SITUATION_CONTEXT_LABEL[x.context]})`, x.note!));
      }
    }
  }

  for (const n of phaseNotes) mine.push(reportSaid(`O que mudou nas situações reais, no fim da fase ${n.phase} (${reportDay(n.day)})`, n.text));
  return { facts, mine, missing, ideas };
}
