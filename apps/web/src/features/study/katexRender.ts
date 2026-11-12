import katex from 'katex';
import 'katex/dist/katex.min.css';

// Loaded on demand by Rich (dynamic import): KaTeX's JS, CSS and fonts stay out of the main bundle
// and are precached by the service worker (globPatterns include js, css and woff2).

/** KaTeX HTML for `tex`. Throws on invalid input (the caller shows the source); never trusts \href & co. */
export function renderTex(tex: string, display: boolean): string {
  return katex.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, strict: 'ignore' });
}
