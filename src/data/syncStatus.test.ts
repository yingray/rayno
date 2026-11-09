import { describe, expect, it } from 'vitest';
import { idleSync, syncView } from './syncStatus';
import { initialSyncDemo, syncDemoStep } from './syncStatusDemo';

const synced = { ...idleSync, syncedAt: 1000 };
const history = { loaded: true, loading: false, error: '', forward: true };

describe('sync status view', () => {
  it('should stay hidden during the first load and a normal sync', () => {
    expect(syncView({ ...idleSync, connection: 'connecting', syncing: true }, true)).toEqual({ kind: 'hidden' });
    expect(syncView(synced, true)).toEqual({ kind: 'hidden' });
  });
  it('should show a sync over content that is already on screen', () => {
    expect(syncView({ ...idleSync, cachedAt: 900, syncing: true }, true)).toEqual({ kind: 'syncing' });
    expect(syncView({ ...synced, history: { ...history, loading: true } }, false)).toEqual({ kind: 'syncing' });
    expect(syncView({ ...synced, connection: 'disconnected' }, true)).toEqual({ kind: 'reconnecting' });
  });
  it('should show the workspace failure only in the area that owns the Retry button', () => {
    const failed = { ...synced, workspaceError: 'Happy request failed (503).' };
    expect(syncView(failed, true)).toEqual({ kind: 'failed', scope: 'workspace', detail: 'Happy request failed (503).' });
    expect(syncView(failed, false)).toEqual({ kind: 'hidden' });
    expect(syncView({ ...failed, retrying: true }, true)).toEqual({ kind: 'syncing' });
  });
  it('should show a message failure in its conversation and keep offline first', () => {
    const input = { ...synced, history: { ...history, error: 'timeout' } };
    expect(syncView(input, false)).toEqual({ kind: 'failed', scope: 'messages', detail: 'timeout' });
    expect(syncView({ ...input, offline: true }, false)).toEqual({ kind: 'offline', saved: true });
    expect(syncView({ ...idleSync, offline: true }, true)).toEqual({ kind: 'offline', saved: false });
  });
  it('should leave an expired sign-in to the sign-in prompt', () => {
    expect(syncView({ ...synced, unauthorized: true, workspaceError: 'expired' }, true)).toEqual({ kind: 'hidden' });
  });
});

describe('sync status demo', () => {
  it('should fail, retry, and end hidden', () => {
    const start = initialSyncDemo(1000);
    const failing = syncDemoStep(start, 'failWorkspace', 1000);
    const failed = failing.then.at(-1)![1];
    expect(syncView(failed, true).kind).toBe('failed');
    const retry = syncDemoStep(failed, 'retry', 2000);
    expect(syncView(retry.state, true).kind).toBe('syncing');
    expect(syncView(retry.then.at(-1)![1], true)).toEqual({ kind: 'hidden' });
  });
  it('should go offline and reconnect before the sync', () => {
    const offline = syncDemoStep(initialSyncDemo(1000), 'offline', 1000).state;
    expect(syncView(offline, true)).toEqual({ kind: 'offline', saved: true });
    const online = syncDemoStep(offline, 'online', 2000);
    expect(syncView(online.state, true).kind).toBe('reconnecting');
    expect(online.then.map(([, state]) => syncView(state, true).kind)).toEqual(['syncing', 'hidden']);
  });
});
