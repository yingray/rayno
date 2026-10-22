import type { Message, ToolCall } from './types';

export type ToolActivityBlock = {
  kind: 'tools';
  id: string;
  tools: string[];
  details?: (ToolCall | undefined)[];
  // The text of a thinking row, at the index of its row. Thinking rows are not tools.
  thinking?: (string | undefined)[];
  duration?: string;
};
export type ThinkingBlock = { kind: 'thinking'; id: string; text: string };
export type ChatBlock = ToolActivityBlock | ThinkingBlock | { kind: 'message'; id: string; message: Message };

// The text of a tool argument or result, as the tool row shows it.
export function formatToolValue(value: unknown) {
  return typeof value === 'string' ? value : value === undefined ? 'Not reported.' : JSON.stringify(value, null, 2);
}
export const toolCount = (block: ToolActivityBlock) =>
  block.tools.length - (block.thinking?.filter((text) => text !== undefined).length || 0);

// Thinking without reply text is work, not a reply. It joins the next tool run or shows on its own.
const thinkingRow = (message: Message) =>
  message.role === 'assistant' && !!message.thinking && !message.content.trim() && !message.attachments?.length;
function addRow(block: ToolActivityBlock, name: string, call?: ToolCall, thinking?: string) {
  const index = block.tools.length;
  block.tools.push(name);
  if (call || block.details) (block.details ||= Array(index).fill(undefined)).push(call);
  if (thinking !== undefined || block.thinking) (block.thinking ||= Array(index).fill(undefined)).push(thinking);
}

export function groupChatActivity(messages: readonly Message[]): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  const toolBlock = (message: Message): ToolActivityBlock => {
    const block: ToolActivityBlock = { kind: 'tools', id: `tools:${message.id}`, tools: [], duration: message.duration };
    blocks.push(block);
    return block;
  };
  for (const message of messages) {
    let fresh: ToolActivityBlock | undefined;
    if (thinkingRow(message)) {
      const previous = blocks.at(-1);
      if (previous?.kind === 'tools') addRow(previous, 'Thinking', undefined, message.thinking);
      else if (previous?.kind === 'thinking') previous.text += '\n\n' + message.thinking;
      else if (message.tools?.length) addRow(fresh = toolBlock(message), 'Thinking', undefined, message.thinking);
      else blocks.push({ kind: 'thinking', id: `thinking:${message.id}`, text: message.thinking! });
    }
    if (message.tools?.length) {
      const previous = blocks.at(-1);
      let block: ToolActivityBlock;
      if (message.role === 'assistant' && previous?.kind === 'tools') {
        block = previous;
        // Separate durations do not describe the full group.
        if (block !== fresh) block.duration = undefined;
      } else block = toolBlock(message);
      message.tools.forEach((name, index) => addRow(block, name, message.toolCalls?.[index]));
    }
    if (message.role === 'user' || message.content.trim() || message.attachments?.length) {
      blocks.push({ kind: 'message', id: `message:${message.id}`, message });
    }
  }
  return blocks;
}
