import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    // PWA plugin (vite-plugin-pwa) is added in Task 13.
  ],
  server: {
    proxy: { '/api': 'http://localhost:8787' }, // SSE included
  },
});
