import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from './fixtures';
import { createUIState } from './uiState';
import { createDebouncedSave } from './debouncedSave';
import { createTranscriptMemory } from './transcript';

describe('workspace state notifications', () => {
  it('should notify only the new session prompt and save the latest text without a workspace update', () => {
    // Arrange
    const initial = createInitialState(0);
    const store = createUIState(initial);
    const workspace = vi.fn(), prompt = vi.fn(), session = vi.fn(), save = vi.fn();
    const writer = createDebouncedSave(save);
    store.subscribe(workspace);
    const unsubscribe = store.subscribeNewSessionPrompt(prompt);
    store.subscribeDraft('floating-panels', session);
    store.subscribeChanges(() => writer.schedule(store.getState()));
    // Act
    store.dispatch({ type: 'newDraft', value: { prompt: '中文 task' } });
    store.dispatch({ type: 'newDraft', value: { prompt: '中文 task' } });
    writer.flush();
    // Assert
    expect(store.getNewSessionPrompt()).toBe('中文 task');
    expect(store.getSnapshot()).toBe(initial);
    expect(workspace).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].newDraft.prompt).toBe('中文 task');
    // Other form changes publish the latest prompt without another prompt notification.
    store.dispatch({ type: 'newDraft', value: { agent: 'Codex' } });
    expect(store.getSnapshot().newDraft.prompt).toBe('中文 task');
    expect(prompt).toHaveBeenCalledTimes(1);
    store.dispatch({ type: 'newDraft', value: { prompt: '', handoff: null } });
    expect(store.getNewSessionPrompt()).toBe('');
    expect(prompt).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.dispatch({ type: 'newDraft', value: { prompt: 'Another task' } });
    store.dispatch({ type: 'reset', state: initial });
    expect(prompt).toHaveBeenCalledTimes(2);
    writer.flush();
  });
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
    store.dispatch({ type: 'preferences', value: { chatWidth: 'standard' } });
    // Assert
    expect(workspace).toHaveBeenCalledTimes(1);
    expect(draft).not.toHaveBeenCalled();
    expect(store.getSnapshot().drafts['floating-panels']).toBe('Keep this edit');
    expect(store.getSnapshot().preferences.chatWidth).toBe('standard');
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

  it('should isolate transcript state by account and remove deleted sessions', () => {
    // Arrange
    const account = createUIState(createInitialState(0));
    const other = createUIState(createInitialState(0));
    const memory = createTranscriptMemory();
    memory.groups.set('tool', true);
    account.transcripts.set('floating-panels', memory);
    // Act / Assert
    expect(other.transcripts.has('floating-panels')).toBe(false);
    account.dispatch({ type: 'delete', id: 'floating-panels' });
    expect(account.transcripts.has('floating-panels')).toBe(false);
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
