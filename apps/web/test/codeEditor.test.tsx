import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { CodeEditor } from '../src/features/study/CodeEditor';
import { indentLines, newlineIndent } from '../src/features/study/codeEdit';

describe('codeEdit', () => {
  it('Tab at a collapsed cursor inserts 4 spaces', () => {
    expect(indentLines('ab', 1, 1, false)).toEqual({ value: 'a    b', start: 5, end: 5 });
  });
  it('Tab over a selection indents every touched line', () => {
    expect(indentLines('x\ny\nz', 0, 3, false)).toEqual({ value: '    x\n    y\nz', start: 4, end: 11 });
  });
  it('Shift+Tab removes up to 4 spaces (or one tab) per line', () => {
    expect(indentLines('      a\n  b\n\tc', 0, 14, true)).toEqual({ value: '  a\nb\nc', start: 0, end: 7 });
    expect(indentLines('    a', 5, 5, true)).toEqual({ value: 'a', start: 1, end: 1 });
  });
  it('treats position 0 as the start of the first line even when it is empty', () => {
    expect(indentLines('\nfoo', 0, 0, true)).toEqual({ value: '\nfoo', start: 0, end: 0 });
    expect(indentLines('\nfoo', 0, 4, false)).toEqual({ value: '    \n    foo', start: 4, end: 12 });
  });
  it('Enter keeps the indentation of the line', () => {
    expect(newlineIndent('    x = 1', 9, 9)).toEqual({ value: '    x = 1\n    ', start: 14, end: 14 });
  });
});

function Harness({ initial = '', readOnly = false }: { initial?: string; readOnly?: boolean }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <CodeEditor label="Solução" value={v} onChange={setV} readOnly={readOnly} />
      <output data-testid="v">{v}</output>
    </>
  );
}

describe('CodeEditor', () => {
  it('Tab indents instead of moving focus; Esc leaves the editor', () => {
    render(<Harness initial="x" />);
    const ta = screen.getByLabelText('Solução') as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(0, 0);
    fireEvent.keyDown(ta, { key: 'Tab' });
    expect(screen.getByTestId('v').textContent).toBe('    x');
    expect(document.activeElement).toBe(ta);
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(document.activeElement).not.toBe(ta);
    expect(screen.getByText(/Esc para sair/)).toBeInTheDocument();
  });
  it('read-only ignores Tab and hides the hint', () => {
    render(<Harness initial="x" readOnly />);
    fireEvent.keyDown(screen.getByLabelText('Solução'), { key: 'Tab' });
    expect(screen.getByTestId('v').textContent).toBe('x');
    expect(screen.queryByText(/Esc para sair/)).toBeNull();
  });
});
