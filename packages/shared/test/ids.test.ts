import { describe, it, expect } from 'vitest';
import { ulid } from '../src/ids';

describe('ulid', () => {
  it('is 26 chars of Crockford base32', () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
  it('is time-sortable', () => {
    expect(ulid(1000) < ulid(2000)).toBe(true);
  });
  it('is unique across 1000 calls', () => {
    const set = new Set(Array.from({ length: 1000 }, () => ulid()));
    expect(set.size).toBe(1000);
  });
});
