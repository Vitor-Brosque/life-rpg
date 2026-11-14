import { Link } from 'wouter';
import type { Journey } from '@life/shared';
import {
  NO_CONTACT_MIN, classOf, daysWithoutContact, nextAssessment, problemSetText, topicsByLevel, topicsSummary,
} from '@life/shared';
import type { FacultyData } from '../../db/facultyData';
import { WEEKDAY_ABBR } from '../../ui/format';
import { useProblemSetSheet } from './ProblemSetSheet';
import { WEEKDAY_ORDER } from './SubjectSheet';

export const ddmm = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** "hoje" · "amanhã" · "em 20 dias". */
export const inDaysText = (n: number): string => (n === 0 ? 'hoje' : n === 1 ? 'amanhã' : `em ${n} dias`);

/** "ter · 19:30–22:30" for a subject's class, or "ainda sem horário". */
export function classLine(journey: Pick<Journey, 'title'>, data: Pick<FacultyData, 'commitments' | 'today'>): string {
  const c = classOf(journey.title, data.commitments, data.today);
  if (!c) return 'ainda sem horário';
  const days = WEEKDAY_ORDER.filter((d) => c.weekdays?.includes(d)).map((d) => WEEKDAY_ABBR[d]).join(', ');
  return `${days} · ${c.start}–${c.end}`;
}

/** The faculty rows of a subject card: class, next avaliação, contact, last exercises, topics, actions. */
export function FacultyLines({ journey, data }: { journey: Journey; data: FacultyData }) {
  const { today, missions, contact, restDays } = data;
  const next = nextAssessment(missions, journey.id, today);
  const noContact = daysWithoutContact(journey, contact, today, restDays);
  const sets = contact.problemSets
    .filter((p) => !p.deleted && p.journeyId === journey.id)
    .sort((a, b) => b.day.localeCompare(a.day) || b.createdAt - a.createdAt)
    .slice(0, 3);
  const groups = topicsByLevel(contact.topics, journey.id);
  const summary = topicsSummary(groups);
  return (
    <>
      <li>{`Aula: ${classLine(journey, data)}`}</li>
      {next && <li>{`Próxima avaliação: ${next.title} · ${ddmm(next.day)} · ${inDaysText(next.inDays)}`}</li>}
      {noContact >= NO_CONTACT_MIN && <li>{`Sem contato há ${noContact} dias de estudo`}</li>}
      {sets.length > 0 && (
        <li>
          <span>Últimos exercícios</span>
          <ul className="sdetail__list">
            {sets.map((p) => (
              <li key={p.id}><span>{problemSetText(p)}</span>{' '}<span className="subject__caption">{ddmm(p.day)}</span></li>
            ))}
          </ul>
        </li>
      )}
      {summary !== '' && <li>{`Assuntos: ${summary}`}</li>}
      <li className="faculty-lines__actions">
        <Link className="subject__action" href={`/estudo/materias/${journey.id}`} aria-label={`Abrir disciplina ${journey.title}`}>Abrir disciplina</Link>
        <button type="button" className="subject__action" aria-label={`Registrar exercícios de ${journey.title}`}
          onClick={() => useProblemSetSheet.getState().open({ journeyId: journey.id })}>Registrar exercícios</button>
      </li>
    </>
  );
}
