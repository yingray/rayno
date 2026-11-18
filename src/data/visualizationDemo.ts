import type { Session } from './types';
import { visualizationReference } from './visualizationReferences';

export const visualizationDemoId = 'visualization-demo';
export const visualizationDemoPath = '/demo/workspace/codex-cost-vs-score.html';

export function createVisualizationDemo(now = Date.now()): Session {
  return {
    id: visualizationDemoId, title: 'Chart preview · Interactive demo', workspace: 'rayno', project: 'Rayno',
    path: '/demo/workspace', branch: 'demo/visualization', machineId: 'mbp', agent: 'Codex',
    model: 'gpt-6.2-sol', effort: 'xhigh', status: 'idle', unread: false, archived: false,
    createdAt: now, updatedAt: now, additions: 0, deletions: 0,
    messages: [{
      id: 'visualization-demo-reply', role: 'assistant', sentAt: now,
      content: '### Try the chart preview\n\nOpen **Codex cost vs. score**. Tap a point or use **Data point** to inspect an effort. Close and reopen the preview to try again. The demo reads bundled data.\n\n'
        + visualizationReference({ path: visualizationDemoPath, title: 'Codex cost vs. score' }),
    }],
  };
}
