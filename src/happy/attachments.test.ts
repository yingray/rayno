import { describe, expect, it } from 'vitest';
import sodium from 'libsodium-wrappers';
import { deriveKey, HappyCrypto } from './crypto';
import { imageMime, MAX_IMAGE_BYTES, transferUrl, validateImages } from './attachments';
import { resumeUnavailable } from './resume';

describe('image attachments', () => {
  it('should use the upstream secretbox format and isolate session keys when encrypting images', async () => {
    // Arrange
    const secret = new Uint8Array(32).fill(1), key = new Uint8Array(32).fill(2);
    const encryption = await HappyCrypto.create(secret), bytes = new Uint8Array([137, 80, 78, 71, 1, 2]);
    // Act
    const bundle = await encryption.encryptBlob(bytes, key);
    // Assert
    const upstreamKey = await deriveKey(key, 'Happy Blobs', ['session']);
    expect(sodium.crypto_secretbox_open_easy(bundle.slice(24), bundle.slice(0, 24), upstreamKey)).toEqual(bytes);
    await expect(encryption.decryptBlob(bundle, null)).rejects.toThrow('decrypt');
    bundle[40] ^= 1;
    await expect(encryption.decryptBlob(bundle, key)).rejects.toThrow('decrypt');
  });
  it('should use the master blob subkey for legacy sessions without exposing the account key', async () => {
    // Arrange
    const secret = new Uint8Array(32).fill(3), bytes = new Uint8Array([1, 2, 3]);
    const encryption = await HappyCrypto.create(secret);
    // Act
    const bundle = await encryption.encryptBlob(bytes, null);
    // Assert
    expect(sodium.crypto_secretbox_open_easy(bundle.slice(24), bundle.slice(0, 24), await deriveKey(secret, 'Happy Blobs', ['master']))).toEqual(bytes);
  });
  it('should reject oversized and unsupported files before any transfer', () => {
    // Arrange
    const file = new File(['abc'], 'image.png', { type: 'image/png' });
    const image = { name: file.name, type: file.type, size: file.size, file };
    // Act / Assert
    expect(() => validateImages([image])).not.toThrow();
    expect(() => validateImages([{ ...image, type: 'application/pdf' }])).toThrow('PNG');
    expect(() => validateImages([{ ...image, file: { size: MAX_IMAGE_BYTES + 1 } as File }])).toThrow('10 MB');
    expect(() => validateImages(Array(21).fill(image))).toThrow('20 images');
    expect(() => imageMime(new TextEncoder().encode('<svg>'))).toThrow('supported image');
    expect(() => transferUrl('http://storage.example.com/blob', 'https://happy.example.com')).toThrow('unsafe');
    expect(transferUrl('/blob', 'https://happy.example.com').origin).toBe('https://happy.example.com');
  });
});

describe('session recovery', () => {
  const session = { machineId: 'computer', flavor: 'codex', codexThreadId: 'thread' };
  it('should require the original online computer and an advertised resume capability', () => {
    // Arrange
    const machine = { resumeSupport: { rpcAvailable: true } };
    // Act / Assert
    expect(resumeUnavailable(session, machine, true)).toBe('');
    expect(resumeUnavailable(session, machine, false)).toContain('online');
    expect(resumeUnavailable(session, {}, true)).toContain('Update Happy CLI');
    expect(resumeUnavailable({ machineId: 'computer' }, machine, true)).toContain('recovery ID');
    expect(resumeUnavailable({ ...session, capabilities: { resume: false } }, machine, true)).toContain('does not support');
  });
});
