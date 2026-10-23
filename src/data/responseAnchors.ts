import type { Message } from './types';
import { partsForMessage } from './messageOptions';
import { markdownText, RECAP_BLOCK_BREAK } from './recapQuote';

export type ResponseAnchor = { id: string; label: string; characters: number; size: 'small' | 'medium' | 'large' };
const cache = new WeakMap<Message, ResponseAnchor | null>();

// A formal reply has visible main-agent text. Tool work, reasoning, events, and recap-only replies are not anchors.
export function responseAnchors(messages: readonly Message[]): ResponseAnchor[] {
  return messages.flatMap(message => {
    let anchor = cache.get(message);
    if (anchor === undefined) {
      anchor = null;
      if (message.role === 'assistant' && !message.unplaced && !message.event
        && !message.toolCalls?.length && !message.toolResults?.length) {
        const parts = partsForMessage(message).filter(part => part.kind === 'markdown');
        if (parts.some(part => part.content.trim())) {
          const text = parts.map(part => markdownText(part.content).split(RECAP_BLOCK_BREAK).join(' ')).join(' ');
          const characters = [...text.replace(/\s/g, '')].length;
          anchor = { id: message.id, label: text.replace(/\s+/g, ' ').trim().slice(0, 90), characters,
            size: characters < 500 ? 'small' : characters < 2000 ? 'medium' : 'large' };
        }
      }
      cache.set(message, anchor);
    }
    return anchor ? [anchor] : [];
  });
}
