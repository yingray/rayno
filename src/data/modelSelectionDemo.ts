import type { Session } from './types';

export const modelSelectionDemoId = 'model-selection-demo';

export function createModelSelectionDemo(now = Date.now()): Session {
  return {
    id: modelSelectionDemoId, title: 'Model & effort · Interactive demo', workspace: 'rayno', project: 'Rayno',
    path: '/demo/workspace', branch: 'demo/model-selection', machineId: 'mbp', agent: 'Codex',
    model: 'gpt-6.1-sol', effort: 'high', status: 'idle', unread: false, archived: false,
    createdAt: now, updatedAt: now, additions: 0, deletions: 0,
    messages: [{
      id: `${modelSelectionDemoId}-intro`, role: 'assistant', sentAt: now,
      content: '### Try model and effort selection\n\nOpen **Model and effort** beside the message field. Try **GPT-6.1 Sol → Max or Ultra**, **GPT-6.1 Terra → Ultra**, and **GPT-6 Luna → Max**. Luna does not offer Ultra.\n\nChoose **Done**, send a message, then reopen the picker or reload to check your selection. Choose another model and effort to repeat. You can also try these choices when you start a new Codex session.\n\nReplies are simulated in this browser. Max does not run deeper reasoning here, and Ultra does not start subagents.',
    }],
  };
}
