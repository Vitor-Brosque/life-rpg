import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import type { CodeLang } from '@life/shared';
import { CodeEditor, codeEditorOptions, loadCodeMirror } from '../src/features/study/CodeEditor';

// The real CodeMirror under jsdom. jsdom has no layout: CodeMirror measures text through Range
// rectangles, which jsdom lacks, so they are stubbed as empty.
beforeAll(async () => {
  if (!('getClientRects' in Range.prototype)) {
    const empty = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) };
    Object.assign(Range.prototype, {
      getClientRects: () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }),
      getBoundingClientRect: () => empty,
    });
  }
  codeEditorOptions.enhanced = true;
  await loadCodeMirror(); // warm the chunk once
});
afterAll(() => { codeEditorOptions.enhanced = false; });

function Harness({ initial = '', readOnly = false, language = 'python' }: { initial?: string; readOnly?: boolean; language?: CodeLang }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <CodeEditor label="Solução" value={v} onChange={setV} readOnly={readOnly} language={language} />
      <button type="button" onClick={() => setV('')}>Limpar</button>
      <output data-testid="v">{v}</output>
    </>
  );
}

async function editor(): Promise<HTMLElement> {
  await waitFor(() => expect(document.querySelector('.cm-content')).not.toBeNull());
  return document.querySelector<HTMLElement>('.cm-content')!;
}
const docOf = (el: HTMLElement): string => EditorView.findFromDOM(el)!.state.doc.toString();

describe('CodeEditor with CodeMirror', () => {
  it('replaces the textarea, keeps the label and highlights Python', async () => {
    render(<Harness initial={'def f():\n    return 1'} />);
    const el = await editor();
    expect(document.querySelector('textarea')).toBeNull();
    expect(screen.getByLabelText('Solução')).toBe(el);
    expect(el.querySelector('.tok--keyword')?.textContent).toBe('def');
    expect(document.querySelector('.cm-lineNumbers')).not.toBeNull();
    expect(screen.getByText(/Esc para sair/)).toBeInTheDocument();
  });

  it('Tab inserts 4 spaces at the cursor, Shift+Tab outdents, Esc is handled and leaves', async () => {
    render(<Harness initial="x" />);
    const el = await editor();
    const view = EditorView.findFromDOM(el)!;
    act(() => { view.dispatch({ selection: { anchor: 0 } }); view.focus(); });
    fireEvent.keyDown(el, { key: 'Tab', code: 'Tab', keyCode: 9 });
    expect(screen.getByTestId('v').textContent).toBe('    x');
    fireEvent.keyDown(el, { key: 'Tab', code: 'Tab', keyCode: 9, shiftKey: true });
    expect(screen.getByTestId('v').textContent).toBe('x');
    // fireEvent returns false when a handler called preventDefault: our Esc binding ran.
    expect(fireEvent.keyDown(el, { key: 'Escape', code: 'Escape', keyCode: 27 })).toBe(false);
    expect(document.activeElement).not.toBe(el);
  });

  it('leaves Ctrl+Enter to the screen', async () => {
    render(<Harness initial="x" />);
    const el = await editor();
    expect(fireEvent.keyDown(el, { key: 'Enter', code: 'Enter', keyCode: 13, ctrlKey: true })).toBe(true);
    expect(docOf(el)).toBe('x');
  });

  it('follows an outside value change and a language change', async () => {
    const { rerender } = render(<CodeEditor label="Solução" value="SELECT 1" onChange={() => {}} language="text" />);
    const el = await editor();
    expect(el.querySelector('.tok--keyword')).toBeNull();
    rerender(<CodeEditor label="Solução" value="SELECT 1" onChange={() => {}} language="sql" />);
    await waitFor(() => expect(el.querySelector('.tok--keyword')?.textContent).toBe('SELECT'));
    rerender(<CodeEditor label="Solução" value="" onChange={() => {}} language="sql" />);
    expect(docOf(el)).toBe('');
  });

  it('a cleared value (Salvar e próximo) empties the editor without echoing onChange', async () => {
    render(<Harness initial="print(1)" />);
    const el = await editor();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    await waitFor(() => expect(docOf(el)).toBe(''));
    expect(screen.getByTestId('v').textContent).toBe('');
  });

  it('read-only: not editable, Tab not captured, no hint', async () => {
    render(<Harness initial="x" readOnly />);
    const el = await editor();
    expect(el.getAttribute('contenteditable')).toBe('false');
    expect(el.getAttribute('aria-readonly')).toBe('true');
    expect(fireEvent.keyDown(el, { key: 'Tab', code: 'Tab', keyCode: 9 })).toBe(true);
    expect(screen.getByTestId('v').textContent).toBe('x');
    expect(screen.queryByText(/Esc para sair/)).toBeNull();
  });
});
