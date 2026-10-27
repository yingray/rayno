import type { Session } from './types';

export const workspaceLayoutDemoId = 'workspace-layout-demo';
export const workspaceLayoutSideDemoId = 'workspace-layout-side-demo';

export function createWorkspaceLayoutDemo(now = Date.now()): Session[] {
  const parent: Session = {
    id: workspaceLayoutDemoId, title: 'Workspace layout · Interactive demo', workspace: 'rayno', project: 'Rayno',
    path: '/demo/rayno', branch: 'demo/workspace-layout', machineId: 'mbp', agent: 'Claude', model: 'claude-opus-5', effort: 'high',
    status: 'idle', unread: false, archived: false, createdAt: now, updatedAt: now, additions: 0, deletions: 0,
    messages: [{ id: 'workspace-layout-intro', role: 'assistant', sentAt: now, content:
      '### Try the workspace layout\n\nUse the sidebar icon in the chat header or session list to collapse or expand Sessions. The same controls work with side chats open. You can also use Sessions in the navigation.\n\nOn a desktop, drag the right edge of Sessions to change its width. Your width stays after a reload or a collapse. Use Left and Right to adjust it, Home and End for its limits, and Enter or a double-click to reset it. Open the list options or select a session to try the narrow and wide layouts.\n\n[Open the side chat example](/session/workspace-layout-demo/side?demo=1). On a wide screen, drag the divider in either direction. Each chat can use 70% of the chat space. The session list and navigation use separate space. Arrow keys also adjust the divider. Home and End select the limits; Enter resets it.\n\n[Try a new session](/new?demo=1). Type a task, change the model, then start the session. Your draft stays available when you leave and return.\n\nOn phones, open a side chat from its list. Replies and session creation are simulated. You can repeat each interaction.' }],
  };
  return [parent, { ...parent, id: workspaceLayoutSideDemoId, title: 'Side chat', isSideChat: true,
    parentSessionId: parent.id, sideChatClosed: false,
    messages: [{ id: 'workspace-layout-side-intro', role: 'assistant', sentAt: now,
      content: 'Try both chat widths, then send a message here. Resize, collapse, or expand Sessions while both chats stay open. Your drafts stay in place.' }],
  }];
}
