import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Message } from './types';

export type MessagePart =
  | { kind: 'markdown'; content: string }
  | { kind: 'options'; items: string[] };
type SyntaxNode = {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: SyntaxNode[];
};

// Code and quoted examples must stay literal, including inline and indented code.
export function parseMessageOptions(content: string): MessagePart[] {
  if (!content.includes('<options>')) return [{ kind: 'markdown', content }];
  const protectedRanges: [number, number][] = [];
  function visit(node: SyntaxNode) {
    if (['code', 'inlineCode', 'blockquote'].includes(node.type) && node.position) {
      protectedRanges.push([node.position.start.offset!, node.position.end.offset!]);
    } else node.children?.forEach(visit);
  }
  visit(fromMarkdown(content));

  const parts: MessagePart[] = [];
  let cursor = 0;
  for (const block of content.matchAll(/<options>([\s\S]*?)<\/options>/g)) {
    const start = block.index;
    const end = start + block[0].length;
    if (protectedRanges.some(([a, b]) => start < b && end > a)) continue;
    const items: string[] = [];
    let itemCursor = 0;
    let valid = true;
    for (const option of block[1].matchAll(/<option>([\s\S]*?)<\/option>/g)) {
      const label = option[1].trim();
      if (!label || block[1].slice(itemCursor, option.index).trim()) {
        valid = false;
        break;
      }
      items.push(label);
      itemCursor = option.index + option[0].length;
    }
    if (!valid || !items.length || block[1].slice(itemCursor).trim()) continue;
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
    parts = parseMessageOptions(message.content);
    messageParts.set(message, parts);
  }
  return parts;
}
