import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { requestMedia, useMediaStatus } from '../../sync/media';

export type MediaView =
  | { state: 'loading' }
  | { state: 'ready'; url: string; type: string }
  | { state: 'downloading' }
  | { state: 'missing' };

/**
 * An object URL for the media `hash` while it is on this device (revoked when the record or the
 * hash changes, and on unmount). A missing file is requested from the server (sync/media.ts).
 */
export function useMediaUrl(hash: string): MediaView {
  const row = useLiveQuery(() => db.mediaData.get(hash), [hash], null); // null: reading; undefined: not here
  const status = useMediaStatus((s) => s[hash]);
  const [url, setUrl] = useState<{ hash: string; url: string } | undefined>(undefined);
  useEffect(() => {
    if (!row) return undefined;
    const u = URL.createObjectURL(new Blob([row.bytes], { type: row.type }));
    setUrl({ hash: row.hash, url: u });
    return () => URL.revokeObjectURL(u);
  }, [row]);
  useEffect(() => {
    if (row === undefined) requestMedia(hash);
  }, [row, hash]);
  if (row && url && url.hash === hash) return { state: 'ready', url: url.url, type: row.type };
  if (row === undefined) return status ? { state: status } : { state: 'loading' };
  return { state: 'loading' };
}
