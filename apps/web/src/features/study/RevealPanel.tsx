import type { ReactNode } from 'react';
import { Link, useSearch } from 'wouter';
import { useLiveQuery } from 'dexie-react-hooks';
import type { CardFace, NoteSource } from '@life/shared';
import { db } from '../../db/db';
import { SpeakButton } from '../media/SpeakButton';
import { CodeView, Rich } from './Rich';

export interface RevealPanelProps {
  face: CardFace;
  answer: string;
  cloze: boolean;
  /** Topic cards: which key points the user ticked. */
  covered: boolean[];
  onToggle(index: number): void;
  speechLang?: string;
  /** PDFs da aula: the card was made from a PDF page ("Ver no PDF, p. N"). */
  source?: NoteSource;
}

/**
 * "Ver no PDF, p. 12" (spec 2026-11-26 §1.5): opens the reader at that page; nothing while the PDF is gone or unknown
 * here. The review's deck ("Revisar este baralho") goes along, so "← Revisão" comes back to the same review.
 */
export function PdfSourceLink({ source }: { source: NoteSource }) {
  const deck = new URLSearchParams(useSearch()).get('baralho');
  const exists = useLiveQuery(async () => {
    const f = await db.studyFiles.get(source.fileId);
    return !!f && !f.deleted;
  }, [source.fileId]);
  if (!exists) return null;
  const href = `/estudo/pdf/${source.fileId}?pagina=${source.page}&voltar=revisao${deck ? `&baralho=${encodeURIComponent(deck)}` : ''}`;
  return (
    <Link className="btn btn--ghost btn--sm reveal__source" href={href}>
      {`Ver no PDF, p. ${source.page}`}
    </Link>
  );
}

/** Key points of a topic as checkboxes, with "N de M cobertos". */
function Checklist({ points, covered, onToggle }: { points: string[]; covered: boolean[]; onToggle(i: number): void }) {
  const n = points.filter((_, i) => covered[i]).length;
  return (
    <fieldset className="checklist">
      <legend className="visually-hidden">Marque o que você cobriu</legend>
      {points.map((p, i) => (
        <label key={i} className="checklist__item">
          <input type="checkbox" checked={covered[i] ?? false} onChange={() => onToggle(i)} />
          <Rich text={p} className="checklist__text" />
        </label>
      ))}
      <p className="checklist__count" aria-live="polite">{n} de {points.length} cobertos</p>
    </fieldset>
  );
}

/**
 * The revealed side: the answer — a topic's key points to tick — next to the user's own answer
 * (rendered with Markdown and formulas; side by side on wide screens), plus "Por quê?".
 */
export function RevealPanel({ face, answer, cloze, covered, onToggle, speechLang, source }: RevealPanelProps) {
  const wrote = answer.trim() !== '';
  let correct: ReactNode = null;
  if (face.code) correct = <CodeView code={face.code.solution} lang={face.code.lang} />;
  else if (face.points) correct = <Checklist points={face.points} covered={covered} onToggle={onToggle} />;
  else if (!cloze) correct = <><Rich text={face.back} /><SpeakButton text={face.back} lang={speechLang} label="Ouvir a resposta" /></>;
  const mine = face.code ? <CodeView code={answer} lang={face.code.lang} /> : <Rich text={answer} className="reveal__mine" />;
  const mineLabel = face.points ? 'Sua explicação' : 'Sua resposta';
  const answerLabel = face.points ? 'Pontos-chave' : 'Resposta';
  return (
    <div className="reveal">
      <h2 id="reveal-heading" className="visually-hidden" tabIndex={-1}>Resposta revelada</h2>
      {wrote && correct ? (
        <div className="reveal__compare">
          <div><h3 className="reveal__label">{mineLabel}</h3>{mine}</div>
          <div><h3 className="reveal__label">{answerLabel}</h3>{correct}</div>
        </div>
      ) : face.points ? <div><h3 className="reveal__label">{answerLabel}</h3>{correct}</div> : correct}
      {wrote && !correct && <div><h3 className="reveal__label">{mineLabel}</h3>{mine}</div>}
      {face.extra && (
        <div className="reveal__extra"><h3 className="reveal__label">Por quê?</h3><Rich text={face.extra} /></div>
      )}
      {source && <div><PdfSourceLink source={source} /></div>}
    </div>
  );
}
