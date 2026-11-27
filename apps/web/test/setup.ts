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

// The DOM patches below only exist under jsdom (a few files run in plain Node: `@vitest-environment node`).
if (typeof HTMLCanvasElement !== 'undefined') {
  // jsdom has no canvas: the lousa draws nothing in tests (its geometry is tested in shared and with a
  // fake context). Returning null also avoids jsdom's "Not implemented: getContext" message.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;

  // jsdom cannot play media ("Not implemented"): play() resolves and pause() does nothing; tests spy on them.
  HTMLMediaElement.prototype.play = function play() { return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function pause() {};
}
