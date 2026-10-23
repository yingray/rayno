import type { Session } from './types';

export const questionDemoId = 'agent-questions';

export function createQuestionDemo(now = Date.now()): Session {
  return {
    id: questionDemoId,
    title: 'Agent questions · Liquid Glass demo',
    workspace: 'rayno',
    project: 'Rayno',
    path: '~/Developer/rayno',
    branch: 'demo/agent-questions',
    machineId: 'mbp',
    agent: 'Claude',
    model: 'claude-opus-5',
    effort: 'high',
    status: 'idle',
    unread: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    additions: 0,
    deletions: 0,
    messages: [{
      id: 'question-demo-intro',
      role: 'assistant',
      sentAt: now,
      content: 'Try the single-choice and multiple-choice options below. You can tap an entire option, add your own answer, and send or dismiss the form. This demo stays in your browser.',
    }],
  };
}
