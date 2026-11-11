import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHRASES, pickPhrase, type PhraseCategory } from '../src/features/companion/phrases';
import { useCompanion } from '../src/features/companion/store';
import { db } from '../src/db/db';
import { ensureSeed } from '../src/db/seed';

const CATEGORIES = Object.keys(PHRASES) as PhraseCategory[];

describe('phrases', () => {
  it('covers every category with at least 4 phrases and no guilt words', () => {
    expect(CATEGORIES.sort()).toEqual([
      'complete', 'drop', 'empty', 'focusDone', 'greetAfternoon', 'greetMorning', 'greetNight',
      'hardDay', 'levelUp', 'postponed', 'review', 'shrink', 'snooze', 'start',
    ]);
    for (const cat of CATEGORIES) {
      expect(PHRASES[cat].length, cat).toBeGreaterThanOrEqual(4);
      for (const p of PHRASES[cat]) {
        expect(p.toLowerCase(), `${cat}: ${p}`).not.toMatch(/deveria|falhou/);
      }
    }
  });

  it('pickPhrase never repeats the last phrase', () => {
    for (const cat of CATEGORIES) {
      let last: string | undefined;
      for (let i = 0; i < 100; i++) {
        const next = pickPhrase(cat, last, { name: 'Vitor' });
        expect(next).not.toBe(last);
        last = next;
      }
    }
  });

  it('pickPhrase is safe with a random source that returns 1 or 0', () => {
    expect(PHRASES.complete).toContain(pickPhrase('complete', undefined, {}, () => 0));
    expect(typeof pickPhrase('complete', undefined, {}, () => 1)).toBe('string');
  });

  it('fills {name} and drops it cleanly when there is no name', () => {
    for (const cat of CATEGORIES) {
      for (let i = 0; i < PHRASES[cat].length; i++) {
        const rnd = () => i / PHRASES[cat].length;
        const withName = pickPhrase(cat, undefined, { name: 'Vitor' }, rnd);
        const without = pickPhrase(cat, undefined, {}, rnd);
        expect(withName).not.toMatch(/[{}]/);
        expect(without).not.toMatch(/[{}]|Vitor|, [!.?]| [!.?]$/);
      }
    }
  });
});

describe('useCompanion', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await ensureSeed();
    useCompanion.getState().clear();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('says a phrase and clears it after 6 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await useCompanion.getState().say('complete');
    const msg = useCompanion.getState().message;
    expect(msg).toBeTruthy();
    vi.advanceTimersByTime(5900);
    expect(useCompanion.getState().message).toBe(msg);
    vi.advanceTimersByTime(200);
    expect(useCompanion.getState().message).toBeUndefined();
  });

  it('does not repeat the previous message', async () => {
    let last: string | undefined;
    for (let i = 0; i < 20; i++) {
      await useCompanion.getState().say('start');
      const msg = useCompanion.getState().message;
      expect(msg).not.toBe(last);
      last = msg;
    }
  });

  it('stays silent when the companion is muted', async () => {
    await db.settings.update('settings', { companionMuted: true });
    await useCompanion.getState().say('complete');
    expect(useCompanion.getState().message).toBeUndefined();
  });

  it('uses the profile name', async () => {
    await db.profile.update('me', { name: 'Vitor' });
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      await useCompanion.getState().say('greetMorning');
      seen.add(useCompanion.getState().message!);
    }
    expect([...seen].some((m) => m.includes('Vitor'))).toBe(true);
  });
});
