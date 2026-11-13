import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useLiveQuery } from 'dexie-react-hooks';
import type { CardSuggestion, Deck, ID, SuggestionErrors } from '@life/shared';
import { AI_LIMITS, cardsPrompt, suggestionErrors } from '@life/shared';
import { AI_ERROR_COPY, askCards } from '../../ai/aiClient';
import { AiSent, AiTag } from '../../ai/AiSent';
import { db } from '../../db/db';
import { saveNote } from '../../domain/studyActions';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { FieldError } from '../routine/BlockFields';

// "Sugerir cards" (spec §6.4): the AI proposes, the user edits and accepts one by one. Accepted
// suggestions become drafts (Marco 3); nothing reaches the review on its own.

export interface SuggestCardsSheetProps {
  open: boolean;
  onClose(): void;
  initialText?: string;
  deckId?: ID;
}

type Status = 'pending' | 'saved' | 'discarded';
interface Item { n: number; s: CardSuggestion; status: Status; noteId?: ID; errors?: SuggestionErrors }

const TYPE_TITLE: Record<CardSuggestion['type'], string> = { basic: 'Pergunta e resposta', cloze: 'Lacunas' };
const fmt = (n: number): string => n.toLocaleString('pt-BR');

export function SuggestCardsSheet(props: SuggestCardsSheetProps) {
  return (
    <Sheet open={props.open} onClose={props.onClose} title="Sugerir cards" placement="top">
      <SuggestBody {...props} />
    </Sheet>
  );
}

function SuggestBody({ initialText = '', deckId: initialDeck = '' }: SuggestCardsSheetProps) {
  const decks = useLiveQuery(
    async () => (await db.decks.filter((d) => !d.deleted && !d.archived).toArray()).sort((a, b) => a.order - b.order),
    [], [] as Deck[],
  );
  const [text, setText] = useState(initialText);
  const [deckId, setDeckId] = useState<string>(initialDeck);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [items, setItems] = useState<Item[]>();
  const textId = useId();
  const countId = useId();
  const deckSelId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLButtonElement>(null);
  // A failed ask leaves the button disabled for seconds: focus comes back to it afterwards.
  const refocusAsk = useRef(false);
  const saving = useRef(new Set<number>());
  const stage = items ? 'list' : 'text';
  const firstStage = useRef(true);

  // Switching stage removes the tapped button: put focus on the new stage, never on <body>.
  useEffect(() => {
    if (firstStage.current) { firstStage.current = false; return; }
    (stage === 'list' ? stageRef.current : textRef.current)?.focus();
  }, [stage]);

  useEffect(() => {
    if (refocusAsk.current && !busy) {
      refocusAsk.current = false;
      askRef.current?.focus();
    }
  });

  // An archived or deleted deck counts as the inbox.
  const deck = decks.find((d) => d.id === deckId);
  const deckName = deck?.name ?? '';
  const tooLong = text.length > AI_LIMITS.cardsSource;

  const ask = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await askCards({ text, deckName });
      if (!r.ok) { refocusAsk.current = true; setError(AI_ERROR_COPY[r.error]); return; }
      saving.current.clear();
      setItems(r.data.cards.map((s, i) => ({ n: i + 1, s, status: 'pending' })));
    } finally {
      setBusy(false);
    }
  };

  const update = (n: number, change: Partial<Item>): void =>
    setItems((list) => list?.map((it) => (it.n === n ? { ...it, ...change } : it)));

  const accept = async (it: Item): Promise<void> => {
    const errors = suggestionErrors(it.s);
    if (Object.keys(errors).length > 0) { update(it.n, { errors }); return; }
    if (saving.current.has(it.n)) return;
    saving.current.add(it.n);
    try {
      const note = await saveNote({
        type: it.s.type,
        front: it.s.front,
        back: it.s.type === 'cloze' ? '' : it.s.back,
        extra: it.s.extra.trim() || undefined,
        deckId: deck?.id,
        draft: true,
      });
      update(it.n, { status: 'saved', noteId: note.id, errors: undefined });
      useToast.getState().show('Rascunho de card salvo');
    } catch (e) {
      saving.current.delete(it.n);
      console.error('save suggestion failed', e);
      setError('Não foi possível salvar. Tente de novo.');
    }
  };

  if (!items) {
    return (
      <div className="stack suggest">
        <label className="field" htmlFor={textId}>
          <span className="field__label">Texto de origem</span>
          <textarea id={textId} ref={textRef} rows={8} value={text} aria-describedby={countId}
            placeholder="Cole um trecho de aula, de documentação ou um resumo." onChange={(e) => setText(e.target.value)} />
        </label>
        <p id={countId} className="ai-note">
          {tooLong
            ? `Texto longo demais: até ${fmt(AI_LIMITS.cardsSource)} caracteres.`
            : `${fmt(text.length)} de ${fmt(AI_LIMITS.cardsSource)} caracteres`}
        </p>
        <label className="field" htmlFor={deckSelId}>
          <span className="field__label">Rascunhos vão para</span>
          <select id={deckSelId} value={deck?.id ?? ''} onChange={(e) => setDeckId(e.target.value)}>
            <option value="">Caixa de entrada</option>
            {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <p className="ai-note">
          A IA propõe até 5 cards curtos, um fato por card. Nada entra na revisão: cada card aceito vira rascunho em
          Estudo → Rascunhos para completar.
        </p>
        <AiSent text={cardsPrompt({ text, deckName })} note="Vão só o texto acima e o nome do baralho." />
        <div className="suggest__actions">
          <Button ref={askRef} variant="primary" disabled={!text.trim() || tooLong || busy} onClick={() => safeRun(ask())}>
            {busy ? 'Pensando…' : 'Pedir sugestões'}
          </Button>
        </div>
        {error && <p role="alert" className="ai-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="stack suggest suggest__stage" ref={stageRef} tabIndex={-1}>
      {items.length === 0 ? (
        <p>A IA não encontrou bons cards neste texto. Tente um trecho com mais conteúdo.</p>
      ) : (
        <>
          <p className="ai-note"><AiTag /> Gerado por IA: confira cada card antes de aceitar, porque pode ter erros.</p>
          <ol className="suggest__list">
            {items.map((it) => (
              <SuggestionItem key={it.n} item={it}
                onChange={(s) => update(it.n, { s, errors: undefined })}
                onAccept={() => safeRun(accept(it))}
                onDiscard={() => update(it.n, { status: 'discarded' })}
                onUndo={() => update(it.n, { status: 'pending' })} />
            ))}
          </ol>
          {items.every((it) => it.status !== 'pending') && (
            <p role="status">Pronto. Os rascunhos estão em Estudo → Rascunhos para completar.</p>
          )}
        </>
      )}
      <div className="suggest__actions">
        <Button variant="ghost" onClick={() => { setError(undefined); setItems(undefined); }}>Voltar ao texto</Button>
      </div>
      {error && <p role="alert" className="ai-error">{error}</p>}
    </div>
  );
}

function SuggestionItem({ item, onChange, onAccept, onDiscard, onUndo }: {
  item: Item; onChange(s: CardSuggestion): void; onAccept(): void; onDiscard(): void; onUndo(): void;
}) {
  const id = useId();
  const { n, s, errors } = item;
  const liRef = useRef<HTMLLIElement>(null);
  const prevStatus = useRef(item.status);

  // The tapped button disappears when the status changes: the item itself takes focus.
  useEffect(() => {
    if (prevStatus.current === item.status) return;
    prevStatus.current = item.status;
    liRef.current?.focus();
  }, [item.status]);

  if (item.status === 'discarded') {
    return (
      <li ref={liRef} tabIndex={-1} className="suggest__item suggest__item--done">
        <span className="suggest__done">{`Card ${n} descartado.`} <Button size="sm" variant="ghost" onClick={onUndo}>Desfazer</Button></span>
      </li>
    );
  }
  if (item.status === 'saved') {
    return (
      <li ref={liRef} tabIndex={-1} className="suggest__item suggest__item--done">
        <span className="suggest__done">
          Rascunho salvo · <Link href={`/estudo/nota/${item.noteId}`} aria-label={`Abrir rascunho do card ${n}`}>abrir</Link>
        </span>
      </li>
    );
  }
  // Hint and error stay outside the <label>, so the field's accessible name is just its label.
  const field = (key: keyof Pick<CardSuggestion, 'front' | 'back' | 'extra'>, label: string, rows: number, hint?: string) => (
    <div className="suggest__field">
      <label className="field" htmlFor={`${id}-${key}`}>
        <span className="field__label">{label}</span>
        <textarea id={`${id}-${key}`} rows={rows} value={s[key]} aria-describedby={`${id}-${key}-error`}
          onChange={(e) => onChange({ ...s, [key]: e.target.value })} />
      </label>
      {hint && <p className="ai-note">{hint}</p>}
      {key !== 'extra' && <FieldError id={`${id}-${key}-error`} text={errors?.[key]} />}
    </div>
  );
  return (
    <li ref={liRef} tabIndex={-1} className="suggest__item">
      <h3 className="suggest__title">{`Card ${n} · ${TYPE_TITLE[s.type]}`}</h3>
      {s.type === 'basic'
        ? <>{field('front', 'Pergunta', 2)}{field('back', 'Resposta', 2)}</>
        : field('front', 'Texto com lacunas', 3, 'Lacunas: {{1::trecho}}')}
      {field('extra', 'Por quê? (opcional)', 2)}
      <div className="suggest__actions">
        <Button size="sm" variant="primary" aria-label={`Aceitar card ${n} como rascunho`} onClick={onAccept}>
          Aceitar como rascunho
        </Button>
        <Button size="sm" variant="ghost" aria-label={`Descartar card ${n}`} onClick={onDiscard}>Descartar</Button>
      </div>
    </li>
  );
}
