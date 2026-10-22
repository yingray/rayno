import type { Message } from './types';
import { partsForMessage } from './messageOptions';

// A formal reply has visible main-agent text. Tool work, reasoning, events, and recap-only replies are not anchors.
export function responseAnchors(messages: readonly Message[]) {
  return messages.filter(message => message.role === 'assistant' && !message.unplaced && !message.event
    && !message.toolCalls?.length && !message.toolResults?.length
    && partsForMessage(message).some(part => part.kind === 'markdown' && part.content.trim()))
    .map(message => ({ id: message.id, label: message.content.replace(/<rayno-recap>[\s\S]*?<\/rayno-recap>/g, '').replace(/[#*`\n]/g,' ').trim().slice(0, 90) }));
}
