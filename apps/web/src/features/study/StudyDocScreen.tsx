import { Link, useLocation } from 'wouter';
import { useLiveQuery } from 'dexie-react-hooks';
import { dayKeyOf } from '@life/shared';
import { db } from '../../db/db';
import { useSettings } from '../../db/hooks';
import { deleteStudyDoc, restoreStudyDoc } from '../../domain/notebookActions';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { ddmm } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { Rich } from './Rich';
import '../faculty/faculty.css';
import './study.css';

/**
 * "/estudo/apostila/:id" (spec 2026-11-26 §5.2): an apostila on its own screen, rendered by `Rich` in document mode
 * (never HTML). "Salvar como PDF" opens the browser's print, whose sheet hides the navigation and the buttons.
 */
export function StudyDocScreen({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const settings = useSettings();
  const doc = useLiveQuery(async () => {
    const d = await db.studyDocs.get(id);
    return d && !d.deleted ? d : null;
  }, [id]);
  if (doc === undefined || !settings) return <section className="screen study" aria-busy="true" aria-label="Apostila" />;
  if (doc === null) {
    return (
      <section className="screen study stack" aria-labelledby="studydoc-missing">
        <Link className="deck__back" href="/estudo/materias">← Matérias</Link>
        <h1 id="studydoc-missing" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Apostila não encontrada.</h1>
      </section>
    );
  }
  const subjectPath = `/estudo/materias/${doc.journeyId}`;
  const remove = () => {
    safeRun(async () => {
      const gone = await deleteStudyDoc(doc.id);
      if (!gone) return;
      navigate(subjectPath);
      useToast.getState().show('Apostila apagada.', { label: 'Desfazer', run: () => safeRun(restoreStudyDoc(doc.id)) });
    });
  };
  return (
    <section className="screen study studydoc stack" aria-labelledby="studydoc-title">
      <Link className="deck__back" href={subjectPath}>← Disciplina</Link>
      <h1 id="studydoc-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>{doc.title}</h1>
      <p className="studydoc__meta">{`${doc.source} · ${ddmm(dayKeyOf(doc.updatedAt, settings.dayStartHour))}`}</p>
      <div className="faculty-actions studydoc__actions">
        <Button onClick={() => window.print()}>Salvar como PDF</Button>
        <Button variant="ghost" onClick={remove}>Apagar apostila</Button>
      </div>
      <article className="studydoc__body" aria-labelledby="studydoc-title">
        <Rich text={doc.markdown} doc headingLevel={2} />
      </article>
    </section>
  );
}
