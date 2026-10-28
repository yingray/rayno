import type { Session } from './types';

export const chatScrollDemoId = 'chat-scroll-demo';

export function createChatScrollDemo(now = Date.now()): Session {
  return {
    id: chatScrollDemoId, title: 'Chat scrolling · Interactive demo', workspace: 'rayno', project: 'Rayno',
    path: '/demo/workspace', branch: 'demo/chat-scroll', machineId: 'mbp', agent: 'Claude',
    model: 'claude-opus-5', effort: 'high', status: 'idle', unread: false, archived: false,
    createdAt: now, updatedAt: now, additions: 0, deletions: 0,
    messages: Array.from({ length: 320 }, (_, index) => ({
      id: `${chatScrollDemoId}-${index}`, role: 'assistant' as const,
      sentAt: now - (319 - index) * 60000,
      content: index === 319
        ? '### Try chat scrolling\n\nAt the bottom, scroll down again: the latest button stays hidden. Scroll up a little: the button appears. Tap it or scroll back to the bottom to follow new replies.\n\nSend a message to receive a simulated reply. You can repeat these steps. Enable **Faster long chats (preview)** in Appearance to try the same flow with virtual rows.'
        : `### Scroll example ${index + 1}\n\nThis sample reply gives you room to scroll through the conversation. You can read earlier replies without a new reply pulling you back to the bottom.`,
    })),
  };
}
