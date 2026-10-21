import type { Attachment } from '../data/types';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024 - 40;
export const MAX_IMAGES = 20;
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export function validateImages(files: readonly Attachment[]) {
  if (files.length > MAX_IMAGES) throw new Error('Attach up to 20 images per message.');
  for (const file of files) {
    if (!imageTypes.has(file.type)) throw new Error('Choose PNG, JPEG, GIF, or WebP images.');
    if (!file.file || file.size <= 0 || file.file.size > MAX_IMAGE_BYTES)
      throw new Error('Each image must be smaller than 10 MB.');
  }
}
export function selectedImages(files: File[], current: File[]) {
  const next = [...current, ...files];
  validateImages(next.map(file => ({ name: file.name, size: file.size, type: file.type, file })));
  return next;
}
export function imageMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  if (new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  throw new Error('This attachment is not a supported image.');
}
// Send account credentials only to the configured API origin, never to object storage.
export function transferUrl(value: string, server: string) {
  const url = new URL(value, server);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    throw new Error('The image server returned an unsafe transfer address.');
  if (url.username || url.password) throw new Error('The image transfer address is invalid.');
  return url;
}
