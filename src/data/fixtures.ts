import type {
  DemoState,
  Machine,
  Session,
  UsageReading,
} from './types';

export const machines: Machine[] = [
  {
    id: 'mbp',
    name: 'ray-mbp',
    online: true,
    os: 'macOS · Apple M4 Pro',
    battery: 84,
    charging: true,
    network: 'Wi-Fi',
    ssid: 'Studio',
    ip: '100.78.24.12',
    latency: 142,
  },
  {
    id: 'mini',
    name: 'studio-mini',
    online: true,
    os: 'macOS · Apple M2',
    battery: 18,
    charging: false,
    network: 'Ethernet',
    ssid: 'Wired connection',
    ip: '100.96.12.8',
    latency: 38,
  },
  {
    id: 'linux',
    name: 'dev-linux',
    online: false,
    os: 'Ubuntu 24.04',
    battery: 100,
    charging: true,
    network: 'Ethernet',
    ssid: 'Disconnected',
    ip: '100.64.8.22',
    latency: 0,
  },
];
export const usageReadings: UsageReading[] = [
  { agent: 'Claude', week: { usedPercent: 38, pacePercent: 46, reset: '3d 18h' }, fiveHour: { usedPercent: 24, pacePercent: 58, reset: '2h 6m' } },
  { agent: 'Codex', week: { usedPercent: 62, pacePercent: 46, reset: '3d 18h' }, fiveHour: { usedPercent: 71, pacePercent: 58, reset: '2h 6m' } },
];
export const modelOptions = [
  'Opus 5 · High',
  'Sonnet 5 · Medium',
  'GPT-5.4 · High',
  'GPT-5.4 · Medium',
];
export { defaultNewDraft, defaultPreferences } from './defaults';
import { defaultNewDraft, defaultPreferences } from './defaults';
import { createQuestionDemo } from './questionDemo';
import { createImageDemo } from './imageDemo';
import { createReplyOptionsDemo } from './replyOptionsDemo';
import { createToolTimelineDemo } from './toolTimelineDemo';

export function createInitialState(now = Date.now()): DemoState {
  const sessions: Session[] = [
    {
      id: 'floating-panels',
      workspace: 'happy-web',
      project: 'Rayno',
      title: 'Build the floating panels layout',
      agent: 'Claude',
      branch: 'feat/floating-panels',
      additions: 42,
      deletions: 9,
      context: { size: 84000, window: 200000 },
      status: 'idle',
      unread: false,
      age: 2,
    },
    {
      id: 'api-contract',
      workspace: 'api-gateway',
      project: 'Acme',
      title: 'Review the webhook retry strategy and API contract',
      agent: 'Codex',
      branch: 'fix/webhook-retries',
      additions: 128,
      deletions: 32,
      status: 'running',
      unread: false,
      age: 6,
    },
    {
      id: 'design-tokens',
      workspace: 'design-system',
      project: 'Rayno',
      title: 'Bring the new color tokens into the component library',
      agent: 'Claude',
      branch: 'feat/tokens',
      additions: 86,
      deletions: 14,
      status: 'blocked',
      unread: true,
      age: 18,
    },
    {
      id: 'session-memory',
      workspace: 'happy-web',
      project: 'Rayno',
      title: 'Preserve scroll position when switching sessions',
      agent: 'Codex',
      branch: 'fix/scroll-memory',
      additions: 24,
      deletions: 8,
      status: 'idle',
      unread: true,
      age: 45,
    },
    {
      id: 'quiet-hours',
      workspace: 'workflow',
      project: 'Acme',
      title: 'Add quiet hours to notification preferences',
      agent: 'Happy Agent',
      branch: 'feat/quiet-hours',
      additions: 15,
      deletions: 2,
      status: 'idle',
      unread: false,
      age: 124,
    },
    {
      id: 'readme',
      workspace: 'toolbox',
      project: 'Personal',
      title: 'Update local development instructions',
      agent: 'Claude',
      branch: 'docs/setup',
      additions: 18,
      deletions: 6,
      status: 'idle',
      unread: false,
      age: 245,
    },
    {
      id: 'machine-health',
      workspace: 'infra',
      project: 'Personal',
      title: 'Investigate intermittent machine health readings',
      agent: 'Codex',
      branch: 'debug/health',
      additions: 12,
      deletions: 4,
      status: 'offline',
      unread: false,
      age: 390,
    },
    {
      id: 'old-session',
      workspace: 'happy-web',
      project: 'Rayno',
      title: 'Explore the first rail prototype',
      agent: 'Claude',
      branch: 'spike/rail',
      additions: 0,
      deletions: 0,
      status: 'idle',
      unread: false,
      age: 1550,
    },
  ].map((item) => ({
    ...item,
    agent: item.agent as Session['agent'],
    status: item.status as Session['status'],
    archived: item.id === 'old-session',
    path: `~/Developer/${item.workspace}`,
    machineId: item.status === 'offline' ? 'linux' : 'mbp',
    model: item.agent === 'Codex' ? modelOptions[2] : modelOptions[0],
    updatedAt: now - item.age * 60000,
    createdAt: now - 86400000,
    messages: [],
  }));
  sessions[0].messages = [
    {
      id: 'm1',
      role: 'user',
      content:
        'Let’s build the floating panels layout. Keep the interface quiet, give the panels room to breathe, and make it feel just as good on mobile.',
    },
    {
      id: 'm2',
      role: 'assistant',
      duration: '1m 12s',
      tools: [
        'Read the layout and design tokens',
        'Inspect the existing session components',
        'Update the responsive panel shell',
        'Check desktop and mobile breakpoints',
      ],
      content:
        'The new layout is taking shape. I’ve separated the shell into independent panels, with a consistent **10px gutter** and nested corners.\n\nThe rail stays compact, the session list keeps its place, and the conversation has room to breathe.\n\n### A small, consistent foundation\n\n```css\n/* tokens.css */\n:root {\n  --panel-radius: 24px;\n  --panel-gap: 10px;\n  --accent: #8b5cf6;\n}\n```\n\nEach panel scrolls independently. The composer floats above the conversation, while the last message always stays in view.\n\nNext, I’ll bring the same surface treatment to **Monitor** and the session details.',
    },
  ];
  sessions.slice(1).forEach((session) => {
    session.messages = [
      {
        id: `${session.id}-welcome`,
        role: 'assistant',
        content: `This is the **${session.workspace}** workspace.\n\n${session.title}.\n\nSend a message to explore the local demo. Replies are simulated and stay in this browser.`,
      },
    ];
  });
  for (const session of sessions) {
    session.messages = session.messages.map((message, index, list) => ({
      ...message, sentAt: (session.updatedAt ?? now) - (list.length - 1 - index) * 60000,
    }));
  }
  sessions.push(createQuestionDemo(now));
  sessions.push(createImageDemo(now));
  sessions.push(createReplyOptionsDemo(now));
  sessions.push(createToolTimelineDemo(now));
  return {
    version: 1,
    sessions,
    preferences: { ...defaultPreferences },
    drafts: {},
    newDraft: { ...defaultNewDraft },
    recentPaths: ['~/Developer/happy', '~/Developer/api-gateway', '~/Developer/design-system'],
  };
}
