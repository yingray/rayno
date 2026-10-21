type NativeBase64 = Uint8Array & {
  toBase64?: (options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }) => string;
};
const decoder = Uint8Array as typeof Uint8Array & {
  fromBase64?: (value: string) => Uint8Array;
};

export function base64(bytes: Uint8Array, url = false): string {
  const native = (bytes as NativeBase64).toBase64;
  if (native) return native.call(bytes, url ? { alphabet: 'base64url', omitPadding: true } : undefined);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  const value = btoa(binary);
  return url ? value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : value;
}
export function unbase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  if (decoder.fromBase64) return decoder.fromBase64(normalized);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
