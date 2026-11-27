import type { Blocker, BlockOutcome, ID, LifeEvent, SnoozeReason } from './types';

// Fechar a atividade (Acompanhamento B): outcome of a block, "O que saiu?", reasons to postpone and
// "O que trava?" with a first action for each answer. Everything optional; nothing here gives XP.

/** "O que saiu?" and "Próxima ação": one line each. */
export const RESULT_MAX = 140;

/** One line: inner whitespace collapsed, trimmed, cut at `max`; blank → undefined. */
export function oneLine(text: string | undefined, max = RESULT_MAX): string | undefined {
  const t = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return t === '' ? undefined : t;
}

export const BLOCK_OUTCOMES: readonly BlockOutcome[] = ['feito', 'parcial', 'investiguei', 'nao-deu'];
export const BLOCK_OUTCOME_LABEL: Record<BlockOutcome, string> = {
  feito: 'Feito', parcial: 'Parcial', investiguei: 'Investiguei', 'nao-deu': 'Não deu',
};
/** What "Investiguei" means, under its chip (block close and Parcial): research is work, never a postponement. */
export const INVESTIGATED_HINT = 'Pesquisa ou exploração, sem entrega ainda: conta como trabalho, não como adiamento.';
/** A "Parcial" marked "Investiguei" (`data.investigated: true` on the 'partial' event). */
export const investigatedPartial = (e: Pick<LifeEvent, 'data'>): boolean => e.data?.investigated === true;

export const SNOOZE_REASONS: readonly SnoozeReason[] = ['sem-tempo', 'sem-energia', 'nao-sei-comecar', 'falta-algo', 'outra-prioridade'];
export const SNOOZE_REASON_LABEL: Record<SnoozeReason, string> = {
  'sem-tempo': 'Sem tempo',
  'sem-energia': 'Sem energia',
  'nao-sei-comecar': 'Não sei por onde começar',
  'falta-algo': 'Falta algo',
  'outra-prioridade': 'Outra prioridade',
};
export const isSnoozeReason = (v: unknown): v is SnoozeReason =>
  typeof v === 'string' && (SNOOZE_REASONS as readonly string[]).includes(v);

/** What a "O que trava?" answer offers: a first step to save, Encolher, or the 10-minute experiment. */
export interface BlockerOption { key: Blocker; label: string; offer: 'step' | 'shrink' | 'experiment'; step?: string }
export const BLOCKERS: readonly BlockerOption[] = [
  { key: 'nao-sei-comecar', label: 'Não sei por onde começar', offer: 'step', step: 'Escrever os 3 primeiros passos, sem fazer' },
  { key: 'falta-informacao', label: 'Falta informação', offer: 'step', step: 'Anotar a dúvida e onde encontrar a resposta' },
  { key: 'grande-demais', label: 'É grande demais', offer: 'shrink' },
  { key: 'medo-de-errar', label: 'Medo de errar', offer: 'step', step: 'Fazer uma versão ruim de propósito por 10 min' },
  { key: 'chato', label: 'Chato / sem vontade', offer: 'experiment' },
];
export const blockerOption = (key: Blocker): BlockerOption => BLOCKERS.find((b) => b.key === key)!;

export interface MissionResult { kind: 'partial' | 'result'; result: string; at: number }

/**
 * The current "O que saiu?" of a mission: the newest live event of the given kinds ('result' after a
 * conclusion, 'partial' after "Parcial") that carries `data.result`. Events are append-only, so a newer
 * one supersedes an older one; a newer blank result clears it (undefined).
 */
export function latestResult(
  events: readonly LifeEvent[], missionId: ID, kinds: ReadonlyArray<'partial' | 'result'> = ['result'],
): MissionResult | undefined {
  let newest: LifeEvent | undefined;
  for (const e of events) {
    if (e.deleted || e.missionId !== missionId || !(kinds as readonly string[]).includes(e.type)) continue;
    if (typeof e.data?.result !== 'string') continue;
    if (!newest || e.at > newest.at) newest = e;
  }
  const result = (newest?.data?.result as string | undefined)?.trim();
  return newest && result ? { kind: newest.type as 'partial' | 'result', result, at: newest.at } : undefined;
}
