import { fromMarkdown } from 'mdast-util-from-markdown';
import { partsForMessage } from './messageOptions';
import { markdownText, RECAP_BLOCK_BREAK } from './recapQuote';
import { recapView } from './recapView';
import type { Message } from './types';

type Node = { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: Node[] };
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function cut(value: string, limit: number) {
  if (value.length <= limit) return value;
  const space = value.lastIndexOf(' ', limit);
  return value.slice(0, space > limit / 2 ? space : limit);
}

// Paragraph, list item, and code texts of a reply, in order. Quoted text is the user's, so skip it.
function blockTexts(message: Message): string[] {
  const texts: string[] = [];
  for (const part of partsForMessage(message)) {
    if (part.kind !== 'markdown') continue;
    const blocks = (fromMarkdown(part.content) as Node).children || [];
    for (const block of blocks.flatMap((node) => node.type === 'list' ? node.children || [] : [node])) {
      if (block.type === 'blockquote' || !block.position) continue;
      const source = part.content.slice(block.position.start.offset, block.position.end.offset);
      const text = markdownText(source).replaceAll(RECAP_BLOCK_BREAK, ' ').replace(/\s+/g, ' ').trim();
      if (text.length >= 12) texts.push(text);
    }
  }
  return texts;
}

/** The demo agent's answer to the open manual recap request: only a recap block for the reply before it. */
export function demoRecapReply(messages: readonly Message[]): string {
  const targetId = recapView(messages).pending?.targetId;
  const target = messages.find((message) => message.id === targetId);
  const points = (target ? blockTexts(target) : []).slice(0, 2).map((text) => {
    const quote = cut(text, 60);
    const label = cut(quote, 40).replace(/[\s:.,;!?。，：；！？]+$/u, '');
    return `<point quote="${escape(quote)}">${escape(label)}</point>`;
  });
  const body = points.length
    ? `The previous reply covers ${points.join(' and ')}.`
    : 'The previous reply has no text to recap.';
  return `<rayno-recap>\n${body}\n</rayno-recap>`;
}
