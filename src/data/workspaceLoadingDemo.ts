import type { Session } from './types';

export const workspaceLoadingDemoId = 'workspace-loading-demo';
export function createWorkspaceLoadingDemo(now = Date.now()): Session {
  return { id: workspaceLoadingDemoId, title: 'Workspace loading · Interactive demo', workspace: 'rayno', project: 'Rayno',
    path: '/demo/rayno', branch: 'demo/workspace-loading', machineId: 'mbp', agent: 'Claude', model: 'claude-opus-5', effort: 'high',
    status: 'idle', unread: false, archived: false, createdAt: now, updatedAt: now, additions: 0, deletions: 0,
    messages: [{ id: 'workspace-loading-intro', role: 'assistant', sentAt: now,
      content: '### Try workspace loading\n\n[Open the session list loading demo](/sessions?demo=1&workspaceLoading=1). The session list opens at once. Skeleton rows fill the list until the sample data appears.\n\nUse Replay loading to repeat the transition. Search for a session, switch Flat or Projects, then open a conversation.\n\nThe delay is simulated. This demo uses the same session list and skeleton as your account. It does not connect to a server or change your saved sessions, drafts, or preferences.' }],
  };
}
