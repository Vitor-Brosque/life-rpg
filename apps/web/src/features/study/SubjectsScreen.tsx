import { useState } from 'react';
import { Link } from 'wouter';
import { useLiveQuery } from 'dexie-react-hooks';
import { NOTEBOOK_LIMITS, dayKeyOf, subjectJourneys, subjectsOf, type Deck, type Subject, type SubjectsData } from '@life/shared';
import { db } from '../../db/db';
import { useFacultyData, type FacultyData } from '../../db/facultyData';
import { useNow, useProfile } from '../../db/hooks';
import { setStudyProfile } from '../../domain/notebookActions';
import { AssessmentSheet } from '../faculty/AssessmentSheet';
import { FacultyLines } from '../faculty/FacultyLines';
import { SemesterCard, useSemesterCard } from '../faculty/SemesterCard';
import { SubjectSheet } from '../faculty/SubjectSheet';
import '../faculty/faculty.css';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { ddmm, plural } from '../../ui/format';
import { Panel } from '../../ui/Panel';
import { ProgressBar } from '../../ui/ProgressBar';
import { EditableMarkdown } from './EditableMarkdown';
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

/** "/estudo/materias": observed progress per subject (a journey with its decks and practice, or a loose deck). */
export function SubjectsScreen() {
  const loaded = useLiveQuery(loadData);
  const faculty = useFacultyData();
  const hideCard = useSemesterCard((c) => c.hidden);
  const [sheet, setSheet] = useState<'subject' | 'assessment'>();
  const now = useNow();
  if (!loaded || !faculty) return <section className="screen study" aria-busy="true" aria-label="Matérias" />;
  const today = dayKeyOf(now, loaded.data.dayStartHour);
  const subjects = subjectsOf(loaded.data, today);
  const deckName = new Map(loaded.decks.map((d) => [d.id, d.name]));
  // "Revisar" only makes sense for a deck that has cards to review (live, not suspended).
  const deckCards = new Map<string, number>();
  for (const c of loaded.data.cards) {
    if (c.deleted || c.suspended || c.deckId === undefined) continue;
    deckCards.set(c.deckId, (deckCards.get(c.deckId) ?? 0) + 1);
  }

  const disciplines = subjectJourneys(faculty.journeys);
  const subjectIds = new Set(disciplines.map((j) => j.id));
  return (
    <section className="screen study stack" aria-labelledby="subjects-title">
      <Link className="deck__back" href="/estudo">← Estudo</Link>
      <h1 id="subjects-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Matérias</h1>
      <StudyProfilePanel />
      <div className="faculty-actions">
        <Button onClick={() => setSheet('subject')}>Nova disciplina</Button>
        {disciplines.length > 0 && <Button onClick={() => setSheet('assessment')}>Nova prova ou trabalho</Button>}
      </div>
      {disciplines.length === 0 && !hideCard && <SemesterCard data={faculty} />}
      {subjects.length === 0 ? (
        <Panel variant="stone"><p className="muted">As matérias aparecem quando você cadastra uma disciplina, ou quando um baralho ou uma sessão de prática está ligado a uma jornada.</p></Panel>
      ) : subjects.map((s) => (
        <SubjectCard key={`${s.kind}-${s.id}`} subject={s} deckName={deckName} deckCards={deckCards}
          faculty={s.kind === 'journey' && subjectIds.has(s.id) ? faculty : undefined} />
      ))}
      <SubjectSheet open={sheet === 'subject'} onClose={() => setSheet(undefined)} />
      <AssessmentSheet open={sheet === 'assessment'} onClose={() => setSheet(undefined)} subjects={disciplines} today={today} />
    </section>
  );
}

/** "Perfil de estudo" (spec 2026-11-26 §5.3): how the person learns best, read by the chats of every subject. */
function StudyProfilePanel() {
  const profile = useProfile();
  return (
    <Panel variant="stone" className="study-section">
      <EditableMarkdown title="Perfil de estudo" level={2} headingId="study-profile" text={profile?.studyProfile ?? ''}
        max={NOTEBOOK_LIMITS.studyProfile} note="Os chats de todas as matérias leem este perfil."
        emptyText="Vazio. Escreva como você aprende melhor ou peça ao chat de uma matéria para preencher."
        savedText="Perfil de estudo salvo." onSave={setStudyProfile} />
    </Panel>
  );
}

function SubjectCard({ subject: s, deckName, deckCards, faculty }: {
  subject: Subject; deckName: Map<string, string>; deckCards: Map<string, number>; faculty?: FacultyData;
}) {
  const journey = faculty?.journeys.find((j) => j.id === s.id);
  // A disciplina without decks shows its faculty lines instead of the (empty) card lines.
  const bare = journey !== undefined && s.deckIds.length === 0;
  const titleId = `subject-${s.id}`;
  const href = s.kind === 'journey' ? `/jornadas/${s.id}` : `/estudo/baralho/${s.id}`;
  const hasPractice = s.practice.sessions > 0;
  return (
    <Panel variant="stone" className="study-section subject">
      <article aria-labelledby={titleId} className="subject__body">
        <h2 id={titleId} className="study__subtitle"><Link className="subject__link" href={href}>{s.title}</Link></h2>
        {bare ? null : s.cards > 0
          ? <ProgressBar value={s.learned} max={s.cards} label={`${s.learned} de ${s.cards} cards aprendidos`} />
          : <p className="subject__line">Nenhum card ativo ainda</p>}
        <ul className="subject__lines">
          {!bare && (
            <>
              <li>
                {s.recall !== undefined ? `Lembrou ${Math.round(s.recall * 100)}% dos cards maduros` : 'Aparece com 20 revisões de cards aprendidos'}
                {' '}<span className="subject__caption">Observado · últimos 30 dias</span>
              </li>
              <li>{s.minutesWeek} min de revisão nesta semana</li>
            </>
          )}
          {s.topics > 0 && <li>{plural(s.topics, 'tópico', 'tópicos')}</li>}
          {hasPractice && <li>{`Prática: ${plural(s.practice.sessions, 'sessão', 'sessões')}, ${s.practice.autonomous} com Autônomo`}</li>}
          {s.nextDeadline && <li>{`Próxima entrega: ${s.nextDeadline.title}, ${ddmm(s.nextDeadline.day)}`}</li>}
          {faculty && journey && <FacultyLines journey={journey} data={faculty} />}
        </ul>
        {s.kind === 'journey' && s.deckIds.length > 0 && (
          <ul className="subject__decks">
            {s.deckIds.map((id) => (
              <li key={id}>
                <Link className="subject__action" href={`/estudo/baralho/${id}`} aria-label={`Ver baralho ${deckName.get(id) ?? ''}`}>Ver baralho {deckName.get(id)}</Link>
                {(deckCards.get(id) ?? 0) > 0 && <Link className="subject__action" href={`/estudo/revisar?baralho=${id}`} aria-label={`Revisar ${deckName.get(id) ?? ''}`}>Revisar</Link>}
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
