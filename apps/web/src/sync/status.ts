import { create } from 'zustand';

export type SyncState = 'disabled' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus { state: SyncState; pending: number; lastSync?: number; error?: string }

export const useSyncStatus = create<SyncStatus>(() => ({ state: 'disabled', pending: 0 }));
