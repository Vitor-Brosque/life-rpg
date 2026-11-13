import { Link } from 'wouter';
import { useLiveQuery } from 'dexie-react-hooks';
import { dayKeyOf, subjectsOf, type Deck, type Subject, type SubjectsData } from '@life/shared';
import { db } from '../../db/db';
import { useNow } from '../../db/hooks';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { plural } from '../../ui/format';
import { Panel } from '../../ui/Panel';
import { ProgressBar } from '../../ui/ProgressBar';
import './study.css';

/** One read for the whole screen: only the tables the subjects need. */
async function loadData(): Promise<{ data: SubjectsData; decks: Deck[] } | undefined> {
  const settings = await db.settings.get('settings');
  if (!settings) return undefined;
  const [journeys, decks, cards, notes, reviews, practice, missions] = await Promise.all([
    db.journeys.toArray(), db.decks.toArray(), db.cards.toArray(), db.notes.toArray(),
    db.reviews.toArray(), db.practiceSessions.toArray(), db.missions.toArray(),
  ]);
  const live = <T extends { deleted: boolean }>(rows: T[]): T[] => rows.filter((r) => !r.deleted);
  return {
    decks: live(decks),
    data: {
      dayStartHour: settings.dayStartHour,
      journeys: live(journeys), decks: live(decks), cards: live(cards), notes: live(notes),
      reviews: live(reviews), practice: live(practice), missions: live(missions),
    },
  };
}

const ddmm = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** "/estudo/materias": observed progress per subject (a journey with its decks and practice, or a loose deck). */
export function SubjectsScreen() {
  const loaded = useLiveQuery(loadData);
  const now = useNow();
  if (!loaded) return <section className="screen study" aria-busy="true" aria-label="Matérias" />;
  const today = dayKeyOf(now, loaded.data.dayStartHour);
  const subjects = subjectsOf(loaded.data, today);
  const deckName = new Map(loaded.decks.map((d) => [d.id, d.name]));

  return (
    <section className="screen study stack" aria-labelledby="subjects-title">
      <Link className="deck__back" href="/estudo">← Estudo</Link>
      <h1 id="subjects-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Matérias</h1>
      {subjects.length === 0 ? (
        <Panel variant="stone"><p className="muted">As matérias aparecem quando um baralho ou uma sessão de prática estiver ligado a uma jornada.</p></Panel>
      ) : subjects.map((s) => <SubjectCard key={`${s.kind}-${s.id}`} subject={s} deckName={deckName} />)}
    </section>
  );
}

function SubjectCard({ subject: s, deckName }: { subject: Subject; deckName: Map<string, string> }) {
  const titleId = `subject-${s.id}`;
  const href = s.kind === 'journey' ? `/jornadas/${s.id}` : `/estudo/baralho/${s.id}`;
  const hasPractice = s.practice.sessions > 0;
  return (
    <Panel variant="stone" className="study-section subject">
      <article aria-labelledby={titleId} className="subject__body">
        <h2 id={titleId} className="study__subtitle"><Link className="subject__link" href={href}>{s.title}</Link></h2>
        {s.cards > 0
          ? <ProgressBar value={s.learned} max={s.cards} label={`${s.learned} de ${s.cards} cards aprendidos`} />
          : <p className="subject__line">Nenhum card ativo ainda</p>}
        <p className="subject__caption">Observado · últimos 30 dias</p>
        <ul className="subject__lines">
          <li>{s.recall !== undefined ? `Lembrou ${Math.round(s.recall * 100)}% dos cards maduros` : 'Aparece com 20 revisões de cards aprendidos'}</li>
          <li>{s.minutesWeek} min de revisão nesta semana</li>
          {s.topics > 0 && <li>{plural(s.topics, 'tópico', 'tópicos')}</li>}
          {hasPractice && <li>{`Prática: ${plural(s.practice.sessions, 'sessão', 'sessões')}, ${s.practice.autonomous} com Autônomo`}</li>}
          {s.nextDeadline && <li>{`Próxima entrega: ${s.nextDeadline.title}, ${ddmm(s.nextDeadline.day)}`}</li>}
        </ul>
        {s.kind === 'journey' && s.deckIds.length > 0 && (
          <ul className="subject__decks">
            {s.deckIds.map((id) => (
              <li key={id}>
                <Link className="subject__action" href={`/estudo/baralho/${id}`} aria-label={`Ver baralho ${deckName.get(id) ?? ''}`}>Ver baralho {deckName.get(id)}</Link>
                {s.cards > 0 && <Link className="subject__action" href={`/estudo/revisar?baralho=${id}`} aria-label={`Revisar ${deckName.get(id) ?? ''}`}>Revisar</Link>}
              </li>
            ))}
          </ul>
        )}
        {s.kind === 'deck' && s.cards > 0 && (
          <div className="subject__decks">
            <Link className="subject__action" href={`/estudo/revisar?baralho=${s.id}`} aria-label={`Revisar ${s.title}`}>Revisar</Link>
          </div>
        )}
      </article>
    </Panel>
  );
}
