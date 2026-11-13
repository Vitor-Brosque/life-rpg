import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/pixel.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { requestPersistentStorage } from './db/exportData';
import { ensureSeed } from './db/seed';
import { startAiStatus } from './ai/aiClient';
import { startSync } from './sync/client';

async function boot(): Promise<void> {
  // Local data is the source of truth: ask the browser not to evict it.
  requestPersistentStorage();
  try {
    await ensureSeed();
  } catch (e) {
    // Render anyway: screens handle missing data and the ErrorBoundary offers recovery.
    console.error('seed failed', e);
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
  startSync();
  startAiStatus();
  // Service worker: offline app shell + push. A no-op in dev (devOptions disabled).
  registerSW({ immediate: true });
}

void boot();
