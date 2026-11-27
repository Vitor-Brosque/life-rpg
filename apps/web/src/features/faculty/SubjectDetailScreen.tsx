import { useId, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import type { FacultyData } from '../../db/facultyData';
import { useFacultyData } from '../../db/facultyData';
import type { DayKey, Mission, SubjectTopic, TopicLevel } from '@life/shared';
import {
  TOPIC_LEVELS, TOPIC_LEVEL_LABEL, assessmentDay, dayKeyOf, diffDays, problemSetText, subjectJourneys, topicLevelOf,
} from '@life/shared';
import {
  FacultyValidationError, addTopic, deleteProblemSet, deleteTopic, restoreProblemSet, setTopicLevel,
} from '../../domain/facultyActions';
import { Button } from '../../ui/Button';
import { ddmm } from '../../ui/format';
import { FOCUS_PAGE, focusWhenGone } from '../../ui/focusAfter';
import { FAILURE_TOAST, safeRun } from '../../ui/safeRun';
import { Panel } from '../../ui/Panel';
import { useToast } from '../../ui/Toast';
import { useMissionSheet } from '../mission/MissionSheet';
import { AssessmentSheet } from './AssessmentSheet';
import { classLine, inDaysText } from './FacultyLines';
import { useProblemSetSheet } from './ProblemSetSheet';
import { NotebookPanel } from './NotebookPanel';
import { StudyDocsPanel } from './StudyDocsPanel';
import { StudyFilesPanel } from '../pdf/StudyFilesPanel';
import { SubjectChatPanel } from './SubjectChatPanel';
import './faculty.css';

const BACK = <Link className="deck__back" href="/estudo/materias">← Matérias</Link>;

/** "/estudo/materias/:id": a subject's chat, caderno, PDFs, apostilas, avaliações, exercises and topics. Opening it writes nothing. */
export function SubjectDetailScreen({ id }: { id: string }) {
  const data = useFacultyData();
  if (!data) return <section className="screen study" aria-busy="true" aria-label="Disciplina" />;
  const journey = data.journeys.find((j) => j.id === id);
  if (!journey || journey.subject !== true) {
    return (
      <section className="screen study stack" aria-labelledby="subject-missing">
        {BACK}
        <h1 id="subject-missing" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Disciplina não encontrada.</h1>
      </section>
    );
  }
  return <Detail data={data} id={id} title={journey.title} chatUrl={journey.chatUrl} />;
}

function Detail({ data, id, title, chatUrl }: { data: FacultyData; id: string; title: string; chatUrl?: string }) {
  const { today, dayStartHour } = data;
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const toast = useToast.getState();

  // An avaliação's day is its deadline (reschedules never move it), else `date` for older records.
  const assessments = data.missions
    .filter((m) => m.journeyId === id && m.assessment !== undefined && m.status !== 'dropped')
    .flatMap((m) => { const day = assessmentDay(m); return day ? [{ m, day }] : []; })
    .sort((a, b) => a.day.localeCompare(b.day));
  const upcoming = (m: Mission, day: DayKey): boolean => (m.status === 'open' || m.status === 'doing') && day >= today;
  const sets = data.contact.problemSets
    .filter((p) => p.journeyId === id)
    .sort((a, b) => b.day.localeCompare(a.day) || b.createdAt - a.createdAt);
  const topics = data.contact.topics
    .filter((t) => t.journeyId === id)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const remove = (setId: string, button: Element) => {
    safeRun(async () => {
      const gone = await deleteProblemSet(setId);
      if (!gone) return;
      focusWhenGone(button, () => document.getElementById('subject-sets'));
      toast.show('Registro apagado.', { label: 'Desfazer', run: () => safeRun(restoreProblemSet(setId)) });
    });
  };

  return (
    <section className="screen study stack" aria-labelledby="subject-title">
      {BACK}
      <h1 id="subject-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>{title}</h1>
      <p className="subject__line">{`Aula: ${classLine({ title }, data)}`}</p>

      <SubjectChatPanel journeyId={id} title={title} {...(chatUrl ? { chatUrl } : {})} />
      <NotebookPanel journeyId={id} />
      <StudyFilesPanel journeyId={id} />
      <StudyDocsPanel journeyId={id} />

      <Panel variant="stone" className="study-section stack">
        <h2 className="study__subtitle">Avaliações</h2>
        {assessments.length === 0 ? <p className="muted">Nenhuma prova ou trabalho cadastrado.</p> : (
          <ul className="sdetail__list">
            {assessments.map(({ m, day }) => {
              const text = `${m.title} · ${ddmm(day)}`;
              return (
                <li key={m.id}>
                  {upcoming(m, day) ? (
                    <button type="button" className="sdetail__open"
                      onClick={() => useMissionSheet.getState().open(m.id)}>{`${text} · ${inDaysText(diffDays(today, day))}`}</button>
                  ) : <span className="sdetail__row sdetail__quiet">{text}</span>}
                </li>
              );
            })}
          </ul>
        )}
        <div><Button onClick={() => setAssessmentOpen(true)}>Nova prova ou trabalho</Button></div>
      </Panel>

      <Panel variant="stone" className="study-section stack">
        <h2 id="subject-sets" className="study__subtitle" tabIndex={-1}>Exercícios</h2>
        {sets.length === 0 ? <p className="muted">Nenhum exercício registrado ainda.</p> : (
          <ul className="sdetail__list">
            {sets.map((p) => (
              <li key={p.id} className="sdetail__row">
                <span className="sdetail__row-text">{`${ddmm(p.day)} · ${problemSetText(p)}`}</span>
                <Button size="sm" aria-label={`Editar ${p.title} de ${ddmm(p.day)}`}
                  onClick={() => useProblemSetSheet.getState().open({ journeyId: id, set: p })}>Editar</Button>
                <Button size="sm" variant="ghost" aria-label={`Apagar ${p.title} de ${ddmm(p.day)}`}
                  onClick={(e) => remove(p.id, e.currentTarget)}>Apagar</Button>
              </li>
            ))}
          </ul>
        )}
        <div><Button onClick={() => useProblemSetSheet.getState().open({ journeyId: id })}>Registrar exercícios</Button></div>
      </Panel>

      <Panel variant="stone" className="study-section stack">
        <h2 id="subject-topics" className="study__subtitle" tabIndex={-1}>Assuntos</h2>
        <TopicAdd journeyId={id} />
        {topics.length === 0 ? (
          <p className="muted">Nenhum assunto ainda. Anote os temas da disciplina e marque o quanto já domina cada um.</p>
        ) : topics.map((t) => <Topic key={t.id} topic={t} dayStartHour={dayStartHour} />)}
      </Panel>

      <AssessmentSheet open={assessmentOpen} onClose={() => setAssessmentOpen(false)}
        subjects={subjectJourneys(data.journeys)} today={today} journeyId={id} />
    </section>
  );
}

function TopicAdd({ journeyId }: { journeyId: string }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await addTopic(journeyId, name);
      setName('');
    } catch (err) {
      if (err instanceof FacultyValidationError) setError(err.message);
      else { console.error('topic add failed', err); useToast.getState().show(FAILURE_TOAST); }
    }
  };
  return (
    <form className="sdetail__add" noValidate onSubmit={(e) => { void submit(e); }}>
      <label className="field">
        <span className="field__label">Novo assunto</span>
        <input type="text" value={name} autoComplete="off" enterKeyHint="done"
          onChange={(e) => { setName(e.target.value); setError(undefined); }} />
      </label>
      <Button type="submit">Adicionar</Button>
      {error && <p role="alert" className="faculty-form__error">{error}</p>}
    </form>
  );
}

function Topic({ topic, dayStartHour }: { topic: SubjectTopic; dayStartHour: number }) {
  const level = topicLevelOf(topic);
  const legendId = useId();
  const pick = (l: TopicLevel) => safeRun(setTopicLevel(topic.id, l));
  return (
    <fieldset className="topic">
      <legend id={legendId}>{topic.name}</legend>
      <div className="topic__levels" role="radiogroup" aria-labelledby={legendId}>
        {TOPIC_LEVELS.map((l) => (
          <label key={l} className="topic__level">
            <input type="radio" name={`topic-${topic.id}`} value={l} checked={level === l} onChange={() => pick(l)} />
            <span>{TOPIC_LEVEL_LABEL[l]}</span>
          </label>
        ))}
      </div>
      {topic.marks.length > 0 && (
        <details className="topic__history">
          <summary>Histórico</summary>
          <ul>
            {topic.marks.map((m) => (
              <li key={`${m.at}-${m.level}`}>{`${TOPIC_LEVEL_LABEL[m.level]} em ${ddmm(dayKeyOf(m.at, dayStartHour))}`}</li>
            ))}
          </ul>
        </details>
      )}
      <div>
        <Button size="sm" variant="ghost" aria-label={`Apagar assunto ${topic.name}`}
          onClick={(e) => {
            focusWhenGone(e.currentTarget, () => document.getElementById('subject-topics'));
            safeRun(deleteTopic(topic.id));
          }}>Apagar assunto</Button>
      </div>
    </fieldset>
  );
}
