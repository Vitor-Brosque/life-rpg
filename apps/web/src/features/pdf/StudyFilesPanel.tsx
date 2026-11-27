import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { Panel } from '../../ui/Panel';
import { AddPdf, StudyFileList } from './StudyFileList';

export const PDFS_EMPTY = 'Nenhum PDF ainda. Adicione os slides, o plano de ensino ou capítulos dos livros da aula.';

/** "PDFs" on the subject page (spec 2026-11-26 §1.1), above Apostilas: the subject's PDFs and "Adicionar PDF". */
export function StudyFilesPanel({ journeyId }: { journeyId: string }) {
  const files = useLiveQuery(async () => (await db.studyFiles.where('journeyId').equals(journeyId).toArray())
    .filter((f) => !f.deleted).sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')), [journeyId]);
  return (
    <Panel variant="stone" className="study-section stack">
      <h2 id="subject-pdfs" className="study__subtitle" tabIndex={-1}>PDFs</h2>
      {files === undefined ? null : files.length === 0
        ? <p className="muted">{PDFS_EMPTY}</p>
        : <StudyFileList files={files} headingId="subject-pdfs" />}
      <AddPdf journeyId={journeyId} />
    </Panel>
  );
}
