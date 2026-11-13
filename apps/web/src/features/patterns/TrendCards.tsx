import { useId, type ReactNode } from 'react';
import { Link } from 'wouter';
import type { CountRow, PeriodKind, TrendPoint } from '@life/shared';
import { formatDuration } from '../../ui/format';
import { Chip } from '../../ui/Chip';
import { Panel } from '../../ui/Panel';
import { MiniBars } from './MiniBars';
import type { PatternsView } from './patternData';
import {
  balanceText, blocksText, checkinsText, pct, practiceText, resumptionsText, reviewsText, seriesText, sleepText,
  workoutsText,
} from './patternText';

interface TrendCardProps {
  title: string;
  summary: string;
  caption: string;
  points: TrendPoint[];
  kind: PeriodKind;
  values: Array<number | undefined>;
  background?: number[];
  value: (p: TrendPoint) => string;
  link?: { href: string; label: string };
  children?: ReactNode;
}

function TrendCard({ title, summary, caption, points, kind, values, background, value, link, children }: TrendCardProps) {
  const id = useId();
  return (
    <section className="trend-card" aria-labelledby={id}>
      <Panel variant="stone">
        <h3 id={id} className="trend-card__title">{title}</h3>
        <p>{summary}</p>
        <MiniBars values={values} background={background} labels={points.map((p) => p.period.label)}
          atypical={points.map((p) => p.atypical === true)} />
        <p className="trend-card__caption">{caption}</p>
        {points.some((p) => p.atypical) && (
          <p className="trend-card__caption">
            {kind === 'week' ? 'Barra tracejada e *: semana atípica.' : 'Barra tracejada e *: mês com semana atípica.'}
          </p>
        )}
        <p className="visually-hidden">{seriesText(points, kind, value)}</p>
        {children}
        {link && <Link href={link.href} className="trend-card__link">{link.label}</Link>}
      </Panel>
    </section>
  );
}

const joined = (rows: CountRow[]): string => rows.map((r) => `${r.label} ${r.count}`).join(' · ');

function BreakdownLines({ view }: { view: PatternsView }) {
  const b = view.breakdown;
  const lines: Array<[string, CountRow[]]> = [
    ['“Escapei” por parte do dia', b.escapesByPart],
    ['“Escapei” por área', b.escapesByArea],
    ['Para onde', b.escapesByPlace],
    ['Sentimentos no card de início', b.feelings],
  ];
  return (
    <>
      {lines.filter(([, rows]) => rows.length > 0).map(([label, rows]) => (
        <p key={label} className="trend-card__line">{`${label}: ${joined(rows)}`}</p>
      ))}
    </>
  );
}

function Balance({ view, kind }: { view: PatternsView; kind: PeriodKind }) {
  const id = useId();
  return (
    <section className="trend-card trend-card--balance" aria-labelledby={id}>
      <Panel variant="stone">
        <h3 id={id} className="trend-card__title">Equilíbrio</h3>
        <p>{balanceText(kind, view.points.length, view.balance.length > 0)}</p>
        {view.balance.length > 0 && (
          <ul className="balance">
            {view.balance.map((a) => (
              <li key={a.key} className="balance__row">
                <span className="balance__name">{a.name}</span>
                <span className="balance__track" aria-hidden="true">
                  <span className="balance__bar" style={{ width: pct(a.share) }} />
                </span>
                <span className="balance__pct">{pct(a.share)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}

export interface TrendSectionProps {
  view: PatternsView;
  kind: PeriodKind;
  onKind(kind: PeriodKind): void;
}

/** "Tendências" (spec §5.3): a sentence, small bars and a screen-reader list per subject. */
export function TrendSection({ view, kind, onKind }: TrendSectionProps) {
  const { points } = view;
  const num = (f: (p: TrendPoint) => number | undefined) => points.map(f);
  const n = (f: (p: TrendPoint) => number) => (p: TrendPoint): string => String(f(p));
  return (
    <section className="trends stack" aria-labelledby="trends-title">
      <h2 id="trends-title" className="section-title">Tendências</h2>
      <div className="cluster" role="group" aria-label="Período">
        <Chip selected={kind === 'week'} onClick={() => onKind('week')}>Semanas</Chip>
        <Chip selected={kind === 'month'} onClick={() => onKind('month')}>Meses</Chip>
      </div>
      {points.length < 2 ? (
        <Panel variant="stone">
          <p>{`Ainda pouco histórico: as tendências aparecem com 2 ${kind === 'week' ? 'semanas completas' : 'meses completos'} de uso.`}</p>
        </Panel>
      ) : (
        <div className="trends__grid">
          <TrendCard
            title="Blocos" summary={blocksText(points, kind)} caption="Barras: blocos iniciados. Fundo: planejados."
            points={points} kind={kind} values={num((p) => p.blocksStarted)} background={points.map((p) => p.blocksPlanned)}
            value={(p) => `${p.blocksStarted} de ${p.blocksPlanned}`}
          />
          <TrendCard
            title="Retomadas" summary={resumptionsText(points, kind)}
            caption="Retomada é voltar a começar um bloco depois de 2 dias úteis parados."
            points={points} kind={kind} values={num((p) => p.resumptions)} value={n((p) => p.resumptions)}
          />
          <TrendCard
            title="Revisão espaçada" summary={reviewsText(points, kind)} caption="Barras: revisões."
            points={points} kind={kind} values={num((p) => p.reviews)} value={n((p) => p.reviews)}
          />
          <TrendCard
            title="Prática técnica" summary={practiceText(points, kind)} caption="Barras: sessões encerradas."
            points={points} kind={kind} values={num((p) => p.practiceClosed)} value={n((p) => p.practiceClosed)}
            link={{ href: '/estudo/praticas', label: 'Ver histórico da prática' }}
          />
          <TrendCard
            title="Sono" summary={sleepText(points, kind)}
            caption="Barras: duração média das noites completas, nos períodos com 3 noites ou mais."
            points={points} kind={kind} values={num((p) => p.sleepAvgMin)}
            value={(p) => (p.sleepAvgMin === undefined ? 'sem dados' : formatDuration(p.sleepAvgMin))}
            link={{ href: '/corpo', label: 'Ver sono e treinos' }}
          />
          <TrendCard
            title="Treinos" summary={workoutsText(points, kind)} caption="Barras: treinos registrados."
            points={points} kind={kind} values={num((p) => p.workouts)} value={n((p) => p.workouts)}
          />
          <TrendCard
            title="Card de início e Escapei" summary={checkinsText(points, kind)} caption="Barras: vezes “Escapei”."
            points={points} kind={kind} values={num((p) => p.escapes)} value={n((p) => p.escapes)}
          >
            <BreakdownLines view={view} />
          </TrendCard>
          <Balance view={view} kind={kind} />
        </div>
      )}
    </section>
  );
}
