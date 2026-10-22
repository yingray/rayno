import { describe, expect, it } from 'vitest';
import { createInitialState } from '../data/fixtures';
import { attentionTitle, faviconFor, tabAttention } from './tabAttention';

const base = { ...createInitialState().sessions[0], unread: false, needsReply: false, archived: false, isSideChat: false, status: 'idle' as const };

describe('Tab attention', () => {
  it('should count each listed session that is unread or needs input once', () => {
    // Arrange
    const sessions = [
      { ...base, id: 'unread', unread: true },
      { ...base, id: 'both', unread: true, needsReply: true },
      { ...base, id: 'reply', needsReply: true, status: 'offline' as const },
      { ...base, id: 'read' },
      { ...base, id: 'archived', unread: true, archived: true },
      { ...base, id: 'side', needsReply: true, isSideChat: true },
    ];
    // Act
    const attention = tabAttention(sessions);
    // Assert
    expect(attention).toEqual({ count: 3, needsInput: true });
  });

  it('should keep the plain icon when only an offline session needs input', () => {
    // Arrange
    const sessions = [{ ...base, needsReply: true, status: 'offline' as const }, { ...base, id: 'b', unread: true }];
    // Act
    const attention = tabAttention(sessions);
    // Assert
    expect(attention).toEqual({ count: 2, needsInput: false });
    expect(faviconFor(attention.needsInput)).toBe('/icons/rayno.svg');
    expect(faviconFor(true)).toBe('/icons/rayno-attention.svg');
  });

  it('should treat a blocked session without a reply flag as needs input, as the session list does', () => {
    // Arrange
    const { needsReply: _, ...rest } = base;
    const sessions = [{ ...rest, id: 'blocked', status: 'blocked' as const }, { ...base, id: 'answered', status: 'blocked' as const }];
    // Act
    const attention = tabAttention(sessions);
    // Assert
    expect(attention).toEqual({ count: 1, needsInput: true });
  });

  it.each([
    [0, 'Rayno · Sessions'],
    [1, '(1) Rayno · Sessions'],
    [99, '(99) Rayno · Sessions'],
    [140, '(99+) Rayno · Sessions'],
  ])('should show a count of %d as %s', (count, expected) => {
    // Act / Assert
    expect(attentionTitle('Rayno · Sessions', count)).toBe(expected);
  });
});
