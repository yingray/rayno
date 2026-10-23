import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPersistentStorage, requestPersistentStorageOnFirstInput } from './persistentStorage';

describe('requestPersistentStorage', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('should ask the browser to keep the offline data', () => {
    // Arrange
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', { storage: { persist } });
    // Act
    requestPersistentStorage();
    // Assert
    expect(persist).toHaveBeenCalledTimes(1);
  });
  it('should do nothing without the API and ignore a refusal', async () => {
    // Arrange
    vi.stubGlobal('navigator', {});
    // Act / Assert
    expect(() => requestPersistentStorage()).not.toThrow();
    vi.stubGlobal('navigator', { storage: { persist: vi.fn().mockRejectedValue(new Error('denied')) } });
    expect(() => requestPersistentStorage()).not.toThrow();
    await Promise.resolve();
  });
  it('should ask on the first input only, and not when the data is already persistent', async () => {
    // Arrange
    const listeners = new Map<string, () => void>();
    vi.stubGlobal('window', { addEventListener: (name: string, handler: () => void) => listeners.set(name, handler),
      removeEventListener: (name: string) => listeners.delete(name) });
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', { storage: { persist, persisted: vi.fn().mockResolvedValue(false) } });
    // Act
    requestPersistentStorageOnFirstInput();
    await Promise.resolve();
    listeners.get('pointerdown')!();
    // Assert
    expect(persist).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    // Arrange: a site that the browser already keeps.
    const again = vi.fn();
    vi.stubGlobal('navigator', { storage: { persist: again, persisted: vi.fn().mockResolvedValue(true) } });
    // Act
    requestPersistentStorageOnFirstInput();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Assert
    expect(listeners.size).toBe(0);
    expect(again).not.toHaveBeenCalled();
  });
});
