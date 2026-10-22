import { describe, expect, it } from 'vitest';
import { createInitialState, defaultNewDraft } from './fixtures';
import { demoReducer, restoreState, titleOf, validateDraft } from './reducer';
import { DEFAULT_RECAP_STYLE, PREVIOUS_RECAP_STYLES, RECAP_STYLE_LIMIT } from '../happy/systemPrompt';

describe('Session lifecycle', () => {
  it('should preserve a typed draft when a reply option sends its own text', () => {
    // Arrange
    const state = createInitialState(1000000);
    state.drafts['floating-panels'] = 'Keep my own reply';
    // Act
    const result = demoReducer(state, {
      type: 'send', id: 'floating-panels', now: 1000001, preserveDraft: true,
      message: { id: 'choice', role: 'user', content: 'Selected option' },
    });
    // Assert
    expect(result.drafts['floating-panels']).toBe('Keep my own reply');
    expect(result.sessions[0].messages.at(-1)?.content).toBe('Selected option');
  });
  it('should restore the agent title when a custom name is cleared', () => {
    // Arrange
    const state = createInitialState(1000000);
    const named = demoReducer(state, {
      type: 'rename',
      id: 'floating-panels',
      name: 'My custom title',
    });
    // Act
    const cleared = demoReducer(named, { type: 'rename', id: 'floating-panels', name: '   ' });
    // Assert
    expect(titleOf(cleared.sessions[0])).toBe('Build the floating panels layout');
  });

  it('should reject a late reply when a response is stopped', () => {
    // Arrange
    const state = demoReducer(createInitialState(1000000), {
      type: 'send',
      id: 'floating-panels',
      now: 1000001,
      message: { id: 'sent', role: 'user', content: 'Test request' },
    });
    const stopped = demoReducer(state, { type: 'stop', id: 'floating-panels' });
    // Act
    const result = demoReducer(stopped, {
      type: 'reply',
      id: 'floating-panels',
      now: 1000002,
      message: { id: 'late', role: 'assistant', content: 'Late reply' },
    });
    // Assert
    expect(result.sessions[0].messages.some((message) => message.id === 'late')).toBe(false);
    expect(result.sessions[0].status).toBe('idle');
  });

  it('should preserve other sessions when a session and its draft are deleted', () => {
    // Arrange
    const state = createInitialState(1000000);
    state.drafts = { 'floating-panels': 'Remove me', 'api-contract': 'Keep me' };
    // Act
    const result = demoReducer(state, { type: 'delete', id: 'floating-panels' });
    // Assert
    expect(result.sessions).toHaveLength(state.sessions.length - 1);
    expect(result.sessions.some((session) => session.id === 'api-contract')).toBe(true);
    expect(result.drafts).toEqual({ 'api-contract': 'Keep me' });
  });

  it('should stop a running session when it is archived', () => {
    // Arrange
    const state = createInitialState(1000000);
    // Act
    const result = demoReducer(state, { type: 'archive', id: 'api-contract' });
    // Assert
    expect(result.sessions.find((session) => session.id === 'api-contract')).toMatchObject({
      archived: true,
      status: 'idle',
    });
  });
});

describe('Session creation', () => {
  it('should reject a new session without an explicit permission mode', () => {
    // Arrange
    const draft = { ...defaultNewDraft, prompt: 'Create a panel', permissionMode: '' };
    // Act / Assert
    expect(validateDraft(draft, true)).toContain('Choose a permission mode');
  });
  it('should require an online computer and a prompt before creation', () => {
    // Arrange
    const draft = { ...defaultNewDraft, prompt: 'Create a panel' };
    // Act
    const offlineError = validateDraft(draft, false);
    const emptyError = validateDraft({ ...draft, prompt: ' ' }, true);
    const valid = validateDraft(draft, true);
    // Assert
    expect(offlineError).toContain('online computer');
    expect(emptyError).toContain('Describe');
    expect(valid).toBeNull();
  });
});

describe('Browser state restoration', () => {
  it('should retain the latest permission choice for each agent across reload', () => {
    // Arrange
    const state = createInitialState(1000000);
    const first = demoReducer(state, { type: 'rememberPermission', key: 'Claude', value: 'plan' });
    const other = demoReducer(first, { type: 'rememberPermission', key: 'Codex', value: 'safe-yolo' });
    const latest = demoReducer(other, { type: 'rememberPermission', key: 'Claude', value: 'acceptEdits' });
    // Act
    const result = restoreState(JSON.stringify(latest), state);
    // Assert
    expect(result.permissionChoices).toEqual({ Claude: 'acceptEdits', Codex: 'safe-yolo' });
  });
  it('should migrate old drafts to Auto and ignore malformed permission preferences', () => {
    // Arrange
    const state = createInitialState(1000000);
    const raw = JSON.parse(JSON.stringify(state));
    delete raw.newDraft.permissionMode;
    raw.permissionChoices = { Claude: 'plan', Codex: null, invalid: 42, empty: '' };
    // Act
    const result = restoreState(JSON.stringify(raw), state);
    // Assert
    expect(result.newDraft.permissionMode).toBe('auto');
    expect(result.permissionChoices).toEqual({ Claude: 'plan' });
  });
  it('should restore local changes and clear an interrupted response after reload', () => {
    // Arrange
    const state = createInitialState(1000000);
    state.preferences.bubble = 'blue';
    state.newDraft.agent = 'Codex';
    state.drafts['floating-panels'] = 'A saved draft';
    state.sessions[0].customTitle = 'A saved title';
    // Act
    const result = restoreState(JSON.stringify(state), createInitialState(2000000));
    // Assert
    expect(result.preferences.bubble).toBe('blue');
    expect(result.newDraft.agent).toBe('Codex');
    expect(result.drafts['floating-panels']).toBe('A saved draft');
    expect(result.sessions[0].customTitle).toBe('A saved title');
    expect(result.sessions.find((session) => session.id === 'api-contract')?.status).toBe('idle');
  });

  it.each(['{broken', '{"version":9}', '{"version":1,"sessions":[{"id":false}]}'])(
    'should use defaults when stored data is invalid: %s',
    (raw) => {
      // Arrange
      const fallback = createInitialState(1000000);
      // Act
      const result = restoreState(raw, fallback);
      // Assert
      expect(result).toBe(fallback);
    },
  );

  it.each([
    ['large', 'large'],
    ['small', 'small'],
    ['huge', 'medium'],
    [undefined, 'medium'],
  ])('should restore the chat font size %s as %s', (stored, expected) => {
    // Arrange
    const state = createInitialState(1000000);
    const raw = JSON.parse(JSON.stringify(state));
    raw.preferences.fontSize = stored;
    // Act
    const result = restoreState(JSON.stringify(raw), createInitialState(2000000));
    // Assert
    expect(result.preferences.fontSize).toBe(expected);
  });

  it.each([
    [undefined, undefined, 'auto', false],
    ['manual', true, 'manual', true],
    ['always', 'yes', 'auto', false],
  ])('should restore the recap preferences %s and %s as %s and %s', (recap, autoplay, expectedRecap, expectedAutoplay) => {
    // Arrange
    const raw = JSON.parse(JSON.stringify(createInitialState(1000000)));
    delete raw.preferences.recap;
    delete raw.preferences.recapAutoplay;
    if (recap !== undefined) raw.preferences.recap = recap;
    if (autoplay !== undefined) raw.preferences.recapAutoplay = autoplay;
    // Act
    const result = restoreState(JSON.stringify(raw), createInitialState(2000000));
    // Assert
    expect(result.preferences.recap).toBe(expectedRecap);
    expect(result.preferences.recapAutoplay).toBe(expectedAutoplay);
    expect(result.preferences.bubble).toBe(raw.preferences.bubble);
  });

  it.each([
    [undefined, DEFAULT_RECAP_STYLE],
    ['', ''],
    ['Speak like a coach.', 'Speak like a coach.'],
    [42, DEFAULT_RECAP_STYLE],
    ['y'.repeat(RECAP_STYLE_LIMIT + 1), 'y'.repeat(RECAP_STYLE_LIMIT)],
    [PREVIOUS_RECAP_STYLES[0], DEFAULT_RECAP_STYLE],
  ])('should restore the recap style %#', (stored, expected) => {
    // Arrange
    const raw = JSON.parse(JSON.stringify(createInitialState(1000000)));
    delete raw.preferences.recapStyle;
    if (stored !== undefined) raw.preferences.recapStyle = stored;
    // Act
    const result = restoreState(JSON.stringify(raw), createInitialState(2000000));
    // Assert
    expect(result.preferences.recapStyle).toBe(expected);
  });

  it('should keep a simulated session running while another reply is on its way', () => {
    // Arrange
    const state = createInitialState(1000000);
    const id = state.sessions[0].id;
    const running = demoReducer(state, { type: 'send', id, now: 1, message: { id: 'r1', role: 'user', content: 'Recap', recapRequest: true }, preserveDraft: true });
    // Act
    const partial = demoReducer(running, { type: 'reply', id, now: 2, keepRunning: true, message: { id: 'a1', role: 'assistant', content: 'One' } });
    const done = demoReducer(partial, { type: 'reply', id, now: 3, message: { id: 'a2', role: 'assistant', content: 'Two' } });
    // Assert
    expect(partial.sessions[0].status).toBe('running');
    expect(done.sessions[0].status).toBe('idle');
    expect(done.sessions[0].messages.slice(-3).map((message) => message.id)).toEqual(['r1', 'a1', 'a2']);
  });

  it('should keep an empty session list after the user deletes every session', () => {
    // Arrange
    const state = createInitialState(1000000);
    state.sessions = [];
    // Act
    const result = restoreState(JSON.stringify(state), createInitialState(2000000));
    // Assert
    expect(result.sessions).toEqual([]);
  });
});
