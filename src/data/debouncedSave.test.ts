import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDebouncedSave } from './debouncedSave';

afterEach(() => vi.useRealTimers());
describe('draft persistence', () => {
  it('should save the latest draft once after a burst of input', () => {
    // Arrange
    vi.useFakeTimers();
    const save = vi.fn();
    const writer = createDebouncedSave(save);
    // Act
    writer.schedule('a');
    vi.advanceTimersByTime(100);
    writer.schedule('ab');
    vi.advanceTimersByTime(100);
    writer.schedule('abc');
    // Assert
    expect(save).not.toHaveBeenCalled();
    // Act
    vi.advanceTimersByTime(250);
    // Assert
    expect(save).toHaveBeenCalledExactlyOnceWith('abc');
  });

  it('should flush unsaved input on navigation without a later duplicate write', () => {
    // Arrange
    vi.useFakeTimers();
    const save = vi.fn();
    const writer = createDebouncedSave(save);
    writer.schedule('Draft before pagehide');
    // Act
    writer.flush();
    writer.flush();
    vi.runAllTimers();
    // Assert
    expect(save).toHaveBeenCalledExactlyOnceWith('Draft before pagehide');
  });
});
