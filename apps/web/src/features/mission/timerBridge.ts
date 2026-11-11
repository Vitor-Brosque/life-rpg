import { create } from 'zustand';

export interface TimerBridge {
  /** Starts a free timer linked to the mission. Undefined until the timer registers itself. */
  start?: (missionId: string) => void;
}

/**
 * Decouples the mission sheet from the timer (Task 11). The timer registers its starter with
 *   useTimerBridge.setState({ start: (id) => useTimer.getState().start('free', { missionId: id }) })
 * and the "Cronômetro" button stays hidden while `start` is undefined.
 */
export const useTimerBridge = create<TimerBridge>(() => ({ start: undefined }));
