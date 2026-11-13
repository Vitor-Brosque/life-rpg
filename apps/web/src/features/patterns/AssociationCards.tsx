import { useId } from 'react';
import { Panel } from '../../ui/Panel';
import type { PatternsView } from './patternData';
import { methodLines, sleepBlocksLines, sleepModeLines } from './patternText';

const SLEEP_MEANING = 'Os dias foram divididos pela mediana do sono: metade das noites ficou abaixo, metade acima. '
  + 'Comparar as duas metades mostra se andam juntas, não o porquê. Para testar de verdade, mude uma coisa por uma semana e observe.';
const METHOD_MEANING = 'As revisões foram agrupadas pelo que você fez antes de ver a resposta. '
  + 'Comparar os grupos mostra se andam juntos, não o porquê.';

interface AssociationCardProps { title: string; lines: string[]; cause?: string; meaning: string }

function AssociationCard({ title, lines, cause, meaning }: AssociationCardProps) {
  const id = useId();
  return (
    <section className="trend-card" aria-labelledby={id}>
      <Panel variant="stone">
        <h3 id={id} className="trend-card__title">{title}</h3>
        {lines.map((line) => <p key={line}>{line}</p>)}
        {cause && <p className="trend-card__caption">{cause}</p>}
        <details className="patterns__details">
          <summary>O que isso quer dizer?</summary>
          <p>{meaning}</p>
        </details>
      </Panel>
    </section>
  );
}

/** "Associações" (spec §5.6): the two halves side by side, never a cause and never a coefficient. */
export function AssociationSection({ view }: { view: PatternsView }) {
  const { sleepBlocks, sleepMode, methods } = view;
  return (
    <section className="associations stack" aria-labelledby="associations-title">
      <h2 id="associations-title" className="section-title">Associações</h2>
      <p className="patterns__note">
        Números lado a lado, dos últimos 90 dias. Associação, não causa: outra coisa pode estar mexendo nos dois lados.
      </p>
      <div className="trends__grid">
        <AssociationCard
          title="Sono e blocos do dia seguinte" lines={sleepBlocksLines(sleepBlocks)} meaning={SLEEP_MEANING}
          cause={sleepBlocks.enough ? 'Associação, não causa: um dia cheio pode encurtar a noite e também o dia seguinte.' : undefined}
        />
        <AssociationCard
          title="Sono e tipo do dia" lines={sleepModeLines(sleepMode)} meaning={SLEEP_MEANING}
          cause={sleepMode.enough ? 'Associação, não causa: cansaço e sono curto podem ter a mesma origem.' : undefined}
        />
        <AssociationCard
          title="Jeito de responder e acerto na revisão" lines={methodLines(methods)} meaning={METHOD_MEANING}
          cause={methods.enough
            ? 'Associação, não causa: você pode escolher escrever justamente nos cards mais difíceis, ou nos mais fáceis. Uma revisão pode contar em mais de um jeito.'
            : undefined}
        />
      </div>
    </section>
  );
}

const HOW: string[] = [
  'Só entram semanas e meses completos: o período em andamento fica de fora para não parecer queda.',
  'Blocos planejados seguem o cálculo da revisão semanal: dias livres, blocos de rotina e blocos que não couberam no dia não contam.',
  'Acerto: revisões de cards já aprendidos que não foram “Errei”, só com 20 revisões ou mais.',
  'Adiar é tocar “Adiar” ou mover uma missão de hoje (ou de antes) para um dia depois. Encolher e soltar são contados à parte.',
  'Hipóteses só aparecem a partir de 8 adiamentos em 4 semanas. Um grupo precisa de 5 adiamentos e de uma taxa de adiamento 25 pontos acima do resto.',
  'Semanas 5–8 comparam as 4 primeiras semanas de um bloco com as mais recentes. O aviso só aparece com queda de pelo menos 30% e de 15 pontos, e com pelo menos 8 blocos planejados nas primeiras semanas.',
  'Associações usam os últimos 90 dias e precisam de 14 pares, divididos pela mediana.',
  'Nada aqui usa IA. São contagens simples, e você pode discordar de qualquer leitura.',
];

/** The closing `<details>` of the screen (spec §5.8). */
export function HowCalculated() {
  return (
    <details className="patterns__how">
      <summary>Como estes números são calculados</summary>
      <ul>{HOW.map((t) => <li key={t}>{t}</li>)}</ul>
    </details>
  );
}
