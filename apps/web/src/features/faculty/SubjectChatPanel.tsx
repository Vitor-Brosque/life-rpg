import { useEffect, useState, type FormEvent } from 'react';
import { openableChatUrl } from '@life/shared';
import { FacultyValidationError, setSubjectChatUrl } from '../../domain/facultyActions';
import { buildPasteRequest } from '../../domain/proposalActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import { FAILURE_TOAST, safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { PasteButtons } from '../assist/PasteConnectorless';

const HEADING_ID = 'subject-chat';
const heading = () => document.getElementById(HEADING_ID);

/**
 * "Chat da disciplina" (spec 2026-11-25-estudo-pelos-chats §2.9): the subject's chat link, pasted by hand (the chat
 * does not know its own address), and the study request by copy and paste. The link never goes to an assistant.
 */
export function SubjectChatPanel({ journeyId, title, chatUrl }: { journeyId: string; title: string; chatUrl?: string }) {
  // The saved link shown right away; the prop catches up when the live query fires, so no stale link flashes.
  const [shown, setShown] = useState(chatUrl);
  useEffect(() => { setShown(chatUrl); }, [chatUrl]);
  const url = openableChatUrl({ chatUrl: shown });
  const [editing, setEditing] = useState(false);
  return (
    <Panel variant="stone" className="study-section stack">
      <h2 id={HEADING_ID} className="study__subtitle" tabIndex={-1}>Chat da disciplina</h2>
      {url && !editing ? (
        <div className="faculty-actions">
          <a className="btn btn--secondary btn--md" href={url} target="_blank" rel="noopener noreferrer">Abrir chat</a>
          <Button onClick={() => setEditing(true)}>Trocar link</Button>
        </div>
      ) : (
        <ChatLinkForm journeyId={journeyId} initial={shown ?? ''} onSaved={(saved) => { setShown(saved); setEditing(false); }}
          {...(url ? { onCancel: () => setEditing(false) } : {})} />
      )}
      <PasteButtons copyLabel="Copiar pedido de estudo" from={`/estudo/materias/${journeyId}`} buildRequest={() => buildPasteRequest(title)}
        copiedText="Pedido copiado. Cole no chat da disciplina." />
      <p className="muted">Com o conector ligado, peça no chat: manda para o LIFE RPG o que vimos aqui.</p>
    </Panel>
  );
}

function ChatLinkForm({ journeyId, initial, onSaved, onCancel }: {
  journeyId: string; initial: string; onSaved: (chatUrl: string | undefined) => void; onCancel?: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (value.trim() === '' && initial.trim() === '') { setError('Cole o link do chat ou do projeto.'); return; }
    try {
      const saved = await setSubjectChatUrl(journeyId, value);
      focusWhenGone(form, heading);
      if (saved.chatUrl) useToast.getState().show('Link do chat salvo.');
      else {
        useToast.getState().show('Link do chat removido.', initial.trim() === '' ? undefined : {
          label: 'Desfazer', run: () => safeRun(async () => { onSaved((await setSubjectChatUrl(journeyId, initial)).chatUrl); }),
        });
      }
      onSaved(saved.chatUrl);
    } catch (err) {
      if (err instanceof FacultyValidationError) setError(err.message);
      else { console.error('chat link save failed', err); useToast.getState().show(FAILURE_TOAST); }
    }
  };
  return (
    <form className="sdetail__add" noValidate onSubmit={(e) => { void submit(e); }}>
      <label className="field">
        <span className="field__label">Link do chat ou do projeto</span>
        <input type="url" inputMode="url" value={value} autoComplete="off" spellCheck={false} enterKeyHint="done"
          autoFocus={onCancel !== undefined} placeholder="https://"
          onChange={(e) => { setValue(e.target.value); setError(undefined); }} />
      </label>
      <Button type="submit">Salvar</Button>
      {onCancel && (
        <Button variant="ghost" onClick={(e) => { focusWhenGone(e.currentTarget, heading); onCancel(); }}>Cancelar</Button>
      )}
      {error && <p role="alert" className="faculty-form__error">{error}</p>}
    </form>
  );
}
