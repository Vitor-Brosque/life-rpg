import { Link } from 'wouter';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Journey, StudyFile } from '@life/shared';
import { subjectJourneys } from '@life/shared';
import { db } from '../../db/db';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import { AddPdf, PDF_TEXT, StudyFileList } from './StudyFileList';
import { PDFS_EMPTY } from './StudyFilesPanel';
import '../study/study.css';
import '../faculty/faculty.css';

/**
 * "/estudo/materiais" (spec 2026-11-26 §1.2): every PDF, by subject, plus "Sem disciplina", with "Adicionar PDF" and the
 * choice of the subject. A PDF whose subject is gone (deleted, or no longer a subject) shows under "Sem disciplina".
 */
export function MaterialsScreen() {
  const data = useLiveQuery(async () => {
    const [files, journeys] = await Promise.all([db.studyFiles.toArray(), db.journeys.toArray()]);
    return { files: files.filter((f) => !f.deleted), journeys: journeys.filter((j) => !j.deleted) };
  });
  if (!data) return <section className="screen study" aria-busy="true" aria-label="Materiais" />;
  const subjects = subjectJourneys(data.journeys);
  // Groups: the active subjects in their order, then other live subjects (archived or done) that still have PDFs.
  const known = new Map<string, Journey>(data.journeys.filter((j) => j.subject === true).map((j) => [j.id, j]));
  const byTitle = (a: StudyFile, b: StudyFile) => a.title.localeCompare(b.title, 'pt-BR');
  const groups: { key: string; title: string; files: StudyFile[] }[] = [];
  const order = [...subjects, ...[...known.values()].filter((j) => !subjects.includes(j))];
  for (const j of order) {
    const own = data.files.filter((f) => f.journeyId === j.id).sort(byTitle);
    if (own.length > 0) groups.push({ key: j.id, title: j.title, files: own });
  }
  const loose = data.files.filter((f) => !f.journeyId || !known.has(f.journeyId)).sort(byTitle);
  if (loose.length > 0) groups.push({ key: 'none', title: PDF_TEXT.noSubject, files: loose });

  return (
    <section className="screen study stack" aria-labelledby="materials-title">
      <Link className="deck__back" href="/estudo">← Estudo</Link>
      <h1 id="materials-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Materiais</h1>
      <Panel variant="stone" className="study-section stack">
        <p className="muted">Os PDFs da aula (slides, plano de ensino, capítulos). Os chats das matérias leem o texto dos PDFs de cada disciplina; os de "Sem disciplina" ficam só com você.</p>
        <AddPdf subjects={subjects} />
      </Panel>
      {groups.length === 0 ? <Panel variant="stone" className="study-section"><p className="muted">{PDFS_EMPTY}</p></Panel> : groups.map((g) => (
        <Panel key={g.key} variant="stone" className="study-section stack">
          <h2 id={`materials-${g.key}`} className="study__subtitle" tabIndex={-1}>{g.title}</h2>
          <StudyFileList files={g.files} from="materiais" subjects={subjects} headingId={`materials-${g.key}`} />
        </Panel>
      ))}
    </section>
  );
}
