import type { Session } from './types';

export const replyOptionsDemoId = 'reply-options-demo';
export const replyOptionsDemoChoices = '<options>\n<option>Check the mobile layout</option>\n<option>Add a regression test</option>\n<option>Review the copy</option>\n</options>';

export function createReplyOptionsDemo(now = Date.now()): Session {
  return {
    id: replyOptionsDemoId, title: 'Reply options · Interactive demo', workspace: 'rayno', project: 'Rayno',
    path: '~/Developer/rayno', branch: 'demo/reply-options', machineId: 'mbp', agent: 'Claude',
    model: 'claude-opus-5', effort: 'high', status: 'idle', unread: false, archived: false,
    createdAt: now, updatedAt: now, additions: 0, deletions: 0,
    messages: [{ id: 'reply-options-demo-intro', role: 'assistant', sentAt: now, content: [
      '### Try multiple reply options',
      'Select two or more options below. Each choice adds a line to the message field. Select a choice again to remove its line.',
      'You can add your own text before or after the choices. A choice never sends a message. Use the send button when your draft is ready.',
      'On a phone, Enter adds a new line. Your message stays in this browser. The simulated reply offers the choices again so you can repeat the demo.',
      replyOptionsDemoChoices,
    ].join('\n\n') }],
  };
}
