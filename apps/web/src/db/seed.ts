import type { Area, Profile, Settings } from '@life/shared';
import { db } from './db';
import { newRecord, put } from './repo';

export const DEFAULT_AREAS: Array<Pick<Area, 'name' | 'attribute' | 'color' | 'icon' | 'order'>> = [
  { name: 'Corpo', attribute: 'Vigor', color: '#e5675d', icon: 'heart', order: 0 },
  { name: 'Mente e descanso', attribute: 'Equilíbrio', color: '#7fb7e6', icon: 'moon', order: 1 },
  { name: 'Estudo', attribute: 'Intelecto', color: '#a98be0', icon: 'book', order: 2 },
  { name: 'Trabalho', attribute: 'Ofício', color: '#e0a84a', icon: 'hammer', order: 3 },
  { name: 'Casa e finanças', attribute: 'Ordem', color: '#6fbf8a', icon: 'home', order: 4 },
  { name: 'Pessoas', attribute: 'Laços', color: '#e68fb5', icon: 'people', order: 5 },
];

const AREA_IDS = ['area-vigor', 'area-equilibrio', 'area-intelecto', 'area-oficio', 'area-ordem', 'area-lacos'];

export async function ensureSeed(): Promise<void> {
  if (!(await db.profile.get('me'))) {
    await put('profile', newRecord<Profile>({
      id: 'me', name: '', look: { skin: 0, hair: 0, hairColor: 0, outfit: 0 },
      companionName: 'Faísca', onboarded: false,
    }));
  }
  if (!(await db.settings.get('settings'))) {
    await put('settings', newRecord<Settings>({
      id: 'settings', dayStartHour: 4, dayEndHour: 23,
      pomodoro: { focusMin: 25, breakMin: 5 }, companionMuted: false, commitmentReminderMin: 10,
    }));
  }
  for (const [i, a] of DEFAULT_AREAS.entries()) {
    const id = AREA_IDS[i]!;
    if (await db.areas.get(id)) continue;
    await put('areas', newRecord<Area>({ ...a, id, archived: false }));
  }
}
