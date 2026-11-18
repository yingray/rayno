import { fromMarkdown } from 'mdast-util-from-markdown';

const opening = '\ue200visualize\ue202';
const closing = '\ue201';
export type VisualizationReference = { path: string; title?: string; mode?: 'wide' };
type Part = { text: string } | { reference: VisualizationReference };

export function visualizationReference(reference: VisualizationReference): string {
  return opening + JSON.stringify(reference) + closing;
}

// Only a standalone paragraph is a reference. Examples in code, quotes, and lists stay literal.
export function visualizationParts(text: string): Part[] {
  if (!text.includes(opening)) return [{ text }];
  const parts: Part[] = [];
  let cursor = 0;
  for (const node of fromMarkdown(text).children) {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (node.type !== 'paragraph' || start === undefined || end === undefined) continue;
    const line = text.slice(start, end);
    if (!line.startsWith(opening) || !line.endsWith(closing) || line.length > 4096 || line.includes('\n')) continue;
    try {
      const value = JSON.parse(line.slice(opening.length, -closing.length));
      if (typeof value?.path !== 'string' || !value.path.trim() || value.path.length > 2048) continue;
      if (start > cursor) parts.push({ text: text.slice(cursor, start) });
      parts.push({ reference: { path: value.path, title: typeof value.title === 'string' ? value.title.trim().slice(0, 160) : undefined,
        mode: value.mode === 'wide' ? 'wide' : undefined } });
      cursor = end;
    } catch { /* Partial and invalid references stay visible as text. */ }
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts.length ? parts : [{ text }];
}
