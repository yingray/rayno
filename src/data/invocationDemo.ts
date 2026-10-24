import type { Session } from './types';

export const invocationDemoId = 'command-demo';

export function createInvocationDemo(now = Date.now()): Session {
  return {
    id: invocationDemoId, title: 'Command & Skill · UI demo', workspace: 'liquid-glass-web', project: 'Rayno',
    path: '~/ai-workspace/liquid-glass-web', branch: 'demo/commands', machineId: 'mbp', agent: 'Claude',
    model: 'claude-opus-5', effort: 'high', status: 'idle', unread: false, archived: false,
    createdAt: now, updatedAt: now, additions: 0, deletions: 0,
    messages: [
      { id: 'demo-command', role: 'user', content: '<command-message>design-sync</command-message>\n<command-name>/design-sync</command-name>' },
      { id: 'demo-skill', role: 'assistant', content: '', tools: ['Skill'], toolCalls: [
        { id: 'demo-skill-call', name: 'Skill', input: { skill: 'design-sync' }, result: 'Demo skill content. No command ran.', ended: true },
      ] },
      { id: 'demo-command-note', role: 'assistant', sentAt: now, content: 'This is a UI demo. The command above uses the same message format as your Happy session. Open Tool activity to inspect the example Skill call.' },
    ],
  };
}
