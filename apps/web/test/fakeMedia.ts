// Test doubles for media (Marco 3c). Tasks 6 and 7 add the microphone and speech doubles here.

/** First bytes of a PNG file: storeMedia accepts it as image/png. */
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);
/** First bytes of a WebM file: storeMedia accepts it as audio/webm. */
export const WEBM_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
