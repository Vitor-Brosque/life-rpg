import { useMemo } from 'react';
import type { CharacterLook } from '@life/shared';
import { PixelSprite } from './PixelSprite';
import { avatarSprite } from './sprites';

export interface AvatarProps { look: CharacterLook; scale?: number; title?: string }

export function Avatar({ look, scale = 4, title }: AvatarProps) {
  const { skin, hair, hairColor, outfit } = look;
  const sprite = useMemo(() => avatarSprite({ skin, hair, hairColor, outfit }), [skin, hair, hairColor, outfit]);
  return <PixelSprite sprite={sprite} scale={scale} title={title} className="avatar" />;
}
