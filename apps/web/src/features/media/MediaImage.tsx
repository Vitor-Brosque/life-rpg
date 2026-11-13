import { useState } from 'react';
import { useMediaUrl } from './useMediaUrl';
import './media.css';

export const IMAGE_STATUS = {
  downloading: 'Baixando imagem…',
  missing: 'Imagem ainda não chegou a este aparelho.',
  unreadable: 'Não foi possível mostrar esta imagem.',
} as const;

/** An image reference of a card: the file from this device (or downloaded), or a calm box while it is missing. */
export function MediaImage({ hash, alt }: { hash: string; alt: string }) {
  const media = useMediaUrl(hash);
  const [broken, setBroken] = useState<string | undefined>(undefined); // the url that failed to decode
  const caption = alt.trim();
  const name = caption || 'Imagem';
  const unreadable = media.state === 'ready' && broken === media.url;
  if (media.state === 'ready' && !unreadable) {
    return <img className="rich__img" src={media.url} alt={name} loading="lazy" decoding="async" onError={() => setBroken(media.url)} />;
  }
  const text = unreadable ? IMAGE_STATUS.unreadable : media.state === 'downloading' ? IMAGE_STATUS.downloading : media.state === 'missing' ? IMAGE_STATUS.missing : '';
  return (
    <span className="rich__media-box" role="img" aria-label={text ? `${name}: ${text}` : name}
      aria-busy={unreadable || media.state === 'missing' ? undefined : true}>
      {text && <span>{text}</span>}
      {caption && <span className="rich__media-caption">{caption}</span>}
    </span>
  );
}
