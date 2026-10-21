import { unbase64 } from './encoding';

export const CLIENT_ID = 'web/2.0.0-rayno-v2';
export const DEFAULT_SERVER = 'https://api.cluster-fluster.com';
export const CREDENTIALS_KEY = 'rayno.v2.credentials';
// Survives sign-out so the next login on this device starts with the same server.
export const SERVER_KEY = 'rayno.v2.server';
export type Credentials = { server: string; token: string; secret: string };

export function serverOrigin(value: string): string {
  const url = new URL(value.trim());
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('Use an HTTPS Happy server address.');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Enter a server origin without a path or credentials.');
  return url.origin;
}
export function readCredentials(): Credentials | null {
  try {
    const raw = sessionStorage.getItem(CREDENTIALS_KEY) || localStorage.getItem(CREDENTIALS_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (
      typeof value.token !== 'string' ||
      !value.token ||
      typeof value.secret !== 'string' ||
      unbase64(value.secret).length !== 32
    )
      return null;
    return { server: serverOrigin(value.server), token: value.token, secret: value.secret };
  } catch {
    return null;
  }
}
export function readLastServer(): string {
  try {
    const value = localStorage.getItem(SERVER_KEY);
    return value ? serverOrigin(value) : DEFAULT_SERVER;
  } catch {
    return DEFAULT_SERVER;
  }
}
export function saveCredentials(value: Credentials, remember: boolean) {
  clearCredentials();
  (remember ? localStorage : sessionStorage).setItem(CREDENTIALS_KEY, JSON.stringify(value));
  // A session-only login leaves no server address on the device.
  if (remember) localStorage.setItem(SERVER_KEY, value.server);
}
export function clearCredentials() {
  localStorage.removeItem(CREDENTIALS_KEY);
  sessionStorage.removeItem(CREDENTIALS_KEY);
}
