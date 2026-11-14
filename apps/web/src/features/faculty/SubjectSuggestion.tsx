import { useId, useMemo, useState } from 'react';
import { Link } from 'wouter';
import type { BlockOccurrence, DayKey } from '@life/shared';
import { facultyAreaOf, isFacultyBlock, subjectHead, subjectJourneys, subjectSuggestions, weekdayOf } from '@life/shared';
import { useDayMode, useDayState } from '../../db/hooks';
import { useFacultyData, type FacultyData } from '../../db/facultyData';
import { pickSubject } from '../../domain/facultyActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { useProblemSetSheet } from './ProblemSetSheet';
import './faculty.css';

const headingEl = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-subject-heading]');

/** The subject's first deck that still has live, unsuspended cards. */
function reviewDeck(data: FacultyData, journeyId: string) {
  return data.contact.decks
    .filter((d) => !d.deleted && !d.archived && d.journeyId === journeyId)
    .sort((a, b) => a.order - b.order)
    .find((d) => data.contact.cards.some((c) => !c.deleted && !c.suspended && c.deckId === d.id));
}

/**
 * "Sugestão para este bloco" in a Faculdade block: a subject and why (Usar / Trocar); after Usar, the
 * subject's next mission (or its deck / "Registrar exercícios") with "Escolher outra". Nothing is saved
 * before Usar, and no mission is ever created. Weekends and free days show nothing.
 */
export function SubjectSuggestion({ current, today }: { current: BlockOccurrence; today: DayKey }) {
  const data = useFacultyData();
  const state = useDayState();
  const mode = useDayMode();
  const labelId = useId();
  const blockId = current.block.id;
  const [cursor, setCursor] = useState<{ blockId: string; index: number }>({ blockId, index: 0 });
  const index = cursor.blockId === blockId ? cursor.index : 0;

  const subjects = useMemo(() => (data ? subjectJourneys(data.journeys) : []), [data]);
  const suggestions = useMemo(() => (data && mode !== 'free' && data.today === today
    ? subjectSuggestions({
      today, journeys: data.journeys, missions: data.missions, commitments: data.commitments,
      contact: data.contact, restDays: data.restDays,
    }) : []), [data, today, mode]);

  if (!data || mode === 'free') return null;
  const weekday = weekdayOf(today);
  if (weekday === 0 || weekday === 6 || subjects.length === 0) return null;
  if (!isFacultyBlock(current.block, facultyAreaOf(data.areas)?.id, data.journeys)) return null;

  const pickedId = state?.subjectPicks?.[blockId];
  const picked = pickedId ? subjects.find((j) => j.id === pickedId) : undefined;

  if (picked) {
    const head = subjectHead(data.missions, picked.id);
    const deck = head ? undefined : reviewDeck(data, picked.id);
    return (
      <Panel variant="stone" role="region" aria-labelledby={labelId} className="subject-suggestion">
        <p id={labelId} className="subject-suggestion__label">Disciplina deste bloco</p>
        <h3 className="subject-suggestion__title" tabIndex={-1} data-subject-heading>{picked.title}</h3>
        {head ? (
          <p className="subject-suggestion__line">{`Próxima missão: ${head.title}`}</p>
        ) : (
          <>
            <p className="subject-suggestion__line">{`Sem missão aberta em ${picked.title}.`}</p>
            <div className="subject-suggestion__actions">
              {deck && <Link className="subject__action" href={`/estudo/revisar?baralho=${deck.id}`}>{`Revisar ${deck.name}`}</Link>}
              <Button onClick={() => useProblemSetSheet.getState().open({ journeyId: picked.id })}>Registrar exercícios</Button>
            </div>
          </>
        )}
        <div className="subject-suggestion__actions">
          <Button variant="ghost" onClick={(e) => {
            focusWhenGone(e.currentTarget, headingEl);
            safeRun(() => pickSubject(blockId, null));
          }}>Escolher outra</Button>
        </div>
      </Panel>
    );
  }

  if (suggestions.length === 0) return null;
  const s = suggestions[index % suggestions.length]!;
  return (
    <Panel variant="stone" role="region" aria-labelledby={labelId} className="subject-suggestion">
      <p id={labelId} className="subject-suggestion__label">Sugestão para este bloco</p>
      <h3 className="subject-suggestion__title" tabIndex={-1} data-subject-heading>{`${s.journey.title} — ${s.text}`}</h3>
      <div className="subject-suggestion__actions">
        <Button variant="primary" onClick={(e) => {
          focusWhenGone(e.currentTarget, headingEl);
          safeRun(async () => {
            await pickSubject(blockId, s.journey.id);
            useToast.getState().show(`Bloco com ${s.journey.title}.`);
          });
        }}>Usar</Button>
        <Button aria-label="Trocar sugestão" disabled={suggestions.length < 2}
          onClick={() => setCursor({ blockId, index: (index + 1) % suggestions.length })}>Trocar</Button>
      </div>
    </Panel>
  );
}
