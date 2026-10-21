import type { Message, ToolCall } from './types';

export type ToolActivityBlock = {
  kind: 'tools';
  id: string;
  tools: string[];
  details?: (ToolCall | undefined)[];
  duration?: string;
};
export type ChatBlock = ToolActivityBlock | { kind: 'message'; id: string; message: Message };

export function groupChatActivity(messages: readonly Message[]): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  for (const message of messages) {
    if (message.tools?.length) {
      const previous = blocks.at(-1);
      if (message.role === 'assistant' && previous?.kind === 'tools') {
        previous.tools.push(...message.tools);
        if (previous.details || message.toolCalls) previous.details = [
          ...(previous.details || Array(previous.tools.length - message.tools.length).fill(undefined)),
          ...(message.toolCalls || Array(message.tools.length).fill(undefined)),
        ];
        // Separate durations do not describe the full group.
        previous.duration = undefined;
      } else {
        blocks.push({
          kind: 'tools',
          id: `tools:${message.id}`,
          tools: [...message.tools],
          ...(message.toolCalls ? { details: [...message.toolCalls] } : {}),
          duration: message.duration,
        });
      }
    }
    if (message.role === 'user' || message.content.trim() || message.attachments?.length) {
      blocks.push({ kind: 'message', id: `message:${message.id}`, message });
    }
  }
  return blocks;
}
