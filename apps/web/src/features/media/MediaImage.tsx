import { useMediaUrl } from './useMediaUrl';
import './media.css';

export const IMAGE_STATUS = {
  downloading: 'Baixando imagem…',
  missing: 'Imagem ainda não chegou a este aparelho.',
} as const;

/** An image reference of a card: the file from this device (or downloaded), or a calm box while it is missing. */
export function MediaImage({ hash, alt }: { hash: string; alt: string }) {
  const media = useMediaUrl(hash);
  const caption = alt.trim();
  const name = caption || 'Imagem';
  if (media.state === 'ready') return <img className="rich__img" src={media.url} alt={name} loading="lazy" decoding="async" />;
  const text = media.state === 'downloading' ? IMAGE_STATUS.downloading : media.state === 'missing' ? IMAGE_STATUS.missing : '';
  return (
    <span className="rich__media-box" role="img" aria-label={text ? `${name}: ${text}` : name}
      aria-busy={media.state === 'missing' ? undefined : true}>
      {text && <span>{text}</span>}
      {caption && <span className="rich__media-caption">{caption}</span>}
    </span>
  );
}
