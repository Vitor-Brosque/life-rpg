import { defineConfig } from 'vitest/config';

// The tests build local times in the app's own time zone; fixing it makes every machine and the CI (UTC) agree.
process.env.TZ = 'America/Sao_Paulo';

export default defineConfig({
  test: {
    environment: 'node',
    server: { deps: { inline: ['@life/shared'] } },
  },
});
