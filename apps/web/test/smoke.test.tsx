import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('web smoke', () => {
  it('renders a heading', () => {
    render(<h1>LIFE RPG</h1>);
    expect(screen.getByRole('heading', { name: 'LIFE RPG' })).toBeInTheDocument();
  });
});
