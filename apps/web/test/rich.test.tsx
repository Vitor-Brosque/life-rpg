import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CLOZE_CLOSE, CLOZE_HIDDEN, CLOZE_OPEN } from '@life/shared';
import { CodeView, Rich, loadKatex } from '../src/features/study/Rich';

describe('Rich', () => {
  it('renders the Markdown subset as elements', () => {
    const { container } = render(<Rich text={'**negrito** e *itálico* com `x`\n\n- um\n- dois'} />);
    expect(container.querySelector('strong')).toHaveTextContent('negrito');
    expect(container.querySelector('em')).toHaveTextContent('itálico');
    expect(container.querySelector('code.rich__code')).toHaveTextContent('x');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
  });

  it('highlights fenced code and keeps it in a <pre>', () => {
    const { container } = render(<Rich text={'```python\ndef f():\n    return 1\n```'} />);
    expect(container.querySelector('.tok--keyword')).toHaveTextContent('def');
    expect(container.querySelector('pre')!.textContent).toBe('def f():\n    return 1');
  });

  it('never renders HTML from the text', () => {
    const { container } = render(<Rich text={'<img src=x onerror="alert(1)"> <b>oi</b>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container).toHaveTextContent('<img src=x');
  });

  it('marks cloze spans, also across inline nodes and inside code', () => {
    const { container } = render(<Rich text={`O ${CLOZE_OPEN}${CLOZE_HIDDEN}${CLOZE_CLOSE} e ${CLOZE_OPEN}**a** b${CLOZE_CLOSE}`} />);
    expect([...container.querySelectorAll('mark.cloze')].map((m) => m.textContent)).toEqual(['[…]', 'a', ' b']);
    const code = render(<CodeView code={`x = ${CLOZE_OPEN}42${CLOZE_CLOSE}`} lang="python" />);
    expect(code.container.querySelector('mark.cloze')).toHaveTextContent('42');
  });

  it('renders formulas with KaTeX, and the source when the formula is invalid', async () => {
    const { container } = render(<Rich text={'área $\\pi r^2$'} />);
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());
    const bad = render(<Rich text={'$\\frac{a$'} />);
    await act(async () => { await loadKatex(); });
    expect(bad.container.querySelector('.katex')).toBeNull();
    expect(bad.container.querySelector('.rich__math-src')).toHaveTextContent('$\\frac{a$');
  });
});
