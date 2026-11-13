import { useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode, type RefObject } from 'react';
import type { MediaKind } from '@life/shared';
import { insertMediaRef } from '@life/shared';
import { MediaInputError, saveMediaBlob } from '../../db/media';
import { Button } from '../../ui/Button';
import { FAILURE_TOAST } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { AudioSheet, saveAudioFile } from './AudioSheet';
import { DrawingSheet } from './DrawingSheet';
import { compressImage } from './imageCompress';
import './media.css';

export const FIELD_STATUS = {
  preparing: 'Preparando imagem…',
  image: 'Imagem adicionada.',
  drawing: 'Desenho adicionado.',
  audio: 'Áudio adicionado.',
} as const;
export const DROP_UNSUPPORTED = 'Arraste uma imagem ou um áudio.';

export interface MarkdownFieldProps {
  /** id of the textarea ('note-front'): labels, errors and tests use it. */
  id: string;
  /** Visible label ('Pontos-chave (um por linha)'). */
  label: string;
  /** Short name in the tool buttons' accessible names ('Pontos-chave'). */
  name: string;
  value: string;
  onChange(value: string): void;
  rows: number;
  /** The editor's status line ("Preparando imagem…", "Imagem adicionada."). */
  onStatus(message: string): void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  describedBy?: string;
  placeholder?: string;
  /** Tools before the media buttons (the cloze "Lacuna"). */
  tools?: ReactNode;
  /** Under the textarea: hints and the field error. */
  children?: ReactNode;
}

const firstFile = (files: ArrayLike<File> | null | undefined, prefix: string): File | undefined =>
  Array.from(files ?? []).find((f) => f.type.startsWith(prefix));

/** An image/* file, or a single file without a type (compressImage checks its signature). */
const candidate = (files: ArrayLike<File> | null | undefined): File | undefined => {
  const list = Array.from(files ?? []);
  return list.find((f) => f.type.startsWith('image/')) ?? (list.length === 1 && list[0]!.type === '' ? list[0] : undefined);
};

function showError(e: unknown, what: string): void {
  if (e instanceof MediaInputError) {
    useToast.getState().show(e.message);
    return;
  }
  console.error(`${what} failed`, e);
  useToast.getState().show(FAILURE_TOAST);
}

/** A Markdown textarea of the note editor with Imagem and Desenho, paste and drop (spec §6.2). */
export function MarkdownField({
  id, label, name, value, onChange, rows, onStatus, textareaRef, describedBy, placeholder, tools, children,
}: MarkdownFieldProps) {
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? own;
  const fileId = `${id}-image-file`;
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [sheet, setSheet] = useState<'drawing' | 'audio' | undefined>(undefined);

  /** The reference at the cursor (end of the text when the field never had focus), label selected. */
  const insert = (kind: MediaKind, hash: string, defaultLabel?: string): void => {
    const el = ref.current;
    const text = el?.value ?? value;
    const r = insertMediaRef(text, el?.selectionStart ?? text.length, el?.selectionEnd ?? text.length, kind, hash, defaultLabel);
    onChange(r.text);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(r.selStart, r.selEnd); });
  };

  const addImage = async (file: Blob): Promise<void> => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    onStatus(FIELD_STATUS.preparing);
    try {
      const info = await saveMediaBlob(await compressImage(file));
      insert('image', info.hash);
      onStatus(FIELD_STATUS.image); // after onChange: the editor's set() clears the status
    } catch (e) {
      onStatus('');
      showError(e, 'image');
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const addAudio = async (file: Blob): Promise<void> => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      insert('audio', (await saveAudioFile(file)).hash);
      onStatus(FIELD_STATUS.audio);
    } catch (e) {
      showError(e, 'audio');
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const file = candidate(e.clipboardData?.files);
    if (!file) return; // text: the browser pastes it
    e.preventDefault();
    if (working.current) return;
    void addImage(file);
  };
  const onDragOver = (e: DragEvent<HTMLTextAreaElement>): void => {
    if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
  };
  const onDrop = (e: DragEvent<HTMLTextAreaElement>): void => {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return; // dragged text: the browser handles it
    e.preventDefault();
    if (working.current) return;
    const image = candidate(files);
    if (image) { void addImage(image); return; }
    const audio = firstFile(files, 'audio/');
    if (audio) { void addAudio(audio); return; }
    useToast.getState().show(DROP_UNSUPPORTED);
  };

  return (
    <div className="field markdown-field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <div className="markdown-field__tools">
        {tools}
        <Button size="sm" variant="ghost" icon="image" disabled={busy} aria-label={`Inserir imagem em ${name}`}
          onClick={() => document.getElementById(fileId)?.click()}>Imagem</Button>
        <Button size="sm" variant="ghost" icon="pen" disabled={busy} aria-label={`Inserir desenho em ${name}`}
          onClick={() => setSheet('drawing')}>Desenho</Button>
        <Button size="sm" variant="ghost" icon="mic" disabled={busy} aria-label={`Inserir áudio em ${name}`}
          onClick={() => setSheet('audio')}>Áudio</Button>
      </div>
      <input id={fileId} type="file" accept="image/*" className="visually-hidden" tabIndex={-1} disabled={busy}
        aria-label={`Arquivo de imagem para ${name}`}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = ''; // the same file again fires change again
          if (file) void addImage(file);
        }} />
      <textarea id={id} ref={ref} rows={rows} value={value} placeholder={placeholder} aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)} onPaste={onPaste} onDragOver={onDragOver} onDrop={onDrop} />
      {children}
      <DrawingSheet open={sheet === 'drawing'} onClose={() => setSheet(undefined)}
        onInsert={(hash) => {
          setSheet(undefined);
          insert('image', hash, 'desenho');
          onStatus(FIELD_STATUS.drawing);
        }} />
      <AudioSheet open={sheet === 'audio'} onClose={() => setSheet(undefined)}
        onInsert={(hash) => {
          setSheet(undefined);
          insert('audio', hash);
          onStatus(FIELD_STATUS.audio);
        }} />
    </div>
  );
}
