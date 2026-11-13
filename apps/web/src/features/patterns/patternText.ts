import type {
  Bucket, MethodAssociation, MonthKey, MonthObserved, PeriodKind, PostponeObserved, SleepBlocksAssociation,
  SleepModeAssociation, TrendPoint, WatchNotice,
} from '@life/shared';
import { ACCURACY_MIN, METHOD_LABEL, monthName } from '@life/shared';
import { formatDuration, plural } from '../../ui/format';

// Every sentence of the Padrões screen (spec §5), built from the numbers of @life/shared.

export const pct = (x: number): string => `${Math.round(x * 100)}%`;
/** 2.05 → "2,1" (one decimal, comma). */
export const decimal = (x: number): string => x.toFixed(1).replace('.', ',');

export interface Span { window: string; last: string; each: string }

/** The phrases for `n` periods: "nas últimas 8 semanas" / "na última semana" / "nos últimos 6 meses". */
export function span(kind: PeriodKind, n: number): Span {
  return kind === 'week'
    ? { window: n === 1 ? 'na última semana' : `nas últimas ${n} semanas`, last: 'Na semana mais recente', each: 'Por semana' }
    : { window: n === 1 ? 'no último mês' : `nos últimos ${n} meses`, last: 'No mês mais recente', each: 'Por mês' };
}

const sum = (points: readonly TrendPoint[], f: (p: TrendPoint) => number): number => points.reduce((s, p) => s + f(p), 0);
const lastOf = (points: readonly TrendPoint[]): TrendPoint => points[points.length - 1]!;

/** Callers pass at least one point. */
export function blocksText(points: readonly TrendPoint[], kind: PeriodKind): string {
  const s = span(kind, points.length);
  const planned = sum(points, (p) => p.blocksPlanned);
  if (planned === 0) return `Nenhum bloco planejado ${s.window}.`;
  const last = lastOf(points);
  return `${sum(points, (p) => p.blocksStarted)} de ${planned} blocos iniciados ${s.window}; `
    + `versão mínima em ${sum(points, (p) => p.minimumUsed)}. ${s.last}: ${last.blocksStarted} de ${last.blocksPlanned}.`;
}

export function resumptionsText(points: readonly TrendPoint[], kind: PeriodKind): string {
  const s = span(kind, points.length);
  const n = sum(points, (p) => p.resumptions);
  return n === 0 ? `Nenhuma retomada ${s.window}.` : `${plural(n, 'retomada', 'retomadas')} depois de dias parados ${s.window}.`;
}

export function reviewsText(points: readonly TrendPoint[], kind: PeriodKind): string {
  const s = span(kind, points.length);
  const n = sum(points, (p) => p.reviews);
  if (n === 0) return `Nenhuma revisão ${s.window}.`;
  const learned = sum(points, (p) => p.learnedReviews);
  const accuracy = learned >= ACCURACY_MIN
    ? `; acerto de ${pct(sum(points, (p) => p.learnedCorrect) / learned)} nos cards já aprendidos` : '';
  return `${plural(n, 'revisão', 'revisões')} ${s.window}${accuracy}. ${s.last}: ${lastOf(points).reviews}.`;
}

export function practiceText(points: readonly TrendPoint[], kind: PeriodKind): string {
  const s = span(kind, points.length);
  const n = sum(points, (p) => p.practiceClosed);
  if (n === 0) return `Nenhuma sessão de prática encerrada ${s.window}.`;
  const top = (k: keyof TrendPoint['practiceTop']): number => sum(points, (p) => p.practiceTop[k]);
  return `${plural(n, 'sessão encerrada', 'sessões encerradas')} ${s.window}. `
    + `Nível máximo: entregue em ${top('delivered')}, compreendido em ${top('understood')}, autônomo em ${top('autonomous')}.`;
}

/** The most recent period with a sleep average. */
export function sleepText(points: readonly TrendPoint[], kind: PeriodKind): string {
  const p = [...points].reverse().find((x) => x.sleepAvgMin !== undefined);
  if (!p) return 'Registre algumas noites (Deitei e Acordei) para ver a tendência do sono.';
  const when = kind === 'week' ? `Na semana de ${p.period.label}` : `Em ${monthName(p.period.key)}`;
  return `${when}: duração média de ${formatDuration(p.sleepAvgMin!)} em ${p.sleepNights} noites; `
    + `o horário de deitar variou ±${formatDuration(p.bedSpreadMin!)}.`;
}

export function workoutsText(points: readonly TrendPoint[], kind: PeriodKind): string {
  const s = span(kind, points.length);
  const n = sum(points, (p) => p.workouts);
  if (n === 0) return `Nenhum treino registrado ${s.window}.`;
  return `${plural(n, 'treino', 'treinos')} ${s.window}, ${formatDuration(sum(points, (p) => p.workoutMinutes))} no total; `
    + `${sum(points, (p) => p.cardio)} de cardio.`;
}

export function checkinsText(points: readonly TrendPoint[], kind: PeriodKind): string {
  const s = span(kind, points.length);
  const starts = sum(points, (p) => p.startCheckins);
  const escapes = sum(points, (p) => p.escapes);
  if (starts + escapes === 0) return `Nenhum card de início nem “Escapei” ${s.window}.`;
  return `${plural(starts, 'card de início', 'cards de início')} e ${escapes === 1 ? '1 vez' : `${escapes} vezes`} “Escapei” ${s.window}.`;
}

export function balanceText(kind: PeriodKind, n: number, hasXp: boolean): string {
  const s = span(kind, n);
  return hasXp
    ? `Esforço registrado (XP) por área ${s.window}. XP mede esforço registrado, não valor nem tempo.`
    : `Nenhum XP registrado ${s.window}.`;
}

/** Screen-reader list: "Por semana, da mais antiga para a mais recente: 26/10: 3 de 5; 02/11: 2 de 4." */
export function seriesText(points: readonly TrendPoint[], kind: PeriodKind, value: (p: TrendPoint) => string): string {
  return `${span(kind, points.length).each}, da mais antiga para a mais recente: `
    + `${points.map((p) => `${p.period.label}: ${value(p)}${p.atypical ? (kind === 'week' ? ' (semana atípica)' : ' (mês com semana atípica)') : ''}`).join('; ')}.`;
}

// ------------------------------------------------------------------ weeks 5–8

export const WATCH_CONTEXT = 'Muitas rotinas novas rendem mais no começo e ficam mais difíceis depois de 1 ou 2 meses. '
  + 'Não é falha, e pode ser só variação: é um bom momento para ajustar, sem cobrança.';
export const WATCH_CONTEXT_SHORT = 'Comum depois de 1 ou 2 meses; não é falha.';

export function watchObservedText(n: WatchNotice): string {
  const r = n.recent;
  const recent = `${r.weeks === 1 ? 'Na última semana' : 'Nas últimas 2 semanas'}, ${r.started} de ${r.planned} (${pct(r.started / r.planned)}).`;
  return `Nas 4 primeiras semanas, você começou ${n.base.started} de ${n.base.planned} (${pct(n.base.started / n.base.planned)}). ${recent}`;
}

export const watchExperiment = (n: WatchNotice): string =>
  `Nesta semana, a meta de ${n.name} é só a versão mínima (${formatDuration(n.minimumMin)}).`;

// ------------------------------------------------------------------ associations

export const NOT_VARIED = 'As noites registradas ainda variam pouco para comparar.';

export function sleepBlocksLines(a: SleepBlocksAssociation): string[] {
  if (!a.enough) {
    return [a.reason === 'variacao' ? NOT_VARIED : `Aparece com 14 dias úteis que tenham a noite anterior registrada. Até agora: ${a.pairs}.`];
  }
  const t = formatDuration(a.thresholdMin!);
  const s = a.shorter!;
  const l = a.longer!;
  return [
    `Depois das noites mais curtas (até ${t}, ${s.days} dias): ${decimal(s.started)} de ${decimal(s.planned)} blocos iniciados, em média.`,
    `Depois das noites mais longas (mais de ${t}, ${l.days} dias): ${decimal(l.started)} de ${decimal(l.planned)}.`,
  ];
}

export function sleepModeLines(a: SleepModeAssociation): string[] {
  if (!a.enough) {
    return [a.reason === 'variacao' ? NOT_VARIED
      : `Aparece com 14 dias em que você escolheu o tipo do dia e registrou a noite anterior. Até agora: ${a.pairs}.`];
  }
  const t = formatDuration(a.thresholdMin!);
  const s = a.shorter!;
  const l = a.longer!;
  return [
    `Depois das noites mais curtas (até ${t}, ${s.days} dias): Baixa energia ou Recuperação em ${s.lowDays} de ${s.days}.`,
    `Depois das noites mais longas (mais de ${t}, ${l.days} dias): em ${l.lowDays} de ${l.days}.`,
  ];
}

export function methodLines(m: MethodAssociation): string[] {
  if (!m.enough) {
    const n = (k: string): number => m.all.find((r) => r.method === k)?.reviews ?? 0;
    return [`Aparece com 30 revisões de cards já aprendidos em “Só pensou” e em pelo menos um outro jeito. `
      + `Até agora: só pensou ${n('none')}, escreveu ${n('wrote')}, desenhou ${n('drew')}, falou ${n('spoke')}.`];
  }
  return m.rows.map((r) => `${METHOD_LABEL[r.method]}: ${pct(r.correct / r.reviews)} de acerto em ${r.reviews} revisões.`);
}

// ------------------------------------------------------------------ postponements

export function postponeTotalsText(o: PostponeObserved): string {
  if (o.postponed + o.started + o.shrunk + o.dropped === 0) return 'Nenhum adiamento nem começo de missão nas últimas 4 semanas.';
  return `Nas últimas 4 semanas: adiou ${o.postponed === 1 ? '1 vez' : `${o.postponed} vezes`}, `
    + `começou ${o.started}, encolheu ${o.shrunk} e soltou ${o.dropped}.`;
}

export const atypicalWeeksText = (n: number): string => `${n} ${n === 1 ? 'semana atípica fora' : 'semanas atípicas fora'} da conta.`;

export const bucketLine = (b: Bucket): string => `${b.label}: adiou ${b.postponed} · começou ${b.started}`;
export const hypothesisGateText = (postponed: number): string =>
  `As hipóteses aparecem a partir de 8 adiamentos em 4 semanas. Até agora: ${postponed}.`;

// ------------------------------------------------------------------ month

/** "Outubro de 2026". */
export function monthTitle(month: MonthKey): string {
  const name = monthName(month);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${month.slice(0, 4)}`;
}

export function monthObservedRows(o: MonthObserved): Array<{ label: string; value: string }> {
  return [
    { label: 'Dias úteis ativos', value: `${o.activeWorkdays} de ${o.workdays}` },
    { label: 'Blocos iniciados', value: `${o.blocksStarted} de ${o.blocksPlanned}` },
    { label: 'Versão mínima', value: `${o.minimumUsed}×` },
    { label: 'Retomadas', value: String(o.resumptions) },
    { label: 'Revisões', value: o.accuracy !== undefined ? `${o.reviews} · acerto ${pct(o.accuracy)}` : String(o.reviews) },
    ...(o.practiceClosed > 0 ? [{ label: 'Sessões de prática encerradas', value: String(o.practiceClosed) }] : []),
    ...(o.workouts > 0 ? [{ label: 'Treinos', value: String(o.workouts) }] : []),
    ...(o.sleepAvgMin !== undefined ? [{ label: 'Sono médio', value: formatDuration(o.sleepAvgMin) }] : []),
    { label: 'Escapei', value: `${o.escapes}×` },
  ];
}
