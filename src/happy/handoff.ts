// Adapted from the v1 Rayno overlay (MIT). See PROTOCOL-SOURCES.md.
import type { Agent, HandoffContext, NewSessionDraft } from '../data/types';
import { displayWorkspacePath, draftInWorkspace } from '../data/workspaces';

export type HandoffSource = {
  sessionId: string;
  title?: string;
  flavor?: string | null;
  machineId?: string | null;
  path?: string | null;
  homeDir?: string | null;
  claudeSessionId?: string;
  codexThreadId?: string;
};

const agentNames: Record<string, string> = {
  claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini',
  openclaw: 'OpenClaw', agy: 'Antigravity', rig: 'Happy Agent',
};

export function handoffTranscriptPath(source: HandoffSource): string | null {
  if (source.claudeSessionId) return `~/.claude/projects/*/${source.claudeSessionId}.jsonl`;
  if (source.codexThreadId) return `~/.codex/sessions/*/*/*/rollout-*-${source.codexThreadId}.jsonl`;
  return null;
}

export function buildHandoffPrompt(source: HandoffSource): string {
  const agent = agentNames[source.flavor || ''] || 'another agent';
  const where = source.path ? `, in \`${source.path}\`` : '';
  const transcript = handoffTranscriptPath(source);
  const lines = [`Continue the work from Happy session \`${source.sessionId}\` (${agent}${where}).`, ''];
  if (transcript) lines.push('Read the transcript of that session first:', `\`${transcript}\``);
  else lines.push('I cannot give you its transcript. Ask me for the context that you need.');
  return lines.join('\n');
}

// The context goes first and the user's task follows it in the same first message.
export function handoffRequestPrompt(prompt: string, handoff?: HandoffContext | null): string {
  if (!handoff) return prompt;
  return prompt.trim() ? `${handoff.prompt}\n\n${prompt}` : handoff.prompt;
}

export function defaultHandoffAgent(flavor?: string | null): Agent | null {
  return flavor === 'claude' ? 'Codex' : flavor === 'codex' ? 'Claude' : null;
}

export function buildHandoffDraft(source: HandoffSource, current: NewSessionDraft): NewSessionDraft | null {
  const draft = draftInWorkspace(source, defaultHandoffAgent(source.flavor) || current.agent);
  if (!draft) return null;
  return {
    ...draft,
    handoff: {
      sessionId: source.sessionId,
      title: source.title?.trim() || source.sessionId,
      prompt: buildHandoffPrompt({ ...source, path: displayWorkspacePath(source.path!.trim(), source.homeDir) }),
    },
  };
}
