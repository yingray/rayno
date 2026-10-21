import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCredentials,
  DEFAULT_SERVER,
  readLastServer,
  saveCredentials,
  SERVER_KEY,
} from './credentials';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const credentials = { server: 'https://happy.example.com', token: 'token', secret: 'secret' };
beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
});
afterEach(() => vi.unstubAllGlobals());

describe('readLastServer', () => {
  it('should return the default server when no server is saved', () => {
    expect(readLastServer()).toBe(DEFAULT_SERVER);
  });

  it('should keep the remembered server after sign-out', () => {
    // Arrange
    saveCredentials(credentials, true);
    // Act
    clearCredentials();
    // Assert
    expect(readLastServer()).toBe('https://happy.example.com');
  });

  it('should not save the server for a session-only login', () => {
    // Act
    saveCredentials(credentials, false);
    // Assert
    expect(localStorage.getItem(SERVER_KEY)).toBeNull();
    expect(readLastServer()).toBe(DEFAULT_SERVER);
  });

  it('should return the default server when the saved value is not an HTTPS origin', () => {
    // Arrange
    localStorage.setItem(SERVER_KEY, 'http://happy.example.com');
    // Act / Assert
    expect(readLastServer()).toBe(DEFAULT_SERVER);
  });
});
