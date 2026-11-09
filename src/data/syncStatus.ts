// The sync state of one screen area: the session list, a conversation, or a side chat.
// The status area stays hidden while the sync is normal. It shows a short state while Rayno
// catches up, and the full actions only after a failure.
export type SyncInput = {
  offline: boolean;
  connection: 'connecting' | 'connected' | 'disconnected';
  syncing: boolean;
  retrying: boolean;
  syncedAt: number;
  cachedAt: number;
  // The last failed read of the session list and the open chats.
  workspaceError: string;
  // The realtime connection failed. The reads can still work.
  liveError: string;
  unauthorized: boolean;
  // The forward read of this conversation, after its first page loaded.
  history?: { loaded: boolean; loading: boolean; error: string; forward: boolean };
};

export type SyncView =
  | { kind: 'hidden' }
  | { kind: 'offline'; saved: boolean }
  | { kind: 'reconnecting' }
  | { kind: 'syncing' }
  | { kind: 'failed'; scope: 'workspace' | 'live' | 'messages'; detail: string };

export const idleSync: SyncInput = {
  offline: false, connection: 'connected', syncing: false, retrying: false, syncedAt: 0, cachedAt: 0,
  workspaceError: '', liveError: '', unauthorized: false,
};

// `actions` is true for the one area that owns the workspace failure and its Retry button.
// A conversation always shows its own message failure.
export function syncView(input: SyncInput, actions: boolean): SyncView {
  const history = input.history;
  if (input.offline) return { kind: 'offline', saved: !!input.cachedAt || !!input.syncedAt || !!history?.loaded };
  // The app shows a sign-in prompt for an expired authorization. A sync status does not help there.
  if (input.unauthorized) return { kind: 'hidden' };
  if (history?.loaded && history.forward && history.error && !history.loading)
    return { kind: 'failed', scope: 'messages', detail: history.error };
  if (actions && !input.retrying) {
    if (input.workspaceError) return { kind: 'failed', scope: 'workspace', detail: input.workspaceError };
    if (input.liveError) return { kind: 'failed', scope: 'live', detail: input.liveError };
  }
  // The first connection and the first load are normal states. The loading bar and the skeleton show them.
  const shown = !!input.syncedAt || !!input.cachedAt || !!history?.loaded;
  if (!shown) return { kind: 'hidden' };
  if (input.connection !== 'connected' && input.syncedAt) return { kind: 'reconnecting' };
  if (input.syncing || input.retrying || (history?.loaded && history.forward && history.loading)) return { kind: 'syncing' };
  return { kind: 'hidden' };
}

// A sync that ends sooner than this does not show its state. Most focus changes end in time.
export const SYNC_SHOW_DELAY = 600;
// "Synced" stays this long after a sync that the status area showed.
export const SYNC_DONE_TIME = 1800;
