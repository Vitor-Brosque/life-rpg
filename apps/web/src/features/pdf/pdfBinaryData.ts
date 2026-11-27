// PDFs da aula (2026-11-26): the binary files PDF.js asks the page for by name, through its `BinaryDataFactory` option
// (pdfjs-dist 6.5.438). Scanned black-and-white pages (CCITT fax and JBIG2, from copiers and "optimize scanned PDF")
// decode with jbig2.wasm and JPEG 2000 images with openjpeg.wasm; without them PDF.js skips the image and the page
// shows blank. The app serves only those two, from its own hashed and precached files, so scans open offline too.
// Nothing else is served: no ICC colour (qcms), no standard fonts, no CMaps, never the scripting engine (quickjs).
// Plain TypeScript without Vite imports, so a Node probe can load it as is.

/** The URL of each file PDF.js may ask for, by the name it asks with. */
export type BinaryFiles = Readonly<Record<string, string>>;

const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`pdf: ${url} answered ${res.status}`);
  return res.arrayBuffer();
};

/**
 * The class PDF.js instantiates as its `BinaryDataFactory` (it calls `new Factory({ cMapUrl, standardFontDataUrl,
 * wasmUrl })`, then `fetch({ kind, filename })` from the worker's "FetchBinaryData" message). Only `wasmUrl` files listed
 * in `files` are served; any other request fails, and PDF.js goes on without it.
 */
export function appBinaryDataFactory(files: BinaryFiles, load: (url: string) => Promise<ArrayBuffer> = fetchBytes) {
  return class AppBinaryData {
    constructor(_options?: unknown) {}

    async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
      const url = kind === 'wasmUrl' && Object.hasOwn(files, filename) ? files[filename] : undefined;
      if (!url) throw new Error(`pdf: no ${kind} file "${filename}" in the app`);
      return new Uint8Array(await load(url));
    }
  };
}
