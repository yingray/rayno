import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Message } from './types';
import { parseMessageRecap, type Recap } from './messageRecap';

export type MessagePart =
  | { kind: 'markdown'; content: string }
  | { kind: 'options'; items: string[] }
  | { kind: 'recap'; recap: Recap };
type SyntaxNode = {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: SyntaxNode[];
};

// Code and quoted examples must stay literal, including inline and indented code.
export function parseMessageOptions(content: string): Exclude<MessagePart, { kind: 'recap' }>[] {
  if (!content.includes('<options>')) return [{ kind: 'markdown', content }];
  const protectedRanges: [number, number][] = [];
  function visit(node: SyntaxNode) {
    if (['code', 'inlineCode', 'blockquote'].includes(node.type) && node.position) {
      protectedRanges.push([node.position.start.offset!, node.position.end.offset!]);
    } else node.children?.forEach(visit);
  }
  visit(fromMarkdown(content));

  const parts: Exclude<MessagePart, { kind: 'recap' }>[] = [];
  let cursor = 0;
  for (const opening of content.matchAll(/<options>/g)) {
    const start = opening.index;
    // Skip literal opening tags before they can consume a later real block.
    if (start < cursor || protectedRanges.some(([a, b]) => start >= a && start < b)) continue;
    const closing = content.indexOf('</options>', start + opening[0].length);
    if (closing === -1) break;
    const end = closing + '</options>'.length;
    if (protectedRanges.some(([a, b]) => start < b && end > a)) continue;
    const body = content.slice(start + opening[0].length, closing);
    const items: string[] = [];
    let itemCursor = 0;
    let valid = true;
    for (const option of body.matchAll(/<option>([\s\S]*?)<\/option>/g)) {
      const label = option[1].trim();
      if (!label || body.slice(itemCursor, option.index).trim()) {
        valid = false;
        break;
      }
      items.push(label);
      itemCursor = option.index + option[0].length;
    }
    if (!valid || !items.length || body.slice(itemCursor).trim()) continue;
    if (start > cursor) parts.push({ kind: 'markdown', content: content.slice(cursor, start) });
    parts.push({ kind: 'options', items });
    cursor = end;
  }
  if (cursor < content.length) parts.push({ kind: 'markdown', content: content.slice(cursor) });
  return parts.length ? parts : [{ kind: 'markdown', content }];
}

const messageParts = new WeakMap<Message, MessagePart[]>();
export function partsForMessage(message: Message): MessagePart[] {
  let parts = messageParts.get(message);
  if (!parts) {
    // Options keep their own full-content parse. A recap sits in the Markdown before them.
    parts = parseMessageOptions(message.content).flatMap((part): MessagePart[] =>
      part.kind === 'markdown' ? parseMessageRecap(part.content) : [part]);
    messageParts.set(message, parts);
  }
  return parts;
}
