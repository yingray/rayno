import type { Session } from './types';

export const sessionIdsDemoId = 'session-ids-demo';
export const demoClaudeSessionId = '00000000-0000-4000-8000-000000000001';
export const demoCodexThreadId = '00000000-0000-4000-8000-000000000002';

export function createSessionIdsDemo(now = Date.now()): Session[] {
  const session: Session = {
    id: sessionIdsDemoId, title: 'Copy session IDs · Interactive demo',
    workspace: 'Examples', project: 'Rayno', path: '/demo/session-ids', branch: 'demo/session-ids',
    machineId: 'mbp', agent: 'Claude', agentSessionId: demoClaudeSessionId, model: 'claude-opus-5', effort: 'high',
    status: 'idle', unread: false, archived: false, createdAt: now, updatedAt: now,
    additions: 0, deletions: 0,
    messages: [{ id: 'session-ids-intro', role: 'assistant', sentAt: now, content:
      '### Copy session IDs\n\nOpen [Session info](/session/session-ids-demo/info?demo=1). Select **Happy session ID** or **Claude session ID** to copy its complete value. The IDs stay separate, and long values wrap on phones. You can repeat each copy.\n\nTry the [Codex example](/session/session-ids-codex-demo/info?demo=1) to copy a **Codex thread ID**, or the [missing ID example](/session/session-ids-missing-demo/info?demo=1) to see **Not reported**. That row stays disabled until the agent reports an ID.\n\nAll IDs are sample values. Clipboard writes use your browser; no Happy account or live agent is required.' }],
  };
  return [session,
    { ...session, id: 'session-ids-codex-demo', title: 'Copy session IDs · Codex example', agent: 'Codex',
      agentSessionId: demoCodexThreadId, model: 'gpt-6.1-sol' },
    { ...session, id: 'session-ids-missing-demo', title: 'Copy session IDs · Not reported example', agentSessionId: undefined },
  ];
}
