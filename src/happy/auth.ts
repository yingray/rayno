import { authProof, base64, createPairingKey, openBox, recoverySecret, unbase64 } from './crypto';

export * from './credentials';
import { CLIENT_ID, serverOrigin } from './credentials';
import type { Credentials } from './credentials';

const AUTH_TIMEOUT = 25000;
// Each request has its own deadline, so a stalled server cannot keep the sign-in screen waiting.
// The caller's signal still cancels the request, with the caller's reason.
export async function authRequest(
  server: string,
  path: string,
  body: unknown,
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, AUTH_TIMEOUT);
  const cancel = () => controller.abort(signal!.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await fetch(`${serverOrigin(server)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Happy-Client': CLIENT_ID },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        `Happy authentication failed (${response.status}). Check the server and try again.`,
      );
    return await response.json();
  } catch (error) {
    if (timedOut) throw new Error('Happy did not answer within 25 seconds. Check the server and try again.');
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
export async function loginWithKey(server: string, value: string): Promise<Credentials> {
  const secret = recoverySecret(value);
  const response = await authRequest(server, '/v1/auth', await authProof(secret));
  if (typeof response.token !== 'string')
    throw new Error('The server did not return an account token.');
  return { server: serverOrigin(server), token: response.token, secret: base64(secret, true) };
}
export async function startPairing(
  server: string,
  signal: AbortSignal,
  ready: (uri: string, approval: string) => void,
): Promise<Credentials> {
  const pair = await createPairingKey();
  const publicKey = base64(pair.publicKey);
  const keyUrl = base64(pair.publicKey, true);
  await authRequest(server, '/v1/auth/account/request', { publicKey }, signal);
  signal.throwIfAborted();
  ready(`happy:///account?${keyUrl}`, `/account?${keyUrl}`);
  const deadline = Date.now() + 10 * 60 * 1000;
  while (!signal.aborted && Date.now() < deadline) {
    const response = await authRequest(server, '/v1/auth/account/request', { publicKey }, signal);
    if (response.state === 'authorized') {
      const secret = await openBox(unbase64(response.response), pair.privateKey);
      if (secret.length !== 32 || typeof response.token !== 'string')
        throw new Error('Could not read the authorized account.');
      return { server: serverOrigin(server), token: response.token, secret: base64(secret, true) };
    }
    await new Promise<void>((resolve, reject) => {
      const aborted = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = window.setTimeout(() => {
        signal.removeEventListener('abort', aborted);
        resolve();
      }, 1500);
      signal.addEventListener('abort', aborted, { once: true });
    });
  }
  signal.throwIfAborted();
  throw new Error('This QR code expired. Create a new code.');
}
