import { describe, expect, it } from 'vitest';
import { createInitialState } from './fixtures';
import { activeSideChat, archiveAction, countOpenSideChats, leaveRoute, showSideChatEntry, SIDE_CHAT_AGENT_LIMIT, SIDE_CHAT_TITLE, sideChatLabel, sideChatLabels, sideChatsOf, sideChatTitle } from './sideChats';

const base = createInitialState(1000000).sessions[0];
const side = (id: string, createdAt: number, patch = {}) =>
  ({ ...base, id, createdAt, title: SIDE_CHAT_TITLE, customTitle: undefined, isSideChat: true, parentSessionId: 'parent', archived: false, ...patch });

describe('Side chats', () => {
  it('should list only flagged children of the parent from oldest to newest', () => {
    // Arrange
    const sessions = [
      side('newer', 300), side('older', 100),
      { ...base, id: 'fork', parentSessionId: 'parent', isSideChat: false },
      side('other-parent', 200, { parentSessionId: 'another' }),
      side('parent', 50),
    ];
    // Act
    const result = sideChatsOf(sessions, 'parent');
    // Assert
    expect(result.map((session) => session.id)).toEqual(['older', 'newer']);
  });

  it('should count ended side chats as open and skip closed ones and regular forks', () => {
    // Arrange: an ended side chat lost its CLI connection; only a closed one has the archived lifecycle.
    const sessions = [side('open', 100), side('ended', 150, { archived: true, sideChatClosed: false }),
      side('closed', 200, { archived: true, sideChatClosed: true }), { ...base, id: 'fork', parentSessionId: 'parent' }];
    // Act / Assert
    expect(countOpenSideChats(sessions, 'parent')).toBe(2);
  });

  it('should number open and closed side chats apart and give the full view the same title', () => {
    // Arrange
    const sessions = [side('first', 1), side('closed', 2, { archived: true, sideChatClosed: true }),
      side('ended', 3, { archived: true }), side('named', 4, { title: 'Check the parser' })];
    // Act
    const labels = sideChatLabels(sideChatsOf(sessions, 'parent'));
    // Assert
    expect([...labels]).toEqual([['first', 'Side chat 1'], ['ended', 'Side chat 2'], ['named', 'Check the parser'], ['closed', 'Closed side chat 1']]);
    expect(sideChatTitle(sessions, 'ended')).toBe('Side chat 2');
    expect(sideChatTitle([...sessions, base], base.id)).toBeUndefined();
  });

  it('should hide the side chat entry only for an agent that can never start one and has none', () => {
    // Arrange
    const rig = { ...base, id: 'parent', agent: 'Happy Agent' as const };
    const limited = { branchUnavailable: () => SIDE_CHAT_AGENT_LIMIT };
    const missingId = { branchUnavailable: () => 'The original provider conversation ID is unavailable.' };
    // Act / Assert
    expect(showSideChatEntry([], rig)).toBe(false);
    expect(showSideChatEntry([side('a', 1)], rig)).toBe(true);
    expect(showSideChatEntry([], { ...base, id: 'parent' }, limited)).toBe(false);
    expect(showSideChatEntry([side('a', 1)], { ...base, id: 'parent' }, limited)).toBe(true);
    expect(showSideChatEntry([], { ...base, id: 'parent' }, missingId)).toBe(true);
    expect(showSideChatEntry([], side('a', 1))).toBe(false);
  });

  it('should close an ended side chat and return it to the parent list', () => {
    // Arrange
    const ended = side('ended', 1, { archived: true });
    // Act / Assert
    expect(archiveAction(ended, true)).toBe('Close side chat');
    expect(archiveAction({ ...ended, sideChatClosed: true }, true)).toBeNull();
    expect(archiveAction({ ...base, archived: true }, true)).toBeNull();
    expect(archiveAction({ ...base, archived: false }, false)).toBe('Archive session');
    expect(leaveRoute(ended, true)).toBe('/session/parent/side');
    expect(leaveRoute(ended, false)).toBe('/sessions');
    expect(leaveRoute(base, true)).toBe('/sessions');
  });

  it('should number untitled side chats and keep agent and custom titles', () => {
    // Arrange / Act / Assert
    expect(sideChatLabel(side('a', 1), 0)).toBe('Side chat 1');
    expect(sideChatLabel(side('b', 2, { title: 'Check the parser' }), 1)).toBe('Check the parser');
    expect(sideChatLabel(side('c', 3, { title: 'Check the parser', customTitle: 'My aside' }), 2)).toBe('My aside');
    expect(sideChatLabel(side('d', 4, { archived: true, sideChatClosed: true }), 0, 'Closed side chat')).toBe('Closed side chat 1');
  });

  it('should show the requested open side chat and fall back to the newest one', () => {
    // Arrange
    const open = [side('first', 1), side('second', 2)];
    // Act / Assert
    expect(activeSideChat(open, 'first')?.id).toBe('first');
    expect(activeSideChat(open, 'closed')?.id).toBe('second');
    expect(activeSideChat([], 'first')).toBeUndefined();
  });
});
