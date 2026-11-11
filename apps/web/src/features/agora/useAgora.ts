import { useMemo, useState } from 'react';
import { create } from 'zustand';
import type { DayKey, EngineOutput, Mission, Suggestion } from '@life/shared';
import { useEngine } from '../../db/hooks';
import { skipMission } from '../../domain/actions';
import { safeRun } from '../../ui/safeRun';
import { useMissionSheet } from '../mission/MissionSheet';
import {
  completeWithFeedback, dropWithFeedback, splitWithFeedback, startWithFeedback,
} from '../mission/missionFeedback';

/** What the main card and the alternatives can do. Every handler gets the mission it acts on. */
export interface AgoraActions {
  start(m: Mission): void;
  /** Opens the mission sheet ("Continuar", tapping a row). */
  open(m: Mission): void;
  complete(m: Mission): void;
  /** "Outra": next suggestion (session-only skip + 'skipped' event). */
  other(m: Mission): void;
  shrink(m: Mission): void;
  snooze(m: Mission): void;
  split(m: Mission): void;
  drop(m: Mission): void;
  /** Tapping an alternative brings it to the main card. */
  promote(m: Mission): void;
}

export type AgoraDialog = { kind: 'shrink' | 'snooze'; mission: Mission };

/** Primary + up to 3 alternatives, honouring a promoted ("pinned") mission while it is still eligible. */
export function arrangeSuggestions(
  engine: EngineOutput | undefined, pinnedId?: string,
): { primary?: Suggestion; alternatives: Suggestion[] } {
  if (!engine) return { alternatives: [] };
  const pinned = pinnedId ? engine.ranked.find((s) => s.mission.id === pinnedId) : undefined;
  if (!pinned) return { primary: engine.primary, alternatives: engine.alternatives };
  return { primary: pinned, alternatives: engine.ranked.filter((s) => s !== pinned).slice(0, 3) };
}

interface AgoraSession {
  /** Day the quick review was closed ("Pronto"/"Dispensar"): hidden until the next day. */
  reviewDismissedDay?: DayKey;
  /** Day the companion last greeted / last spoke its "empty" line (once per day each). */
  greetedDay?: DayKey;
  emptyDay?: DayKey;
  dismissReview(day: DayKey): void;
}

/** App-session state of the Agora screen (survives navigating away and back), keyed by day. */
export const useAgoraSession = create<AgoraSession>((set) => ({
  reviewDismissedDay: undefined,
  greetedDay: undefined,
  emptyDay: undefined,
  dismissReview: (day) => set({ reviewDismissedDay: day }),
}));

const guard = (fn: (m: Mission) => Promise<unknown>) => (m: Mission) => { safeRun(() => fn(m)); };

/** Engine output + session state (skips, promoted mission, open dialog) + actions. */
export function useAgora() {
  const [skipIds, setSkipIds] = useState<string[]>([]);
  const [pinnedId, setPinnedId] = useState<string>();
  const [dialog, setDialog] = useState<AgoraDialog>();
  const engine = useEngine(skipIds);
  const { primary, alternatives } = useMemo(() => arrangeSuggestions(engine, pinnedId), [engine, pinnedId]);

  const actions = useMemo<AgoraActions>(() => {
    const openSheet = (m: Mission) => useMissionSheet.getState().open(m.id);
    return {
      start: guard(async (m) => { await startWithFeedback(m.id); openSheet(m); }),
      open: openSheet,
      complete: guard((m) => completeWithFeedback(m.id)),
      other: (m) => {
        setPinnedId((p) => (p === m.id ? undefined : p));
        setSkipIds((s) => [...s.filter((x) => x !== m.id), m.id]);
        void skipMission(m.id);
      },
      shrink: (m) => setDialog({ kind: 'shrink', mission: m }),
      snooze: (m) => setDialog({ kind: 'snooze', mission: m }),
      // Splitting needs steps: without a checklist, open the sheet so they can be added first.
      split: guard(async (m) => {
        if (m.checklist.length > 0) await splitWithFeedback(m.id);
        else openSheet(m);
      }),
      drop: guard((m) => dropWithFeedback(m.id)),
      promote: (m) => setPinnedId(m.id),
    };
  }, []);

  return {
    engine,
    primary,
    alternatives,
    actions,
    /** "Outra" only makes sense when something else can come up. */
    canSkip: (engine?.ranked.length ?? 0) > 1,
    dialog,
    closeDialog: () => setDialog(undefined),
  };
}
