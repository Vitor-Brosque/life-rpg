import { create } from 'zustand';
import { aiSettingsOf, type AiFeature, type AiStatusResponse, type AiUsage } from '@life/shared';
import { useSettings } from '../db/hooks';

// Whether the server has AI (spec §6.1). Refreshed by aiClient.refreshAiStatus; the last answer is
// kept per device, so the controls do not flicker while offline.

const CACHE_KEY = 'life-rpg-ai-available';

export interface AiStatusState {
  available: boolean;
  usage?: AiUsage;
  /** The server answered at least once in this app session. */
  checked: boolean;
}

function cachedAvailable(): boolean {
  try { return localStorage.getItem(CACHE_KEY) === '1'; } catch { return false; }
}

export const useAiStatus = create<AiStatusState>(() => ({ available: cachedAvailable(), checked: false }));

export function setAiStatus(s: AiStatusResponse): void {
  try { localStorage.setItem(CACHE_KEY, s.available ? '1' : '0'); } catch { /* memory only */ }
  useAiStatus.setState(s.available
    ? { available: true, usage: { used: s.used, limit: s.limit }, checked: true }
    : { available: false, usage: undefined, checked: true });
}

export function setAiUsage(usage: AiUsage): void {
  useAiStatus.setState({ usage });
}

/** The server has AI and the aid is on in Ajustes: the only gate for drawing an AI control. */
export function useAiFeature(feature: AiFeature): boolean {
  const available = useAiStatus((s) => s.available);
  const settings = useSettings();
  return available && aiSettingsOf(settings)[feature];
}
