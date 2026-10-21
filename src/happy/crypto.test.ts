import { afterEach, describe, expect, it, vi } from 'vitest';
import sodium from 'libsodium-wrappers';
import { authProof, base64, deriveKey, HappyCrypto, recoverySecret, unbase64 } from './crypto';

const secret = new Uint8Array(32).fill(7);
afterEach(() => vi.restoreAllMocks());
describe('Happy encryption compatibility', () => {
  it.each([null, new Uint8Array(32).fill(6)])(
    'should accept authenticated empty stop replies only with explicit compatibility: %j', async (key) => {
      // Arrange: older CLI handlers encode JSON.stringify(undefined) as zero bytes.
      const client = await HappyCrypto.create(secret);
      const empty = await client.encrypt(undefined, key);
      // Act / Assert
      await expect(client.decrypt(empty, key)).rejects.toThrow();
      await expect(client.decrypt(empty, key, { allowEmpty: true })).resolves.toBeNull();
      const damaged = unbase64(empty);
      damaged[damaged.length - 1] ^= 1;
      await expect(client.decrypt(base64(damaged), key, { allowEmpty: true })).rejects.toThrow();
    },
  );
  it('should reuse an imported AES key without reusing a nonce or accepting another key', async () => {
    // Arrange
    const client = await HappyCrypto.create(secret);
    const key = new Uint8Array(32).fill(6);
    let nonce = 0;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      (array as Uint8Array).fill(++nonce);
      return array;
    });
    const importKey = vi.spyOn(crypto.subtle, 'importKey');
    // Act
    const first = await client.encrypt({ text: 'Private message' }, key);
    const second = await client.encrypt({ text: 'Private message' }, key);
    const decoded = await client.decrypt(first, key);
    // Assert
    expect(decoded).toEqual({ text: 'Private message' });
    expect(first).not.toBe(second);
    expect(importKey).toHaveBeenCalledTimes(1);
    // Act / Assert
    await expect(client.decrypt(first, new Uint8Array(32).fill(8))).rejects.toThrow();
    expect(importKey).toHaveBeenCalledTimes(2);
  });
  it('should match the pinned Happy derivation vector for a two-level path', async () => {
    // Arrange
    const seed = new TextEncoder().encode('test seed');
    // Act
    const key = await deriveKey(seed, 'test usage', ['child1', 'child2']);
    // Assert
    expect(
      Array.from(key, (value) => value.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase(),
    ).toBe('1011C097D2105D27362B987A631496BBF68B836124D1D072E9D1613C6028CF75');
  });
  it('should decrypt a legacy NaCl record from an independent producer and reject tampering', async () => {
    // Arrange
    await sodium.ready;
    const client = await HappyCrypto.create(secret);
    const nonce = new Uint8Array(24).fill(3);
    const encrypted = new Uint8Array([
      ...nonce,
      ...sodium.crypto_secretbox_easy(
        new TextEncoder().encode('{"path":"/project/中文"}'),
        nonce,
        secret,
      ),
    ]);
    // Act
    const result = await client.decrypt(base64(encrypted), null);
    encrypted[encrypted.length - 1] ^= 1;
    // Assert
    expect(result).toEqual({ path: '/project/中文' });
    await expect(client.decrypt(base64(encrypted), null)).rejects.toThrow();
  });
  it('should unwrap an account data key and read its AES-GCM record', async () => {
    // Arrange
    await sodium.ready;
    const client = await HappyCrypto.create(secret);
    const dataKey = new Uint8Array(32).fill(4);
    const recipient = sodium.crypto_box_seed_keypair(
      await deriveKey(secret, 'Happy EnCoder', ['content']),
    );
    const sender = sodium.crypto_box_seed_keypair(new Uint8Array(32).fill(8));
    const nonce = new Uint8Array(24).fill(2);
    const wrapped = base64(
      new Uint8Array([
        0,
        ...sender.publicKey,
        ...nonce,
        ...sodium.crypto_box_easy(dataKey, nonce, recipient.publicKey, sender.privateKey),
      ]),
    );
    const iv = new Uint8Array(12).fill(5);
    const imported = await crypto.subtle.importKey('raw', dataKey, 'AES-GCM', false, ['encrypt']);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        imported,
        new TextEncoder().encode('{"name":"Encrypted session"}'),
      ),
    );
    // Act
    const key = await client.unwrapKey(wrapped);
    const result = await client.decrypt(base64(new Uint8Array([0, ...iv, ...ciphertext])), key);
    // Assert
    expect(key).toEqual(dataKey);
    expect(result).toEqual({ name: 'Encrypted session' });
    await expect(
      client.decrypt(base64(new Uint8Array([1, ...iv, ...ciphertext])), key),
    ).rejects.toThrow('version');
    await expect(
      client.decrypt(base64(new Uint8Array([0, ...iv, ...ciphertext])), new Uint8Array(32)),
    ).rejects.toThrow();
  });
  it('should return a valid Ed25519 challenge proof without sending the account secret', async () => {
    // Arrange
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      (array as Uint8Array).fill(9);
      return array;
    });
    // Act
    const proof = await authProof(secret);
    // Assert
    expect(unbase64(proof.challenge)).toEqual(new Uint8Array(32).fill(9));
    expect(
      sodium.crypto_sign_verify_detached(
        unbase64(proof.signature),
        unbase64(proof.challenge),
        unbase64(proof.publicKey),
      ),
    ).toBe(true);
    expect(proof).not.toHaveProperty('secret');
  });
  it('should decode both Happy recovery key formats and reject malformed input', () => {
    // Arrange
    const bytes = new Uint8Array(32);
    // Act
    const formatted = recoverySecret(
      'AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAAAA',
    );
    // Assert
    expect(formatted).toEqual(bytes);
    expect(recoverySecret(base64(secret, true))).toEqual(secret);
    expect(() => recoverySecret('invalid')).toThrow('valid');
  });
});
