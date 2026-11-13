import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without globals, so Testing Library cannot register its auto-cleanup.
afterEach(() => { cleanup(); });
// Chained findBy* calls can take over the 1 s default under full-suite load.
configure({ asyncUtilTimeout: 3000 });
