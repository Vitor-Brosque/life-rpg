import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

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
