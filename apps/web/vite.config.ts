import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const THEME = '#12141f';

export default defineConfig({
  plugins: [
    react(),
    // Installable PWA (Home Screen on iPhone) with offline app shell and push (src/sw.ts).
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false, // main.tsx registers through virtual:pwa-register
      includeManifestIcons: false, // the PNGs are already precached by globPatterns
      manifest: {
        name: 'LIFE RPG',
        short_name: 'LIFE RPG',
        description: 'Sua vida, um passo de cada vez.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: THEME,
        theme_color: THEME,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,png,svg,woff2}'] },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    proxy: { '/api': 'http://localhost:8787' }, // SSE included
  },
});
