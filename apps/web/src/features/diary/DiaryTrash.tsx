import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'wouter';
import type { DiaryEntry } from '@life/shared';
import { diaryClock, diaryDayTitle, diaryPreview } from '@life/shared';
import { useDiaryTrash } from '../../db/diaryData';
import { emptyDiaryTrash, purgeDiaryEntry, restoreDiaryEntry } from '../../domain/diaryActions';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE, focusWhenGone } from '../../ui/focusAfter';
import { plural } from '../../ui/format';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { clearDiaryDraft } from './diaryDraft';
import './diary.css';

const toast = (msg: string) => useToast.getState().show(msg);

/** `/diario/apagadas`: Restaurar or Apagar de vez each entry, or Esvaziar. Nothing goes for good without a confirmation. */
export function DiaryTrashScreen() {
  const trashed = useDiaryTrash();
  const heading = useRef<HTMLHeadingElement>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const openAll = useRef<HTMLButtonElement>(null);
  const confirmAllBtn = useRef<HTMLButtonElement>(null);
  const cameFromAll = useRef(false);
  useEffect(() => {
    if (confirmAll) confirmAllBtn.current?.focus();
    else if (cameFromAll.current) {
      cameFromAll.current = false;
      openAll.current?.focus();
    }
  }, [confirmAll]);
  const toHeading = (e: MouseEvent<HTMLElement>) => focusWhenGone(e.currentTarget, () => heading.current);

  return (
    <section className="screen diary stack" aria-labelledby="diary-trash-title">
      <Link href="/diario" className="settings__back">‹ Diário</Link>
      <h1 id="diary-trash-title" ref={heading} tabIndex={-1} data-focus-target={FOCUS_PAGE}>Apagadas recentemente</h1>
      <p className="muted">
        Ficam aqui até você restaurar ou apagar de vez. Apagar de vez tira o texto deste aparelho e, ao sincronizar,
        do servidor; os backups do servidor ainda guardam o texto antigo por até 14 dias.
      </p>
      {trashed && trashed.length === 0 && <p className="muted">Nada aqui.</p>}
      {trashed && trashed.length > 0 && (
        <>
          {confirmAll ? (
            <div className="stack" role="group" aria-label="Confirmar esvaziar">
              <p>{`Apagar de vez ${plural(trashed.length, 'entrada', 'entradas')}? Não dá para desfazer.`}</p>
              <div className="cluster">
                <Button ref={confirmAllBtn} variant="primary" onClick={(e) => {
                  toHeading(e);
                  setConfirmAll(false);
                  safeRun(async () => {
                    const ids = await emptyDiaryTrash();
                    for (const id of ids) clearDiaryDraft(id); // its text leaves this device too
                    const n = ids.length;
                    if (n > 0) toast(n === 1 ? 'Entrada apagada de vez.' : 'Entradas apagadas de vez.');
                  });
                }}>Esvaziar</Button>
                <Button variant="ghost" onClick={() => { cameFromAll.current = true; setConfirmAll(false); }}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <div className="cluster"><Button ref={openAll} variant="ghost" icon="trash" onClick={() => setConfirmAll(true)}>Esvaziar</Button></div>
          )}
          <ul className="diary__list" aria-label="Entradas apagadas">
            {trashed.map((e) => <TrashRow key={e.id} entry={e} toHeading={toHeading} />)}
          </ul>
        </>
      )}
    </section>
  );
}

function TrashRow({ entry, toHeading }: { entry: DiaryEntry; toHeading(e: MouseEvent<HTMLElement>): void }) {
  const [confirm, setConfirm] = useState(false);
  const openBtn = useRef<HTMLButtonElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    if (confirm) confirmBtn.current?.focus();
    else if (cancelled.current) {
      cancelled.current = false;
      openBtn.current?.focus();
    }
  }, [confirm]);
  const when = `${diaryDayTitle(entry.day)} · ${diaryClock(entry.at)}`;
  return (
    <li className="diary-entry diary-trash__row">
      <span className="diary-entry__time">{when}</span>
      <span className="diary-entry__preview">{diaryPreview(entry.text)}</span>
      {confirm ? (
        <div className="stack" role="group" aria-label={`Confirmar apagar de vez a entrada de ${when}`}>
          <p>Apagar de vez? Não dá para desfazer.</p>
          <div className="cluster">
            <Button ref={confirmBtn} size="sm" variant="primary" onClick={(e) => {
              toHeading(e);
              safeRun(async () => {
                await purgeDiaryEntry(entry.id);
                clearDiaryDraft(entry.id); // its text leaves this device too
                toast('Entrada apagada de vez.');
              });
            }}>Apagar de vez</Button>
            <Button size="sm" variant="ghost" onClick={() => { cancelled.current = true; setConfirm(false); }}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <div className="cluster">
          <Button size="sm" aria-label={`Restaurar a entrada de ${when}`} onClick={(e) => {
            toHeading(e);
            safeRun(async () => {
              await restoreDiaryEntry(entry.id);
              toast('Entrada restaurada.');
            });
          }}>Restaurar</Button>
          <Button ref={openBtn} size="sm" variant="ghost" aria-label={`Apagar de vez a entrada de ${when}`} onClick={() => setConfirm(true)}>
            Apagar de vez
          </Button>
        </div>
      )}
    </li>
  );
}
