import type { ToolCall } from './types';

// Only a complete leading Claude command envelope counts as an invocation.
// Inline examples, code fences, and incomplete tags remain ordinary message text.
export function commandInvocation(text: string): { name: string; args: string; remainder: string } | null {
  const match = /^\s*<command-message>([^<>]+)<\/command-message>\s*<command-name>(\/[^<>\s]+)<\/command-name>(?:\s*<command-args>([\s\S]*?)<\/command-args>)?/.exec(text);
  if (!match) return null;
  return { name: match[2], args: match[3] || '', remainder: text.slice(match[0].length).trimStart() };
}

export function skillInvocation(call: ToolCall | undefined): string | null {
  if (call?.name !== 'Skill' || !call.input || typeof call.input !== 'object') return null;
  const skill = (call.input as Record<string, unknown>).skill;
  return typeof skill === 'string' && skill.trim() ? skill.trim() : null;
}
