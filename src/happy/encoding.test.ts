import sodium from 'libsodium-wrappers';
import { afterEach, describe, expect, it } from 'vitest';
import { base64, unbase64 } from './encoding';

await sodium.ready;

const encoderDescriptor = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toBase64');
const decoderDescriptor = Object.getOwnPropertyDescriptor(Uint8Array, 'fromBase64');
afterEach(() => {
  if (encoderDescriptor) Object.defineProperty(Uint8Array.prototype, 'toBase64', encoderDescriptor);
  else Reflect.deleteProperty(Uint8Array.prototype, 'toBase64');
  if (decoderDescriptor) Object.defineProperty(Uint8Array, 'fromBase64', decoderDescriptor);
  else Reflect.deleteProperty(Uint8Array, 'fromBase64');
});

for (const fallback of [false, true]) describe(fallback ? 'legacy Base64 codec' : 'native Base64 codec', () => {
  function configure() {
    if (fallback) {
      Object.defineProperty(Uint8Array.prototype, 'toBase64', { configurable: true, value: undefined });
      Object.defineProperty(Uint8Array, 'fromBase64', { configurable: true, value: undefined });
    } else if (!encoderDescriptor || !decoderDescriptor) {
      // Node 24 needs an API double. Browser tests use the real native codec.
      Object.defineProperty(Uint8Array.prototype, 'toBase64', { configurable: true,
        value(this: Uint8Array, options?: { alphabet?: string; omitPadding?: boolean }) {
          let value = sodium.to_base64(this, sodium.base64_variants.ORIGINAL);
          if (options?.alphabet === 'base64url') value = value.replace(/\+/g, '-').replace(/\//g, '_');
          return options?.omitPadding ? value.replace(/=+$/, '') : value;
        },
      });
      Object.defineProperty(Uint8Array, 'fromBase64', { configurable: true,
        value: (value: string) => sodium.from_base64(value + '='.repeat((4 - value.length % 4) % 4), sodium.base64_variants.ORIGINAL),
      });
    }
  }

  it('should match an independent codec for padded and URL-safe binary values', () => {
    // Arrange
    configure();
    const values = [new Uint8Array(), new TextEncoder().encode('f'),
      new TextEncoder().encode('foobar'), new TextEncoder().encode('中文'),
      new Uint8Array([0, 255, 254, 253, 128])];
    // Act / Assert
    for (const value of values) {
      const standard = sodium.to_base64(value, sodium.base64_variants.ORIGINAL);
      const url = sodium.to_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
      expect(base64(value)).toBe(standard);
      expect(base64(value, true)).toBe(url);
      expect(unbase64(standard)).toEqual(value);
      expect(unbase64(url)).toEqual(value);
    }
  });

  it('should preserve a large cache record without a per-byte callback or argument limit', () => {
    // Arrange
    configure();
    const value = Uint8Array.from({ length: 512 * 1024 }, (_, index) => index % 256);
    const expected = sodium.to_base64(value, sodium.base64_variants.ORIGINAL);
    // Act
    const encoded = base64(value);
    const decoded = unbase64(expected);
    // Assert
    expect(encoded).toBe(expected);
    expect(sodium.memcmp(decoded, value)).toBe(true);
  });
});
