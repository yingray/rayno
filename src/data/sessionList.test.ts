import { describe, expect, it } from 'vitest';
import { createInitialState } from './fixtures';
import { compareSessionActivity, formatSessionTimestamp, isSessionFaded } from './sessionList';

describe('Session list presentation', () => {
  it('should sort by published activity with stable IDs and no active-first step', () => {
    // Arrange
    const base = createInitialState().sessions[0];
    const sessions = [
      { ...base, id: 'z', lastActivityAt: 100, updatedAt: 9999, status: 'running' as const },
      { ...base, id: 'b', lastActivityAt: 200, updatedAt: 300, status: 'offline' as const },
      { ...base, id: 'a', lastActivityAt: 200, updatedAt: 10 },
    ];
    // Act
    const ids = sessions.sort(compareSessionActivity).map((session) => session.id);
    // Assert
    expect(ids).toEqual(['a', 'b', 'z']);
  });

  it.each([
    [30000, 'just now'],
    [60000, '1 minute ago'],
    [59 * 60000, '59 minutes ago'],
    [3600000, '1 hour ago'],
    [23 * 3600000, '23 hours ago'],
    [-5 * 60000, 'just now'],
  ])('should format an age of %d milliseconds as %s', (age, expected) => {
    // Arrange
    const now = Date.UTC(2026, 9, 20, 12);
    // Act / Assert
    expect(formatSessionTimestamp(now - age, now)).toBe(expected);
  });

  it('should show the local date and time from one day ago', () => {
    // Arrange
    const now = Date.UTC(2026, 9, 20, 12);
    const time = now - 86400000;
    // Act / Assert
    expect(formatSessionTimestamp(time, now)).toBe(new Date(time).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }));
  });

  it('should fade an archived session or an offline computer without fading a disconnected session', () => {
    // Arrange
    const base = { ...createInitialState().sessions[0], archived: false, status: 'offline' as const };
    // Act / Assert
    expect(isSessionFaded({ ...base, machineOffline: false })).toBe(false);
    expect(isSessionFaded({ ...base, machineOffline: true })).toBe(true);
    expect(isSessionFaded({ ...base, machineOffline: false, archived: true })).toBe(true);
  });
});
