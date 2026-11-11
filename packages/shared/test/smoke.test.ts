import { describe, expect, it } from 'vitest';
import { SYNC_TABLES } from '../src/index';

describe('shared smoke', () => {
  it('exposes sync tables', () => {
    expect(SYNC_TABLES).toContain('missions');
  });
});
