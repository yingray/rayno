import type { Attachment, Session } from './types';

export const imageDemoId = 'private-image-demo';
export const imageDemoPath = '/demo/workspace/private-demo.png';
export function createImageDemo(now = Date.now()): Session {
  return {
    id: imageDemoId, title: 'Private image · Interactive demo', workspace: 'rayno', project: 'Rayno',
    path: '/demo/workspace', branch: 'demo/private-image', machineId: 'mbp', agent: 'Claude',
    model: 'claude-opus-5', effort: 'high', status: 'idle', unread: false, archived: false,
    createdAt: now, updatedAt: now, additions: 0, deletions: 0,
    messages: [{ id: 'private-image-demo-reply', role: 'assistant', sentAt: now, content:
      '### Try the image preview\n\nThis demo uses a public screenshot of Rayno. Select **Load private image**, then tap the thumbnail to open it or download a copy. No computer files are read or uploaded. Reload this page to try again.\n\n![Rayno chat screenshot](' + imageDemoPath + ')' }],
  };
}

// The interactive demo uses only this bundled, already-public screenshot, never a model-provided path.
export async function loadDemoImage(): Promise<{ file: Attachment; load: () => Promise<Blob> }> {
  const response = await fetch(new URL('../../docs/images/demo-chat.png', import.meta.url).href);
  if (!response.ok) throw new Error('The demo image could not be loaded. Try again.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const { HappyCrypto } = await import('../happy/crypto');
  const encryption = await HappyCrypto.create(crypto.getRandomValues(new Uint8Array(32)));
  const key = crypto.getRandomValues(new Uint8Array(32));
  const encrypted = await encryption.encryptBlob(bytes, key);
  return {
    file: { ref: 'demo-private-image', name: 'private-demo.png', size: bytes.length, type: 'image/png' },
    load: async () => new Blob([await encryption.decryptBlob(encrypted, key) as BlobPart], { type: 'image/png' }),
  };
}
