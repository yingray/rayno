import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authRequest, loginWithKey } from './auth';

// Like a real fetch, an abort of the signal rejects with the signal's reason.
const hang = (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) =>
  init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
  fetchMock = vi.fn(hang);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Happy authentication requests', () => {
  it('should stop a key sign-in that gets no answer after 25 seconds', async () => {
    // Arrange
    const secret = 'A'.repeat(43);
    // Act
    const login = loginWithKey('https://happy.test', secret).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(25000);
    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(((await login) as Error).message).toBe('Happy did not answer within 25 seconds. Check the server and try again.');
  });
  it('should keep the caller reason when the caller cancels', async () => {
    // Arrange
    const caller = new AbortController();
    const reason = new DOMException('Aborted', 'AbortError');
    // Act
    const request = authRequest('https://happy.test', '/v1/auth/account/request', {}, caller.signal).catch((error) => error);
    caller.abort(reason);
    // Assert
    expect(await request).toBe(reason);
  });
  it('should return the answer and clear the deadline', async () => {
    // Arrange
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ token: 'token' }), { status: 200 }));
    // Act
    const answer = await authRequest('https://happy.test', '/v1/auth', {});
    // Assert
    expect(answer).toEqual({ token: 'token' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
