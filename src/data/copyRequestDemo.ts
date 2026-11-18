import type { Session } from './types';

export const copyRequestDemoId = 'copy-request-demo';
export const copyRequestDemoSamples = [
  'Review **this change**.\n\n- Keep the line breaks.\n- 保留中文。\n\n`pnpm test`',
  'Check the change on a 320px phone.',
] as const;

export function createCopyRequestDemo(now = Date.now()): Session {
  return {
    id: copyRequestDemoId, title: 'Copy a request · Interactive demo', workspace: 'rayno', project: 'Rayno',
    path: '/demo/workspace', branch: 'demo/copy-request', machineId: 'mbp', agent: 'Codex',
    model: 'gpt-6.2-sol', effort: 'medium', status: 'idle', unread: false, archived: false,
    createdAt: now, updatedAt: now, additions: 0, deletions: 0,
    messages: [{
      id: 'copy-request-intro', role: 'assistant', sentAt: now - 120000,
      content: '### Try copying a message\n\nSelect **Copy request** below either sample. Select **Copy response** below this reply. Paste into the message field to check the text. You can also send your own message and copy it. The clipboard uses your browser, and the agent reply is simulated.',
    }, ...copyRequestDemoSamples.map((content, index) => ({
      id: `copy-request-sample-${index}`, role: 'user' as const, content, sentAt: now - (1 - index) * 60000,
    }))],
  };
}
