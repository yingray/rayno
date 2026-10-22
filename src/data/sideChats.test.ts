import { describe, expect, it } from 'vitest';
import { createInitialState } from './fixtures';
import { activeSideChat, countOpenSideChats, SIDE_CHAT_TITLE, sideChatLabel, sideChatsOf } from './sideChats';

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

  it('should count open side chats without closed ones or regular forks', () => {
    // Arrange
    const sessions = [side('open', 100), side('closed', 200, { archived: true }), { ...base, id: 'fork', parentSessionId: 'parent' }];
    // Act / Assert
    expect(countOpenSideChats(sessions, 'parent')).toBe(1);
  });

  it('should number untitled side chats and keep agent and custom titles', () => {
    // Arrange / Act / Assert
    expect(sideChatLabel(side('a', 1), 0)).toBe('Side chat 1');
    expect(sideChatLabel(side('b', 2, { title: 'Check the parser' }), 1)).toBe('Check the parser');
    expect(sideChatLabel(side('c', 3, { title: 'Check the parser', customTitle: 'My aside' }), 2)).toBe('My aside');
    expect(sideChatLabel(side('d', 4, { archived: true }), 0, 'Closed side chat')).toBe('Closed side chat 1');
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
