import { fromMarkdown } from 'mdast-util-from-markdown';
import { RECAP_REQUEST } from '../happy/systemPrompt';

export { RECAP_REQUEST };
export type RecapSegment =
  | { kind: 'text'; text: string }
  | { kind: 'point'; text: string; quote: string; index: number };
export type Recap = { text: string; segments: RecapSegment[] };
export type RecapParsePart = { kind: 'markdown'; content: string } | { kind: 'recap'; recap: Recap };
export type SyntaxNode = {
  type: string;
  value?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: SyntaxNode[];
};

// The prompt asks for 200 characters. Longer recaps still render, and the card clamps them.
export const RECAP_TEXT_LIMIT = 200;
export const RECAP_POINT_LIMIT = 3;
const OPENING = '<rayno-recap>';
const CLOSING = '</rayno-recap>';
const POINT = /<point\s+quote="([^"]*)"\s*>([\s\S]*?)<\/point>/g;
const TAG = /<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>/;
const ENTITIES: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', '#39': "'" };
const decode = (value: string) => value.replace(/&(quot|amp|lt|gt|#39);/g, (_, name: string) => ENTITIES[name]);
export const collapse = (value: string) => value.replace(/\s+/g, ' ');

function parseRecapBody(body: string): Recap | null {
  const segments: RecapSegment[] = [];
  const addText = (raw: string) => {
    if (TAG.test(raw)) return false;
    const text = collapse(decode(raw));
    const previous = segments.at(-1);
    if (previous?.kind === 'text') previous.text = collapse(previous.text + text);
    else if (text) segments.push({ kind: 'text', text });
    return true;
  };
  let cursor = 0;
  let index = 0;
  for (const point of body.matchAll(POINT)) {
    if (!addText(body.slice(cursor, point.index)) || TAG.test(point[2])) return null;
    const text = collapse(decode(point[2])).trim();
    if (!text) return null;
    // Points after the third keep their words but lose the pin.
    if (++index > RECAP_POINT_LIMIT) addText(text);
    else segments.push({ kind: 'point', text, quote: decode(point[1]).trim(), index });
    cursor = point.index + point[0].length;
  }
  if (!addText(body.slice(cursor))) return null;
  const first = segments[0], last = segments.at(-1);
  if (first?.kind === 'text') first.text = first.text.trimStart();
  if (last?.kind === 'text') last.text = last.text.trimEnd();
  const visible = segments.filter((segment) => segment.kind === 'point' || segment.text);
  const text = visible.map((segment) => segment.text).join('');
  return text.trim() ? { text, segments: visible } : null;
}

// Mirror parseMessageOptions: code and quoted examples must stay literal.
export function parseMessageRecap(content: string): RecapParsePart[] {
  if (!content.includes(OPENING)) return [{ kind: 'markdown', content }];
  const protectedRanges: [number, number][] = [];
  function visit(node: SyntaxNode) {
    if (['code', 'inlineCode', 'blockquote'].includes(node.type) && node.position) {
      protectedRanges.push([node.position.start.offset!, node.position.end.offset!]);
    } else node.children?.forEach(visit);
  }
  visit(fromMarkdown(content));

  const parts: RecapParsePart[] = [];
  let cursor = 0;
  for (const opening of content.matchAll(/<rayno-recap>/g)) {
    const start = opening.index;
    // Skip literal opening tags before they can consume a later real block.
    if (start < cursor || protectedRanges.some(([a, b]) => start >= a && start < b)) continue;
    const closing = content.indexOf(CLOSING, start + OPENING.length);
    if (closing === -1) break;
    const end = closing + CLOSING.length;
    if (protectedRanges.some(([a, b]) => start < b && end > a)) continue;
    const recap = parseRecapBody(content.slice(start + OPENING.length, closing));
    if (!recap) continue;
    if (start > cursor) parts.push({ kind: 'markdown', content: content.slice(cursor, start) });
    parts.push({ kind: 'recap', recap });
    cursor = end;
  }
  if (cursor < content.length) parts.push({ kind: 'markdown', content: content.slice(cursor) });
  return parts.length ? parts : [{ kind: 'markdown', content }];
}
