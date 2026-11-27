// Agora (2026-11-23): at most one "moment" card at a time above the current block, so the main action stays in reach.
// The others wait behind "Mais para hoje (N)". Rules only: which cards are due is decided by each card's own rule.

/** The moment cards that exist in the Agora (and the Painel's Agora column), by priority. */
export type MomentKind = 'fechamento' | 'tipo' | 'semana' | 'mes' | 'revisao';
export const MOMENT_ORDER: readonly MomentKind[] = ['fechamento', 'tipo', 'semana', 'mes', 'revisao'];

/** Each card's name in the "Mais para hoje" sheet ('mes' is shown with the month's name: "Reflexão de outubro"). */
export const MOMENT_TITLE: Record<MomentKind, string> = {
  fechamento: 'Como foi hoje?', tipo: 'Como está hoje?', semana: 'Nova semana', mes: 'Reflexão do mês', revisao: 'Revisão rápida',
};
export const MOMENT_HINT: Record<MomentKind, string> = {
  fechamento: 'Fechar o dia em dois minutos. Tudo opcional.',
  tipo: 'Escolher o tipo do dia.',
  semana: 'Olhar a semana passada e mirar esta.',
  mes: 'Três perguntas sobre o mês que passou.',
  revisao: 'Decidir o que fazer com o que ficou de outros dias.',
};

export interface MomentPick {
  /** The card on screen: the one he brought up (while it is still due), else the first due by priority. */
  shown?: MomentKind;
  /** The other due cards, by priority: "Mais para hoje (N)". */
  more: MomentKind[];
}

export function pickMoment(due: readonly MomentKind[], chosen?: MomentKind): MomentPick {
  const list = MOMENT_ORDER.filter((k) => due.includes(k));
  const shown = chosen !== undefined && list.includes(chosen) ? chosen : list[0];
  return { ...(shown !== undefined ? { shown } : {}), more: list.filter((k) => k !== shown) };
}
