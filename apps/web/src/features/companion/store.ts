import { create } from 'zustand';
import { db } from '../../db/db';
import { pickPhrase, type PhraseCategory } from './phrases';

export const COMPANION_MESSAGE_MS = 6000;

interface CompanionState {
  message?: string;
  /** Shows one phrase of the category (unless muted). Resolves once the message is set. */
  say(cat: PhraseCategory): Promise<void>;
  clear(): void;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let last: string | undefined;

export const useCompanion = create<CompanionState>((set) => ({
  message: undefined,
  async say(cat) {
    const [settings, profile] = await Promise.all([db.settings.get('settings'), db.profile.get('me')]);
    if (settings?.companionMuted) return;
    const message = pickPhrase(cat, last, { name: profile?.name, companion: profile?.companionName });
    last = message;
    clearTimeout(timer);
    set({ message });
    timer = setTimeout(() => set({ message: undefined }), COMPANION_MESSAGE_MS);
  },
  clear() {
    clearTimeout(timer);
    set({ message: undefined });
  },
}));
