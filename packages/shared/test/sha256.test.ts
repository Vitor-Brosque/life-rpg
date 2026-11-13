import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/sha256';

const enc = (s: string) => new TextEncoder().encode(s);

describe('sha256Hex', () => {
  it('matches the FIPS 180-4 vectors', () => {
    expect(sha256Hex(enc(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(sha256Hex(new Uint8Array(1_000_000).fill(0x61)))
      .toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
  it('agrees with node:crypto around the block edges', () => {
    for (const n of [55, 56, 63, 64, 65, 119, 120, 1000, 100_000]) {
      const b = randomBytes(n);
      expect(sha256Hex(new Uint8Array(b)), `len ${n}`).toBe(createHash('sha256').update(b).digest('hex'));
    }
  });
});
