import type { Message, Session, ToolCall } from './types';

export const toolTimelineDemoId = 'tool-timeline-demo';
const labels = ['Read sources/monitor/manualUsage.ts', 'Grep capturedAt · 9 matches', 'Read sources/monitor/agentUsage.ts', 'Run monitor tests'];
export function timelineDemoMessages(stage: number, now: number, previous: Message[] = []): Message[] {
  const intro: Message = { id: 'timeline-intro', role: 'assistant', sentAt: previous[0]?.sentAt ?? now, content: [
    '### Ticker + timeline · Interactive demo',
    'Start, then choose Next step. Expand Tool activity to inspect the timeline and tool details. Finish to see the duration summary.',
    'Tools are simulated. This example uses the real chat components. Restart preserves your draft.',
  ].join('\n\n') };
  const old = previous.find(message => message.id === 'timeline-tools');
  const count = Math.min(stage, 4);
  const calls: ToolCall[] = labels.slice(0, count).map((name, index) => {
    const existing = old?.toolCalls?.[index];
    const ended = stage === 4 || index < count - 1;
    return { id: `timeline-call-${index}`, name, tool: index === 1 ? 'Grep' : index === 3 ? 'Bash' : 'Read',
      input: index === 1 ? { pattern: 'capturedAt', path: 'sources/monitor' } : index === 3 ? { command: 'pnpm test monitor' } : { file_path: name.slice(5) },
      startedAt: existing?.startedAt ?? now,
      ...(ended ? { ended: true, endedAt: existing?.endedAt ?? now, result: index === 1 ? '9 matches' : index === 3 ? 'All monitor tests passed.' : 'export const capturedAt = Date.now();' } : {}),
    };
  });
  return [intro, ...(count ? [{ id: 'timeline-tools', role: 'assistant' as const, content: '',
    sentAt: old?.sentAt ?? now, tools: calls.map(call => call.name), toolCalls: calls }] : [])];
}
export function createToolTimelineDemo(now = Date.now()): Session {
  return {
    id: toolTimelineDemoId, title: 'Ticker + timeline · Interactive demo', workspace: 'rayno', project: 'Rayno',
    path: '~/Developer/rayno', branch: 'demo/tool-timeline', machineId: 'mbp', agent: 'Claude',
    model: 'claude-opus-5', effort: 'high', status: 'idle', unread: false, archived: false,
    createdAt: now, updatedAt: now, additions: 0, deletions: 0, messages: timelineDemoMessages(0, now),
  };
}
