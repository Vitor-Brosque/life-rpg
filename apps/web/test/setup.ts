import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { codeEditorOptions } from '../src/features/study/CodeEditor';

// Vitest runs without globals, so Testing Library cannot register its auto-cleanup.
afterEach(() => { cleanup(); });
// Chained findBy* calls can take over the 1 s default under full-suite load.
configure({ asyncUtilTimeout: 3000 });

// Other suites keep the plain textarea editor; codeMirror.test.tsx turns CodeMirror on.
codeEditorOptions.enhanced = false;
