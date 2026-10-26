import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from './fixtures';
import { createUIState } from './uiState';

const session = 'floating-panels';
const pick = (key: string, text = key) => ({ type: 'draftOption' as const, id: session, key, messageId: 'reply', text });

describe('option drafts', () => {
  it('should keep the original draft when choices are selected and removed in any order', () => {
    const ui = createUIState(createInitialState(0));
    ui.dispatch({ type: 'draft', id: session, value: 'My text' });
    ui.dispatch(pick('A')); ui.dispatch(pick('B')); ui.dispatch(pick('A'));
    expect(ui.getDraft(session)).toBe('My text\nB');
    ui.dispatch(pick('B'));
    expect(ui.getDraft(session)).toBe('My text');
    expect(ui.getDraftOptions(session)).toEqual([]);
  });

  it('should remove the first choice without leaving a leading separator in an empty draft', () => {
    const ui = createUIState(createInitialState(0));
    ui.dispatch(pick('A')); ui.dispatch(pick('B')); ui.dispatch(pick('A'));
    expect(ui.getDraft(session)).toBe('B');
    ui.dispatch(pick('B'));
    expect(ui.getDraft(session)).toBe('');
  });

  it('should preserve identical manual text and move selected spans after edits before them', () => {
    const ui = createUIState(createInitialState(0));
    ui.dispatch({ type: 'draft', id: session, value: 'A' });
    ui.dispatch(pick('A'));
    ui.dispatch({ type: 'draft', id: session, value: 'Extra A\nA' });
    ui.dispatch(pick('A'));
    expect(ui.getDraft(session)).toBe('Extra A');
  });

  it('should preserve multiline labels and a newline that the user wrote before a choice', () => {
    const ui = createUIState(createInitialState(0));
    ui.dispatch({ type: 'draft', id: session, value: 'My text\n' });
    ui.dispatch(pick('A', 'First\nSecond')); ui.dispatch(pick('B'));
    ui.dispatch(pick('A', 'First\nSecond'));
    expect(ui.getDraft(session)).toBe('My text\nB');
    ui.dispatch(pick('B'));
    expect(ui.getDraft(session)).toBe('My text\n');
  });

  it('should keep identical labels independent when the first selected option is removed', () => {
    const ui = createUIState(createInitialState(0));
    ui.dispatch(pick('first', 'Same')); ui.dispatch(pick('second', 'Same'));
    ui.dispatch(pick('first', 'Same'));
    expect(ui.getDraft(session)).toBe('Same');
    expect(ui.getDraftOptions(session).map(option => option.key)).toEqual(['second']);
    ui.dispatch(pick('second', 'Same'));
    expect(ui.getDraft(session)).toBe('');
  });

  it('should release edited choices and keep the new manual text intact', () => {
    const ui = createUIState(createInitialState(0));
    ui.dispatch(pick('A', 'Choice A'));
    ui.dispatch({ type: 'draft', id: session, value: 'Edited choice A' });
    expect(ui.getDraftOptions(session)).toEqual([]);
    ui.dispatch(pick('A', 'Choice A')); ui.dispatch(pick('A', 'Choice A'));
    expect(ui.getDraft(session)).toBe('Edited choice A');
  });

  it('should isolate selections and notify only the current draft when choices change', () => {
    const ui = createUIState(createInitialState(0));
    const other = createUIState(createInitialState(0));
    const workspace = vi.fn(), draft = vi.fn();
    ui.subscribe(workspace); ui.subscribeDraft(session, draft);
    ui.dispatch(pick('A'));
    expect(draft).toHaveBeenCalledTimes(1);
    expect(workspace).not.toHaveBeenCalled();
    expect(ui.getDraftOptions('other')).toEqual([]);
    expect(other.getDraftOptions(session)).toEqual([]);
    ui.dispatch({ type: 'draft', id: session, value: '' });
    expect(ui.getDraftOptions(session)).toEqual([]);
  });
});
