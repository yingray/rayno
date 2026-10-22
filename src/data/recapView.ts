import { formatToolValue } from './chatBlocks';
import { toolSections, toolSectionsText } from './toolResults';
import { partsForMessage } from './messageOptions';
import type { Recap } from './messageRecap';
import { findRecapQuote, markdownText, RECAP_BLOCK_BREAK } from './recapQuote';
import { isRejected } from './replyTurns';
import type { Message } from './types';

export type MessageRecap = {
  recap: Recap;
  // True when the recap came from a hidden reply to a manual request.
  manual: boolean;
  // The ID of the message that holds the recap block: the reply itself, or the hidden answer.
  sourceId: string;
  // targets[point.index - 1] is true when the reply or its tool rows hold that quote.
  targets: boolean[];
};
export type RecapView = {
  // The recap to show at the end of each agent message, by message ID.
  recaps: Map<string, MessageRecap>;
  // Hidden recap requests and the recap-only replies that answer them.
  hidden: Set<string>;
  // The oldest manual request without an answer. targetId is null when no agent reply comes before it.
  pending: { requestId: string; targetId: string | null } | null;
};

const sourceTexts = new WeakMap<Message, string>();
// The rendered text of a reply without its recap and options blocks.
export function recapSourceText(message: Message): string {
  let text = sourceTexts.get(message);
  if (text === undefined) {
    text = partsForMessage(message).map((part) => part.kind === 'markdown' ? markdownText(part.content) : RECAP_BLOCK_BREAK).join('');
    sourceTexts.set(message, text);
  }
  return text;
}

const toolTexts = new WeakMap<Message, string[]>();
// The text of each tool row of a message: the name, and the arguments and result that the row shows.
function toolSourceTexts(message: Message): string[] {
  let texts = toolTexts.get(message);
  if (!texts) {
    texts = (message.tools || []).map((name, index) => {
      const call = message.toolCalls?.[index];
      if (!call || (call.input === undefined && call.result === undefined)) return name;
      return [name, formatToolValue(call.input), ...toolSectionsText(toolSections(call))].join(RECAP_BLOCK_BREAK);
    });
    toolTexts.set(message, texts);
  }
  return texts;
}

function lastRecap(message: Message): Recap | undefined {
  return partsForMessage(message).findLast((part) => part.kind === 'recap')?.recap;
}

// A reply that holds only recap blocks, whitespace aside.
export function isRecapOnly(message: Message): boolean {
  const parts = partsForMessage(message);
  return parts.some((part) => part.kind === 'recap')
    && parts.every((part) => part.kind === 'recap' || (part.kind === 'markdown' && !part.content.trim()));
}

const hasContent = (message: Message) => !!message.content.trim() || !!message.attachments?.length;
function targetsFor(recap: Recap, sources: readonly string[]): boolean[] {
  return recap.segments.flatMap((segment) => segment.kind === 'point' ? [findRecapQuote(segment.quote, sources)] : []);
}

/**
 * Resolve the recaps for a visible message list.
 * A manual request and its recap-only answer are hidden, and the recap attaches to the agent reply before the request.
 * A later manual recap replaces the own recap of that reply.
 */
export function recapView(messages: readonly Message[]): RecapView {
  const recaps = new Map<string, MessageRecap>();
  const hidden = new Set<string>();
  const sources = new Map<string, string[]>();
  const open: { requestId: string; targetId: string | null }[] = [];
  let lastAgentId: string | null = null;
  // The text of the tool rows in the current turn.
  let turnTools: string[] = [];
  for (const message of messages) {
    // A rejected message never reached the agent. A rejected recap request stays visible with its reason.
    if (isRejected(message) || message.unplaced) continue;
    if (message.role === 'user') {
      if (message.recapRequest) {
        hidden.add(message.id);
        open.push({ requestId: message.id, targetId: lastAgentId });
      } else {
        // A real user turn closes older requests that got no answer, for example after a stop.
        turnTools = [];
        open.length = 0;
      }
      continue;
    }
    if (message.tools?.length) turnTools = [...turnTools, ...toolSourceTexts(message)];
    if (!hasContent(message)) continue;
    const request = open.shift();
    const recap = lastRecap(message);
    if (request?.targetId && recap && isRecapOnly(message)) {
      hidden.add(message.id);
      recaps.set(request.targetId, { recap, manual: true, sourceId: message.id, targets: targetsFor(recap, sources.get(request.targetId)!) });
      continue;
    }
    const own = [recapSourceText(message), ...turnTools];
    sources.set(message.id, own);
    lastAgentId = message.id;
    if (recap) recaps.set(message.id, { recap, manual: false, sourceId: message.id, targets: targetsFor(recap, own) });
  }
  return { recaps, hidden, pending: open[0] || null };
}
