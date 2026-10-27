import type { Session } from './types';

export const markdownAppearanceDemoId = 'markdown-appearance-demo';
export const markdownAppearancePreview = '# A little room to read\n\nBody text with **bold emphasis** and `inline code`.\n\n## A clear next step\n\n> A quote gives a passage its own space.\n\n### The small details\n\nFollow this [sample link](https://example.com) to compare its style.';

export function createMarkdownAppearanceDemo(now = Date.now()): Session {
  return {
    id: markdownAppearanceDemoId, title: 'Markdown appearance · Interactive demo', workspace: 'rayno', project: 'Rayno',
    path: '/demo/rayno', branch: 'demo/markdown-appearance', machineId: 'mbp', agent: 'Claude', model: 'claude-opus-5', effort: 'high',
    status: 'idle', unread: false, archived: false, createdAt: now, updatedAt: now, additions: 0, deletions: 0,
    messages: [{ id: 'markdown-appearance-sample', role: 'assistant', sentAt: now, content:
      `${markdownAppearancePreview}\n\nOpen Appearance settings below. Select the color dots for bold text, quotes, and links. Choose from 26 official shadcn/Tailwind color families. Color text uses shade 300, neutral text uses 400, and backgrounds use 950. The quote border follows its text color. Use Open Markdown demo to return here. Your choices also apply to other chat sessions.\n\n- A list can contain **bold text** or a [link](https://example.com).\n- Your drafts and other preferences stay in place.\n\n| Element | Example |\n| --- | --- |\n| Bold | **A readable phrase** |\n| Code | \`src/features/Chat.tsx\` |\n\n\`\`\`typescript\nconst theme = 'violet-300';\nconsole.log(theme);\n\`\`\`\n\nCode blocks keep their syntax colors. Change presets again to repeat the comparison. Replies are simulated in this demo.` }],
  };
}
