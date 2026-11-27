import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The tests build local times (logical day, rest days, 04:00 day start) in the app's own time zone. Fixing it here
// makes every machine and the CI (which runs in UTC) get the same results; the workers inherit it.
process.env.TZ = 'America/Sao_Paulo';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['test/setup.ts'],
    // Multi-step screen tests take 2–3 s alone; the 5 s default is too tight when the machine is busy.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
