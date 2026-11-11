const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 26-char ULID: 10 chars of time (ms) + 16 chars of randomness. */
export function ulid(now: number = Date.now()): string {
  let t = Math.floor(now);
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = ENCODING[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += ENCODING[bytes[i]! % 32];
  return time + rand;
}
