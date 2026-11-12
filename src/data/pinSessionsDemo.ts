import type { Session } from './types';

export const pinSessionsDemoId = 'pin-sessions-demo';

export function createPinSessionsDemo(now = Date.now()): Session {
  return {
    id: pinSessionsDemoId, title: 'Pin sessions · Interactive demo',
    workspace: 'Examples', project: 'Rayno', path: '/demo/pin-sessions', branch: 'demo/pin-sessions',
    machineId: 'mbp', agent: 'Claude', model: 'claude-opus-5', effort: 'high',
    // An old activity time keeps this row low in the list until a pin moves it to the top.
    status: 'idle', unread: false, archived: false, createdAt: now - 30 * 86400000, updatedAt: now - 30 * 86400000,
    additions: 0, deletions: 0,
    messages: [{ id: 'pin-sessions-intro', role: 'assistant', sentAt: now, content:
      '### Pin sessions\n\nThis session is old, so it sits near the bottom of the session list.\n\n1. Open **Session actions** in the chat header, or open the actions of a row in the session list. On a phone, you can also press and hold a row.\n2. Select **Pin session**. The row moves to the top of the list and shows a pin.\n3. Select **Unpin session** to move it back. You can repeat this with any session.\n\nPinned sessions stay first in **Flat** and **Projects** modes, and newer activity in other sessions does not move them down. Pins stay in this browser. They do not sync to other devices or to the Happy app.' }],
  };
}
