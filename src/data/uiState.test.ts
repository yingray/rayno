import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from './fixtures';
import { createUIState } from './uiState';
import { createDebouncedSave } from './debouncedSave';

describe('workspace state notifications', () => {
  it('should notify only the edited session without invalidating the workspace snapshot', () => {
    // Arrange
    const initial = createInitialState(0);
    const store = createUIState(initial);
    const workspace = vi.fn();
    const current = vi.fn();
    const other = vi.fn();
    store.subscribe(workspace);
    store.subscribeDraft('floating-panels', current);
    store.subscribeDraft('api-contract', other);
    // Act
    store.dispatch({ type: 'draft', id: 'floating-panels', value: '中文草稿' });
    store.dispatch({ type: 'draft', id: 'floating-panels', value: '中文草稿' });
    // Assert
    expect(store.getDraft('floating-panels')).toBe('中文草稿');
    expect(store.getState().drafts['floating-panels']).toBe('中文草稿');
    expect(store.getSnapshot()).toBe(initial);
    expect(workspace).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);
  });

  it('should retain the current draft when another workspace action publishes a snapshot', () => {
    // Arrange
    const store = createUIState(createInitialState(0));
    const workspace = vi.fn();
    const draft = vi.fn();
    store.subscribe(workspace);
    store.subscribeDraft('floating-panels', draft);
    store.dispatch({ type: 'draft', id: 'floating-panels', value: 'Keep this edit' });
    draft.mockClear();
    // Act
    store.dispatch({ type: 'preferences', value: { showUsage: false } });
    // Assert
    expect(workspace).toHaveBeenCalledTimes(1);
    expect(draft).not.toHaveBeenCalled();
    expect(store.getSnapshot().drafts['floating-panels']).toBe('Keep this edit');
    expect(store.getSnapshot().preferences.showUsage).toBe(false);
  });

  it('should notify draft subscribers when a send clears the draft or a session is deleted', () => {
    // Arrange
    const store = createUIState(createInitialState(0));
    const drafts: string[] = [];
    store.subscribeDraft('floating-panels', () => drafts.push(store.getDraft('floating-panels')));
    store.dispatch({ type: 'draft', id: 'floating-panels', value: 'First instruction' });
    // Act
    store.dispatch({ type: 'send', id: 'floating-panels', now: 1,
      message: { id: 'sent', role: 'user', content: 'First instruction' } });
    store.dispatch({ type: 'draft', id: 'floating-panels', value: 'Another draft' });
    store.dispatch({ type: 'delete', id: 'floating-panels' });
    // Assert
    expect(drafts).toEqual(['First instruction', '', 'Another draft', '']);
    expect(store.getState().sessions.some((session) => session.id === 'floating-panels')).toBe(false);
  });

  it('should persist the latest edits without a workspace render and stop removed subscriptions', () => {
    // Arrange
    const store = createUIState(createInitialState(0));
    const save = vi.fn();
    const writer = createDebouncedSave(save);
    const unsubscribeSave = store.subscribeChanges(() => writer.schedule(store.getState()));
    const listener = vi.fn();
    const unsubscribeDraft = store.subscribeDraft('floating-panels', listener);
    // Act
    store.dispatch({ type: 'draft', id: 'floating-panels', value: 'First edit' });
    unsubscribeDraft();
    store.dispatch({ type: 'draft', id: 'floating-panels', value: 'Latest edit' });
    writer.flush();
    unsubscribeSave();
    // Assert
    expect(listener).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].drafts['floating-panels']).toBe('Latest edit');
    expect(store.getSnapshot().drafts).toEqual({});
  });
});
