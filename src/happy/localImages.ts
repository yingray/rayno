import type { Attachment } from '../data/types';
import type { Json } from './normalize';

// Leave room for the base64 file and encrypted RPC envelope in the server's 8 MB socket frame.
export const MAX_LOCAL_IMAGE_BYTES = 4 * 1024 * 1024;
export const isLocalImageSource = (source: string) => !!source && !source.startsWith('//')
  && (!/^[a-z][a-z\d+.-]*:/i.test(source) || /^file:/i.test(source) || /^[a-z]:[\\/]/i.test(source));
export const isLocalImageLink = (source: string) => isLocalImageSource(source) && /\.(png|jpe?g|gif|webp)$/i.test(source);
export const localImageKey = (messageId: string, source: string) => JSON.stringify([messageId, source]);

export function savedLocalImage(metadata: Json | undefined, messageId: string, source: string): Attachment | undefined {
  const value = metadata?.raynoLocalImages?.[localImageKey(messageId, source)];
  if (value && typeof value.ref === 'string' && value.ref && typeof value.name === 'string'
    && typeof value.size === 'number' && typeof value.type === 'string')
    return { ref: value.ref, name: value.name, size: value.size, type: value.type };
}

// Resolve only paths within this session's workspace. Never turn a local path into an HTTP request or shell command.
export function localImagePath(source: string, workspace: string, home?: string): string {
  if (!isLocalImageSource(source)) throw new Error('Choose a local image path.');
  let path: string;
  try {
    if (/^file:/i.test(source)) {
      const url = new URL(source);
      if (url.host && url.host !== 'localhost' || url.search || url.hash) throw new Error();
      path = decodeURIComponent(url.pathname);
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
    } else path = decodeURIComponent(source);
  } catch { throw new Error('The local image path is invalid.'); }
  if (/[\x00-\x1f\x7f]/.test(path)) throw new Error('The local image path is invalid.');
  if (path.startsWith('~/')) {
    if (!home) throw new Error('The computer did not report its home folder. Use an absolute image path.');
    path = home.replace(/\/$/, '') + path.slice(1);
  }
  const windows = /^[a-z]:[\\/]/i.test(workspace);
  const normalize = (value: string) => {
    const input = windows ? value.replace(/\\/g, '/') : value;
    const parts: string[] = [];
    for (const part of input.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop(); else parts.push(part);
    }
    return (input.startsWith('/') ? '/' : '') + parts.join('/');
  };
  if (!workspace || !(workspace.startsWith('/') || windows)) throw new Error('The session has no absolute workspace path.');
  const root = normalize(workspace);
  const absolute = normalize(/^(\/|[a-z]:[\\/])/i.test(path) ? path : root + '/' + path);
  const compare = (value: string) => windows ? value.toLowerCase() : value;
  const prefix = root.endsWith('/') ? root : root + '/';
  if (!compare(absolute).startsWith(compare(prefix)) || absolute === root)
    throw new Error('This image is outside the session workspace. Ask the agent to copy it into the workspace first.');
  return absolute;
}
