import { defineConfig } from 'vitest/config';

// The tests build local times (logical day, rest days, 04:00 day start) in the app's own time zone. Fixing it here
// makes every machine and the CI (which runs in UTC) get the same results; the workers inherit it.
process.env.TZ = 'America/Sao_Paulo';

export default defineConfig({
  test: { environment: 'node' },
});
