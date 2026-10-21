import sodium from 'libsodium-wrappers';
import { base64, unbase64 } from './encoding';
export { base64, unbase64 } from './encoding';

// Adapted from Happy's MIT-licensed encryption helpers. See PROTOCOL-SOURCES.md.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export function recoverySecret(value: string): Uint8Array {
  const trimmed = value.trim();
  try {
    const bytes = unbase64(trimmed);
    if (bytes.length === 32) return bytes;
  } catch {
    /* Try the formatted backup key. */
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = trimmed
    .toUpperCase()
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/8/g, 'B')
    .replace(/9/g, 'G')
    .replace(/[-\s]/g, '');
  if (!/^[A-Z2-7]{52}$/.test(cleaned)) throw new Error('Enter a valid Happy account recovery key.');
  let buffer = 0,
    bits = 0;
  const result: number[] = [];
  for (const char of cleaned) {
    buffer = (buffer << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      result.push((buffer >> bits) & 255);
    }
  }
  if (result.length !== 32) throw new Error('The recovery key must contain 32 bytes.');
  return new Uint8Array(result);
}
export async function deriveKey(seed: Uint8Array, usage: string, path: string[]) {
  async function hmac(key: Uint8Array, data: Uint8Array) {
    const imported = await crypto.subtle.importKey(
      'raw',
      key as BufferSource,
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign'],
    );
    return new Uint8Array(await crypto.subtle.sign('HMAC', imported, data as BufferSource));
  }
  let state = await hmac(encoder.encode(`${usage} Master Seed`), seed);
  for (const component of path)
    state = await hmac(state.slice(32), new Uint8Array([0, ...encoder.encode(component)]));
  return state.slice(0, 32);
}
export async function createPairingKey() {
  await sodium.ready;
  return sodium.crypto_box_seed_keypair(crypto.getRandomValues(new Uint8Array(32)));
}
export async function openBox(bundle: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  if (bundle.length < 72) throw new Error('The encrypted key is invalid.');
  return sodium.crypto_box_open_easy(
    bundle.slice(56),
    bundle.slice(32, 56),
    bundle.slice(0, 32),
    privateKey,
  );
}
export async function authProof(secret: Uint8Array) {
  await sodium.ready;
  const pair = sodium.crypto_sign_seed_keypair(secret);
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  return {
    challenge: base64(challenge),
    signature: base64(sodium.crypto_sign_detached(challenge, pair.privateKey)),
    publicKey: base64(pair.publicKey),
  };
}
export class HappyCrypto {
  private aesKeys = new WeakMap<Uint8Array, Promise<CryptoKey>>();
  private recordKeys = new Map<string, Promise<Uint8Array | null>>();
  private aesKey(key: Uint8Array) {
    let imported = this.aesKeys.get(key);
    if (!imported) {
      imported = crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
      this.aesKeys.set(key, imported);
    }
    return imported;
  }
  private constructor(
    private readonly secret: Uint8Array,
    private readonly privateKey: Uint8Array,
  ) {}
  static async create(secret: Uint8Array) {
    await sodium.ready;
    if (secret.length !== 32) throw new Error('The account key is invalid.');
    const key = await deriveKey(secret, 'Happy EnCoder', ['content']);
    return new HappyCrypto(secret, sodium.crypto_box_seed_keypair(key).privateKey);
  }
  async unwrapKey(encrypted: string | null | undefined): Promise<Uint8Array | null> {
    if (!encrypted) return null;
    let pending = this.recordKeys.get(encrypted);
    if (!pending) {
      pending = this.openRecordKey(encrypted);
      this.recordKeys.set(encrypted, pending);
      pending.catch(() => this.recordKeys.delete(encrypted));
    }
    return pending;
  }
  private async openRecordKey(encrypted: string): Promise<Uint8Array> {
    const bytes = unbase64(encrypted);
    if (bytes[0] !== 0) throw new Error('This encryption key version is not supported.');
    const key = await openBox(bytes.slice(1), this.privateKey);
    if (key.length !== 32) throw new Error('Could not read the record key.');
    return key;
  }
  async decrypt<T = Record<string, unknown>>(
    value: string,
    key: Uint8Array | null,
    options: { allowEmpty?: boolean } = {},
  ): Promise<T> {
    const bytes = unbase64(value);
    let plain: Uint8Array;
    if (!key) {
      plain = sodium.crypto_secretbox_open_easy(bytes.slice(24), bytes.slice(0, 24), this.secret);
    } else {
      if (bytes[0] !== 0) throw new Error('This encrypted record version is not supported.');
      const imported = await this.aesKey(key);
      plain = new Uint8Array(await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes.slice(1, 13) },
        imported,
        bytes.slice(13),
      ));
    }
    // Older CLI stop handlers encrypt undefined as an empty plaintext.
    if (options.allowEmpty && plain.length === 0) return null as T;
    return JSON.parse(decoder.decode(plain)) as T;
  }
  async encrypt(value: unknown, key: Uint8Array | null): Promise<string> {
    const data = encoder.encode(JSON.stringify(value));
    if (!key) {
      const nonce = crypto.getRandomValues(new Uint8Array(24));
      const encrypted = sodium.crypto_secretbox_easy(data, nonce, this.secret);
      const bundle = new Uint8Array(nonce.length + encrypted.length);
      bundle.set(nonce);
      bundle.set(encrypted, nonce.length);
      return base64(bundle);
    }
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const imported = await this.aesKey(key);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, imported, data);
    const bundle = new Uint8Array(1 + nonce.length + encrypted.byteLength);
    bundle.set(nonce, 1);
    bundle.set(new Uint8Array(encrypted), 1 + nonce.length);
    return base64(bundle);
  }
}
