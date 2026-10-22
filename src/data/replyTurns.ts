import type { Message } from './types';

// Keep this module free of the Markdown parser. The chat shell imports it before the message list loads.

// A Happy Agent message that the agent rejected was never sent. It is not a user turn anywhere.
export const isRejected = (message: Message) => message.delivery?.status === 'rejected';

// Message IDs after the last real user turn. A hidden recap request does not answer the options.
// A held or rejected message never started a turn, as in Happy Web utils/agentTurns.ts.
export function unansweredMessageIds(messages: readonly Message[]): Set<string> {
  const lastUser = messages.findLastIndex((message) => message.role === 'user' && !message.recapRequest && !message.delivery);
  return new Set(messages.slice(lastUser + 1).map((message) => message.id));
}

const hasContent = (message: Message) => !!message.content.trim() || !!message.attachments?.length;

// True when a manual recap request has no agent answer yet. Any agent reply with content answers the oldest request.
// A real user turn closes older requests that got no answer.
export function hasOpenRecapRequest(messages: readonly Message[]): boolean {
  let open = 0;
  for (const message of messages) {
    if (isRejected(message)) continue;
    if (message.role === 'user') open = message.recapRequest ? open + 1 : 0;
    else if (open && hasContent(message)) open--;
  }
  return open > 0;
}

// True when an agent reply with content exists, so a manual recap has a target.
export function hasAgentReply(messages: readonly Message[]): boolean {
  return messages.some((message) => message.role === 'assistant' && hasContent(message));
}
