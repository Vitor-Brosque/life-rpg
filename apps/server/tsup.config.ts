import { defineConfig } from 'tsup';

// Bundle every dependency so the Docker runtime stage needs no npm install.
// node:* builtins stay external (they are resolved by Node at runtime).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  noExternal: [/.*/],
  // Some CJS deps (web-push, fastify) use require(); provide it in the ESM bundle.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  outDir: 'dist',
  clean: true,
});
