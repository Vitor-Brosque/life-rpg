import { describe, it, expect } from 'vitest';
import { shouldAccept } from '../src/merge';

describe('shouldAccept', () => {
  it('accepts when no existing', () => expect(shouldAccept({ updatedAt: 5 })).toBe(true));
  it('accepts newer', () => expect(shouldAccept({ updatedAt: 5 }, { updatedAt: 4 })).toBe(true));
  it('keeps existing on tie', () => expect(shouldAccept({ updatedAt: 5 }, { updatedAt: 5 })).toBe(false));
  it('rejects older', () => expect(shouldAccept({ updatedAt: 4 }, { updatedAt: 5 })).toBe(false));
});
