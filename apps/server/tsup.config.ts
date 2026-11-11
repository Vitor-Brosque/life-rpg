import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  noExternal: ['@life/shared'],
  outDir: 'dist',
  clean: true,
});
