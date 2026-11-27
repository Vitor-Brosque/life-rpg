import { Link } from 'wouter';
import { useLiveQuery } from 'dexie-react-hooks';
import { dayKeyOf } from '@life/shared';
import { db } from '../../db/db';
import { useSettings } from '../../db/hooks';
import { ddmm } from '../../ui/format';
import { Panel } from '../../ui/Panel';

export const DOCS_EMPTY = 'Nenhuma apostila ainda. Peça ao chat da matéria uma apostila e para mandar ao LIFE RPG.';

/** "Apostilas" (spec 2026-11-26 §5.1): the subject's study materials, newest change first; a tap opens one. */
export function StudyDocsPanel({ journeyId }: { journeyId: string }) {
  const settings = useSettings();
  const docs = useLiveQuery(async () => (await db.studyDocs.where('journeyId').equals(journeyId).toArray())
    .filter((d) => !d.deleted).sort((a, b) => b.updatedAt - a.updatedAt), [journeyId]);
  return (
    <Panel variant="stone" className="study-section stack">
      <h2 id="subject-docs" className="study__subtitle" tabIndex={-1}>Apostilas</h2>
      {docs === undefined || !settings ? null : docs.length === 0 ? <p className="muted">{DOCS_EMPTY}</p> : (
        <ul className="sdetail__list">
          {docs.map((d) => (
            <li key={d.id}>
              <Link className="sdetail__open studydocs__link" href={`/estudo/apostila/${d.id}`}>
                {`${d.title} · ${ddmm(dayKeyOf(d.updatedAt, settings.dayStartHour))} · ${d.source}`}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
