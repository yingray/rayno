import type { Session } from './types';
import { idleSync, type SyncInput } from './syncStatus';

export const syncStatusDemoId = 'sync-status-demo';
export const syncStatusDemoUpdate = 'demo-new-version';
export type SyncDemoStep =
  | 'resume' | 'offline' | 'online' | 'failWorkspace' | 'failMessages' | 'retry' | 'retryMessages' | 'reset';

export function createSyncStatusDemo(now = Date.now()): Session {
  return { id: syncStatusDemoId, title: 'Sync status · Interactive demo', workspace: 'rayno', project: 'Rayno',
    path: '/demo/rayno', branch: 'demo/sync-status', machineId: 'mbp', agent: 'Claude', model: 'claude-opus-5', effort: 'high',
    status: 'idle', unread: false, archived: false, createdAt: now, updatedAt: now, additions: 0, deletions: 0,
    messages: [{ id: 'sync-status-intro', role: 'assistant', sentAt: now,
      content: '### Try the sync status\n\nThe status stays hidden while the sync is normal. It shows a short state while Rayno catches up, and Retry only after a failure.\n\nUse the buttons below this message:\n\n1. **Return from background** shows Syncing, then Synced, then hides.\n2. **Lose the network** shows the offline state. **Network returns** reconnects and syncs.\n3. **Fail the sync** shows Retry. Tap the status to read the last sync time and the technical details.\n4. **Show a new version** opens the separate app update notice.\n\nOpen the session list while a state shows to see the same status there. The delays and failures are simulated. This demo does not connect to a server or change your saved sessions, drafts, or preferences.' }],
  };
}

const history = { loaded: true, loading: false, error: '', forward: true };
export const initialSyncDemo = (now = Date.now()): SyncInput => ({ ...idleSync, syncedAt: now, cachedAt: now, history });

// Each step returns the next state and, for a timed step, the states that follow it with their delays.
export function syncDemoStep(state: SyncInput, step: SyncDemoStep, now = Date.now()): { state: SyncInput; then: [number, SyncInput][] } {
  const done: SyncInput = { ...state, offline: false, connection: 'connected', syncing: false, retrying: false,
    workspaceError: '', liveError: '', syncedAt: now, history };
  switch (step) {
  case 'resume':
    return { state: { ...state, syncing: true }, then: [[2400, { ...done, syncedAt: now + 2400 }]] };
  case 'offline':
    return { state: { ...state, offline: true, connection: 'disconnected', syncing: false }, then: [] };
  case 'online':
    return { state: { ...state, offline: false, connection: 'connecting' },
      then: [[1200, { ...state, offline: false, connection: 'connected', syncing: true }], [2600, { ...done, syncedAt: now + 2600 }]] };
  case 'failWorkspace':
    return { state: { ...state, syncing: true }, then: [[1400, { ...state, syncing: false,
      workspaceError: 'Happy request failed (503). The server did not answer the session list read.' }]] };
  case 'failMessages':
    return { state: { ...state, history: { ...history, loading: true } }, then: [[1400, { ...state,
      history: { ...history, error: 'Happy did not answer within 25 seconds.' } }]] };
  case 'retry':
    return { state: { ...state, retrying: true, workspaceError: '' }, then: [[1400, { ...done, syncedAt: now + 1400 }]] };
  case 'retryMessages':
    return { state: { ...state, history: { ...history, loading: true } }, then: [[1400, { ...done, syncedAt: now + 1400 }]] };
  case 'reset':
    return { state: initialSyncDemo(now), then: [] };
  }
}
